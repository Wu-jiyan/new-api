package controller

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// characterChatLock 单线并发闸：同一用户同一角色同一时刻仅允许一个流式对话
var (
	characterChatLockMu sync.Mutex
	characterChatLocked = map[string]bool{}
)

func characterChatLockKey(userId int, modelName string) string {
	return fmt.Sprintf("%d|%s", userId, modelName)
}

func tryAcquireCharacterChatLock(userId int, modelName string) bool {
	key := characterChatLockKey(userId, modelName)
	characterChatLockMu.Lock()
	defer characterChatLockMu.Unlock()
	if characterChatLocked[key] {
		return false
	}
	characterChatLocked[key] = true
	return true
}

func releaseCharacterChatLock(userId int, modelName string) {
	key := characterChatLockKey(userId, modelName)
	characterChatLockMu.Lock()
	delete(characterChatLocked, key)
	characterChatLockMu.Unlock()
}

// openingForStage 小剧场结束后进入自由对话的模板开场白（user 首条消息）
func openingForStage(stage model.CharacterStage) string {
	return fmt.Sprintf("（你刚刚经历完与她的「%s」这段故事。现在，你们之间的故事仍在继续——和她聊聊吧。）", stage.Name)
}

// CharacterChat 会话驱动角色对话：
// 1) 校验角色/解锁；2) 取/建单线会话；3) 落库 user 消息；
// 4) 组装 prompt（人设+阶段+资源清单+剧情回顾+摘要+窗口历史）内部转发 /pg/chat/completions；
// 5) SSE 透传同时聚合全文；6) 流正常结束后解析回复 JSON 拆分落库 assistant（好感在任务 3 接入）。
func CharacterChat(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")

	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	state, err := model.GetUserCharacterState(userId, &ch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	if state.MaxStage < 0 {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "该角色尚未解锁"})
		return
	}
	stages := ch.Stages()
	if len(stages.Stages) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "该角色未配置任何阶段"})
		return
	}

	var req struct {
		Content    string `json:"content"`
		StageIndex *int   `json:"stage_index"`
		FromStory  bool   `json:"from_story"`
		Model      string `json:"model"` // 具体对话模型（须匹配角色 model_name 前缀）
		Group      string `json:"group"` // 分组（空=沿用会话/用户默认）
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}

	stageIdx := state.MaxStage
	if req.StageIndex != nil {
		stageIdx = *req.StageIndex
	}
	if stageIdx < 0 || stageIdx >= len(stages.Stages) || stageIdx > state.MaxStage {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "该阶段尚未解锁"})
		return
	}
	stage := stages.Stages[stageIdx]

	if !tryAcquireCharacterChatLock(userId, modelName) {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "已有对话正在进行，请稍后再试"})
		return
	}
	defer releaseCharacterChatLock(userId, modelName)

	session, err := model.GetOrCreateCharacterChatSession(userId, modelName, stageIdx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	// 解析本轮对话使用的具体模型与分组：
	// 请求指定 > 会话已选 > 角色默认模型 > 角色前缀名（兜底，可能无渠道）
	chatModel := strings.TrimSpace(req.Model)
	if chatModel == "" {
		chatModel = session.Model
	}
	if chatModel == "" {
		chatModel = ch.DefaultModel
	}
	if chatModel == "" {
		chatModel = ch.ModelName
	}
	if !strings.HasPrefix(chatModel, ch.ModelName) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "模型不在该角色可用范围内"})
		return
	}
	chatGroup := strings.TrimSpace(req.Group)
	if chatGroup == "" {
		chatGroup = session.Group
	}
	if chatModel != session.Model || chatGroup != session.Group {
		if err := model.DB.Model(&model.CharacterChatSession{}).Where("id = ?", session.Id).
			Updates(map[string]interface{}{"model": chatModel, "group": chatGroup, "updated_at": common.GetTimestamp()}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		session.Model = chatModel
		session.Group = chatGroup
	}

	content := strings.TrimSpace(req.Content)
	if req.FromStory {
		if session.MessageCount == 0 {
			// 首次从小剧场进入：先写入 initial_context
			ensureCharacterChatInitialContext(c, &ch, stage, session, chatModel, chatGroup)
			content = openingForStage(stage)
		} else if content == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "会话已开始，请输入内容"})
			return
		}
	} else if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "内容不能为空"})
		return
	}
	userMsg, err := model.AddCharacterChatUserMessage(session, content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	recent, err := model.ListRecentCharacterChatMessages(session.Id, model.CharacterChatWindowSize)
	if err != nil {
		model.RemoveCharacterChatUserMessage(session, userMsg)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	var backgrounds []model.CharacterBackground
	if err := model.DB.Order("id ASC").Find(&backgrounds).Error; err != nil {
		model.RemoveCharacterChatUserMessage(session, userMsg)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	body, err := model.BuildCharacterChatPayload(&ch, stage, session, recent, backgrounds, chatModel, chatGroup)
	if err != nil {
		model.RemoveCharacterChatUserMessage(session, userMsg)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	upstream := fmt.Sprintf("http://127.0.0.1:%d/pg/chat/completions", *common.Port)
	resp, err := characterChatForward(c.Request.Context(), upstream, c.Request, body)
	if err != nil {
		model.RemoveCharacterChatUserMessage(session, userMsg)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "上游转发失败: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		c.Writer.Header().Set("Content-Type", ct)
	}
	c.Writer.WriteHeader(resp.StatusCode)
	flusher, _ := c.Writer.(http.Flusher)

	var raw strings.Builder
	buf := make([]byte, 32*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := c.Writer.Write(buf[:n]); werr != nil {
				return // 客户端断开：放弃（已在传输中的消息下轮摘要补齐）
			}
			if flusher != nil {
				flusher.Flush()
			}
			raw.Write(buf[:n])
		}
		if rerr != nil {
			break
		}
	}
	if resp.StatusCode != http.StatusOK {
		// 上游错误已原样透传；回滚本条 user 消息，重试时不重复落库
		model.RemoveCharacterChatUserMessage(session, userMsg)
		return
	}
	persistCharacterAssistant(session, userId, modelName, raw.String())
	maybeSummarizeCharacterSession(c.Request, &ch, session, chatModel, chatGroup)
	// 本轮计费已入日志：立即失效用量缓存，角色统计即时可见
	model.ClearCharacterUsageCacheEntry(userId, modelName)
}

// persistCharacterAssistant 流结束聚合：提取文本 → 容错解析 → 应用好感 → 逐句落库 assistant。
// LLM 每回合生成一段多句剧本，每句一行（视觉冗余随句、好感 delta 记在段首行）。
// 提取失败（非标准流）不落库；解析失败落原文单行（视觉冗余/好感为空）。
func persistCharacterAssistant(session *model.CharacterChatSession, userId int, modelName string, raw string) {
	text, ok := model.ExtractStreamContent(raw)
	if !ok {
		return
	}
	parsed, ok := model.ParseCharacterChatReply(text)
	if !ok {
		// 协议漂移兜底：原文按句拆分逐句落库（回放与体验一致），上限 12 句
		lim := 12
		for _, unit := range model.SplitLongLine(text) {
			_, _ = model.AddCharacterChatAssistantMessage(session, unit, model.CharacterChatVisual{}, 0, nil)
			lim--
			if lim <= 0 {
				break
			}
		}
		return
	}
	delta, _ := model.ApplyCharacterAffinityDelta(session.Id, userId, modelName, parsed.AffinityDelta, common.GetTimestamp())
	for i, line := range parsed.Lines {
		visual := model.CharacterChatVisual{Pose: line.Pose, Effect: line.Effect, Background: line.Background}
		lineDelta := 0
		if i == 0 {
			lineDelta = delta
		}
		_, _ = model.AddCharacterChatAssistantMessage(session, line.Text, visual, lineDelta, line.Choices)
	}
}

// ensureCharacterChatInitialContext 首次 from_story 进入时：把小剧场剧本压缩为 initial_context 落库。
// 生成失败或剧本为空则静默跳过（会话照常进行）。
func ensureCharacterChatInitialContext(c *gin.Context, ch *model.Character, stage model.CharacterStage, session *model.CharacterChatSession, chatModel string, chatGroup string) {
	if strings.TrimSpace(session.InitialContext) != "" {
		return
	}
	if len(stage.Script) == 0 {
		return
	}
	sys := "你是 galgame 剧情编辑。请把下面的小剧场剧本压缩成不超过 400 字的中文剧情概要，保留：人物关系、关键事件、当前所处场景、尚未了结的悬念。只输出概要正文，不要任何解释或标题。"
	msgs := []map[string]string{
		{"role": "system", "content": sys},
		{"role": "user", "content": scriptToText(stage.Script)},
	}
	summary, err := characterModelComplete(c.Request, chatModel, chatGroup, msgs)
	if err != nil || strings.TrimSpace(summary) == "" {
		return // 静默失败：不阻断对话
	}
	session.InitialContext = strings.TrimSpace(summary)
	_ = model.DB.Model(&model.CharacterChatSession{}).Where("id = ?", session.Id).
		Updates(map[string]interface{}{"initial_context": session.InitialContext, "updated_at": common.GetTimestamp()}).Error
}

// extractNonStreamContent 解析非流式 chat/completions 响应中的助手文本
func extractNonStreamContent(body string) (string, bool) {
	var resp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := common.Unmarshal([]byte(body), &resp); err != nil || len(resp.Choices) == 0 {
		return "", false
	}
	if strings.TrimSpace(resp.Choices[0].Message.Content) == "" {
		return "", false
	}
	return resp.Choices[0].Message.Content, true
}

// characterModelComplete 以独立 context 非流式调用一次模型（内部 /pg，计费到当前用户）。
// 用于小剧场剧情压缩与滚动摘要等非用户直接响应场景。
func characterModelComplete(src *http.Request, chatModel string, chatGroup string, messages []map[string]string) (string, error) {
	body, err := model.BuildChatCompletionsBody(chatModel, messages, false, chatGroup)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	upstream := fmt.Sprintf("http://127.0.0.1:%d/pg/chat/completions", *common.Port)
	resp, err := characterChatForward(ctx, upstream, src, body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("summarize upstream status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	text, ok := extractNonStreamContent(string(data))
	if !ok {
		return "", fmt.Errorf("summarize upstream empty content")
	}
	return text, nil
}

// maybeSummarizeCharacterSession 新消息落库后检查：message_count - summary_through >= gap 时
// 对「待归档」消息段做一次滚动摘要覆盖写回。失败静默（水位不推进）。
func maybeSummarizeCharacterSession(src *http.Request, ch *model.Character, session *model.CharacterChatSession, chatModel string, chatGroup string) {
	gap := session.MessageCount - session.SummaryThrough
	if gap < model.CharacterChatSummaryGap {
		return
	}
	// 待归档段：summary_through 之后最近的窗口条数（避免每轮重读全部）
	pending, err := model.ListRecentCharacterChatMessagesSince(session.Id, session.SummaryThrough, model.CharacterChatWindowSize)
	if err != nil || len(pending) == 0 {
		return
	}
	var b strings.Builder
	for _, m := range pending {
		b.WriteString(m.Role)
		b.WriteString(": ")
		b.WriteString(m.Content)
		b.WriteString("\n")
	}
	sys := "你是对话档案员。把「已有记忆摘要」与「新对话记录」合并，压缩成不超过 500 字的中文摘要：保留人物关系、发生过的关键事件、角色承诺与当前情感状态，按时间先后组织。只输出摘要正文。"
	msgs := []map[string]string{
		{"role": "system", "content": sys},
		{"role": "user", "content": "已有记忆摘要：\n" + session.Summary + "\n\n新对话记录：\n" + b.String()},
	}
	out, err := characterModelComplete(src, chatModel, chatGroup, msgs)
	if err != nil || strings.TrimSpace(out) == "" {
		return
	}
	updates := map[string]interface{}{
		"summary": out, "summary_through": session.MessageCount, "updated_at": common.GetTimestamp(),
	}
	if err := model.DB.Model(&model.CharacterChatSession{}).Where("id = ?", session.Id).Updates(updates).Error; err == nil {
		session.Summary = out
		session.SummaryThrough = session.MessageCount
	}
}

// scriptToText 将小剧场台词行转为模型输入文本
func scriptToText(script []model.CharacterScript) string {
	var b strings.Builder
	for _, line := range script {
		speaker := line.Speaker
		if speaker == "" {
			speaker = "旁白"
		}
		b.WriteString(speaker)
		b.WriteString("：")
		b.WriteString(line.Text)
		b.WriteString("\n")
		if len(line.Choices) > 0 {
			for _, ch := range line.Choices {
				b.WriteString("（选项）")
				b.WriteString(ch.Text)
				b.WriteString("→")
				b.WriteString(ch.Reply)
				b.WriteString("\n")
			}
		}
	}
	return b.String()
}

// ForgetCharacter 「忘记她」：清除对话进度、上下文、记忆与好感度；
// 保留已解锁阶段与 token/调用统计。
func ForgetCharacter(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")
	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	if err := model.ForgetCharacterChat(userId, modelName); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetCharacterChatMeta 返回会话元信息（对话页初始化用；无会话返回 has_history=false）
func GetCharacterChatMeta(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")
	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	data := gin.H{"has_history": false, "stage_index": 0, "stage_name": "", "message_count": 0, "initial_context": "", "summary": "", "model": "", "group": ""}
	var sess model.CharacterChatSession
	if err := model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&sess).Error; err == nil {
		stageName := ""
		stages := ch.Stages()
		if sess.StageIndex >= 0 && sess.StageIndex < len(stages.Stages) {
			stageName = stages.Stages[sess.StageIndex].Name
		}
		summary := sess.Summary
		if len(summary) > 200 {
			summary = summary[:200] + "…"
		}
		data = gin.H{
			"has_history": sess.MessageCount > 0, "stage_index": sess.StageIndex,
			"stage_name": stageName, "message_count": sess.MessageCount,
			"initial_context": sess.InitialContext, "summary": summary,
			"model": sess.Model, "group": sess.Group,
		}
	}
	c.JSON(200, gin.H{"success": true, "data": data})
}

// ListCharacterChatMessages 分页读取会话历史（倒序分页：cursor_id 取更旧消息）
func ListCharacterChatMessages(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")
	cursorId, _ := strconv.Atoi(c.DefaultQuery("cursor_id", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	items := []model.CharacterChatMessage{}
	hasMore := false
	var sess model.CharacterChatSession
	if err := model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&sess).Error; err == nil {
		rows, more, err := model.ListCharacterChatMessagesPaged(sess.Id, cursorId, limit)
		if err == nil {
			items = rows
			hasMore = more
		}
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": items, "has_more": hasMore}})
}
