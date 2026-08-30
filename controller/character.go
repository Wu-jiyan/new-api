package controller

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ListCharacters 角色列表（启用角色 + 当前用户解锁阶段）
func ListCharacters(c *gin.Context) {
	userId := c.GetInt("id")
	var list []*model.Character
	if err := model.DB.Where("enabled = ?", true).Order("id DESC").Find(&list).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	type stageView struct {
		Index        int    `json:"index"`
		Name         string `json:"name"`
		ImageURL     string `json:"image_url"`
		UnlockTokens int64  `json:"unlock_tokens"`
		UnlockText   string `json:"unlock_text"`
	}
	type charView struct {
		*model.Character
		MaxStage    int         `json:"max_stage"`
		TotalTokens int64       `json:"total_tokens"`
		TotalCalls  int64       `json:"total_calls"`
		Stages      []stageView `json:"stages"`
	}
	views := make([]charView, 0, len(list))
	for _, ch := range list {
		stages := ch.Stages()
		maxStage, tokens, calls, err := model.GetUserCharacterStage(userId, ch.ModelName, stages)
		if err != nil {
			continue
		}
		sv := make([]stageView, 0, len(stages.Stages))
		for i, st := range stages.Stages {
			v := stageView{Index: st.Index, Name: st.Name, UnlockTokens: st.UnlockTokens, UnlockText: st.UnlockText}
			// 仅对已调用（calls>=1）且已解锁的阶段暴露立绘，未解锁返回剪影
			if i <= maxStage && calls >= 1 {
				v.ImageURL = st.ImageURL
			}
			sv = append(sv, v)
		}
		views = append(views, charView{Character: ch, MaxStage: maxStage, TotalTokens: tokens, TotalCalls: calls, Stages: sv})
	}
	c.JSON(200, gin.H{"success": true, "data": views})
}

// GetCharacter 角色详情（未解锁阶段仅返回解锁文案）
func GetCharacter(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")
	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	stages := ch.Stages()
	maxStage, tokens, calls, err := model.GetUserCharacterStage(userId, ch.ModelName, stages)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	type stageView struct {
		Index        int                     `json:"index"`
		Name         string                  `json:"name"`
		ImageURL     string                  `json:"image_url"`
		UnlockTokens int64                   `json:"unlock_tokens"`
		UnlockText   string                  `json:"unlock_text"`
		Script       []model.CharacterScript `json:"script,omitempty"`
	}
	views := make([]stageView, 0, len(stages.Stages))
	for i, st := range stages.Stages {
		v := stageView{Index: st.Index, Name: st.Name, UnlockTokens: st.UnlockTokens, UnlockText: st.UnlockText}
		if i <= maxStage {
			v.ImageURL = st.ImageURL
			v.Script = st.Script
		}
		views = append(views, v)
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"id": ch.Id, "model_name": ch.ModelName, "display_name": ch.DisplayName,
		"title": ch.Title, "description": ch.Description, "tags": ch.Tags,
		"max_stage": maxStage, "total_tokens": tokens, "total_calls": calls,
		"stages": views,
	}})
}

// GetCharacterScript 小剧场剧本（未解锁该阶段返回 403）
func GetCharacterScript(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")
	stageIdx, err := strconv.Atoi(c.Param("stageIndex"))
	if err != nil || stageIdx < 0 {
		c.JSON(200, gin.H{"success": false, "message": "invalid stage index"})
		return
	}
	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	stages := ch.Stages()
	if stageIdx >= len(stages.Stages) {
		c.JSON(200, gin.H{"success": false, "message": "阶段不存在"})
		return
	}
	maxStage, _, _, err := model.GetUserCharacterStage(userId, ch.ModelName, stages)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if stageIdx > maxStage {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "该阶段尚未解锁"})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": stages.Stages[stageIdx].Script})
}

// characterChatHTTPClient 内部转发用 HTTP 客户端：不跟随重定向、不设超时
var characterChatHTTPClient = &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
	Timeout: 0,
}

// characterChatForward 将角色对话请求转发到本实例 /pg/chat/completions
// （该路由走 UserAuth(session cookie) + Distribute，计费到当前用户），测试中可替换。
var characterChatForward = func(ctx context.Context, url string, cookies []*http.Cookie, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	return characterChatHTTPClient.Do(req)
}

// CharacterChat 角色对话：校验角色与解锁状态，构造请求并内部转发 /pg/chat/completions，
// 将上游 SSE 流式响应原样透传给客户端。
func CharacterChat(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")

	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	stages := ch.Stages()
	maxStage, _, calls, err := model.GetUserCharacterStage(userId, ch.ModelName, stages)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}
	// GetUserCharacterStage 对从未调用用户返回 maxStage=0、calls=0（阶段0需首次调用才解锁），
	// 故以 calls<1（或 maxStage<0）判定未解锁。
	if maxStage < 0 || calls < 1 {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "该角色尚未解锁，调用模型即可解锁"})
		return
	}

	var req struct {
		Messages []map[string]string `json:"messages"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}
	body, err := model.BuildCharacterChatRequest(ch.ModelName, ch.SystemPrompt, req.Messages)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	upstream := fmt.Sprintf("http://127.0.0.1:%d/pg/chat/completions", *common.Port)
	resp, err := characterChatForward(c.Request.Context(), upstream, c.Request.Cookies(), body)
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
	buf := make([]byte, 32*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := c.Writer.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if rerr != nil {
			return
		}
	}
}
