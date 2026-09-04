package controller

import (
	"fmt"
	"net/http"
	"strings"
	"sync"

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

	content := strings.TrimSpace(req.Content)
	if req.FromStory {
		if session.MessageCount == 0 {
			// 首次从小剧场进入：任务 4 在此先写入 initial_context
			ensureCharacterChatInitialContext(c, &ch, stage, session)
			content = openingForStage(stage)
		} else if content == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "会话已开始，请输入内容"})
			return
		}
	} else if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "内容不能为空"})
		return
	}
	if _, err := model.AddCharacterChatUserMessage(session, content); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	recent, err := model.ListRecentCharacterChatMessages(session.Id, model.CharacterChatWindowSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	var backgrounds []model.CharacterBackground
	if err := model.DB.Order("id ASC").Find(&backgrounds).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	body, err := model.BuildCharacterChatPayload(&ch, stage, session, recent, backgrounds)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	upstream := fmt.Sprintf("http://127.0.0.1:%d/pg/chat/completions", *common.Port)
	resp, err := characterChatForward(c.Request.Context(), upstream, c.Request, body)
	if err != nil {
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
		return // 上游错误已原样透传，不落库 assistant
	}
	persistCharacterAssistant(session, userId, modelName, raw.String())
}

// persistCharacterAssistant 流结束聚合：提取文本 → 容错解析 → 应用好感 → 落库 assistant。
// 提取失败（非标准流）不落库；解析失败落原文（视觉冗余/好感为空）。
func persistCharacterAssistant(session *model.CharacterChatSession, userId int, modelName string, raw string) {
	text, ok := model.ExtractStreamContent(raw)
	if !ok {
		return
	}
	reply := text
	visual := model.CharacterChatVisual{}
	delta := 0
	if parsed, ok := model.ParseCharacterChatReply(text); ok {
		reply = parsed.Reply
		visual = model.CharacterChatVisual{Pose: parsed.Pose, Effect: parsed.Effect, Background: parsed.Background}
		delta, _ = model.ApplyCharacterAffinityDelta(session.Id, userId, modelName, parsed.AffinityDelta, common.GetTimestamp())
	}
	_, _ = model.AddCharacterChatAssistantMessage(session, reply, visual, delta)
}

// ensureCharacterChatInitialContext 空实现占位；任务 4 填充（小剧场脚本摘要 → session.InitialContext）。
func ensureCharacterChatInitialContext(c *gin.Context, ch *model.Character, stage model.CharacterStage, session *model.CharacterChatSession) {
}
