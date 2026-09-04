package controller

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"strconv"

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
		Index            int                   `json:"index"`
		Name             string                `json:"name"`
		ImageURL         string                `json:"image_url"`
		BackgroundURL    string                `json:"background_url,omitempty"`
		DefaultEffect    string                `json:"default_effect,omitempty"`
		Poses            []model.CharacterPose `json:"poses,omitempty"`
		SilhouetteURL    string                `json:"silhouette_url,omitempty"`
		UnlockTokens     int64                 `json:"unlock_tokens"`
		AffinityRequired int                   `json:"affinity_required,omitempty"`
		UnlockText       string                `json:"unlock_text"`
		Claimed          bool                  `json:"claimed"`
		Eligible         bool                  `json:"eligible"`
	}
	type charView struct {
		*model.Character
		MaxStage    int         `json:"max_stage"`
		Affinity    int         `json:"affinity"`
		TotalTokens int64       `json:"total_tokens"`
		TotalCalls  int64       `json:"total_calls"`
		Stages      []stageView `json:"stages"`
	}
	views := make([]charView, 0, len(list))
	for _, ch := range list {
		stages := ch.Stages()
		state, err := model.GetUserCharacterState(userId, ch)
		if err != nil {
			continue
		}
		sv := make([]stageView, 0, len(stages.Stages))
		for i, st := range stages.Stages {
			claimed := i <= state.MaxStage && state.Calls >= 1
			eligible := !claimed && state.IsStageEligible(st, ch.AffinityRequired)
			v := stageView{
				Index: st.Index, Name: st.Name, UnlockTokens: st.UnlockTokens,
				AffinityRequired: st.AffinityRequired, UnlockText: st.UnlockText,
				Claimed: claimed, Eligible: eligible,
			}
			if claimed {
				v.ImageURL = st.ImageURL
				v.BackgroundURL = st.BackgroundURL
				v.DefaultEffect = st.DefaultEffect
				v.Poses = st.Poses
			} else if st.ImageURL != "" {
				v.SilhouetteURL, _ = model.EnsureSilhouette(st.ImageURL)
			}
			sv = append(sv, v)
		}
		views = append(views, charView{
			Character: ch, MaxStage: state.MaxStage, Affinity: state.Affinity,
			TotalTokens: state.Tokens, TotalCalls: state.Calls, Stages: sv,
		})
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
	state, err := model.GetUserCharacterState(userId, &ch)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	type stageView struct {
		Index            int                     `json:"index"`
		Name             string                  `json:"name"`
		ImageURL         string                  `json:"image_url"`
		BackgroundURL    string                  `json:"background_url,omitempty"`
		DefaultEffect    string                  `json:"default_effect,omitempty"`
		Poses            []model.CharacterPose   `json:"poses,omitempty"`
		SilhouetteURL    string                  `json:"silhouette_url,omitempty"`
		UnlockTokens     int64                   `json:"unlock_tokens"`
		AffinityRequired int                     `json:"affinity_required,omitempty"`
		UnlockText       string                  `json:"unlock_text"`
		Claimed          bool                    `json:"claimed"`
		Eligible         bool                    `json:"eligible"`
		Script           []model.CharacterScript `json:"script,omitempty"`
	}
	views := make([]stageView, 0, len(stages.Stages))
	for i, st := range stages.Stages {
		claimed := i <= state.MaxStage && state.Calls >= 1
		v := stageView{
			Index: st.Index, Name: st.Name, UnlockTokens: st.UnlockTokens,
			AffinityRequired: st.AffinityRequired, UnlockText: st.UnlockText,
			Claimed: claimed, Eligible: !claimed && state.IsStageEligible(st, ch.AffinityRequired),
		}
		if claimed {
			v.ImageURL = st.ImageURL
			v.BackgroundURL = st.BackgroundURL
			v.DefaultEffect = st.DefaultEffect
			v.Poses = st.Poses
			v.Script = st.Script
		} else if st.ImageURL != "" {
			v.SilhouetteURL, _ = model.EnsureSilhouette(st.ImageURL)
		}
		views = append(views, v)
	}
	systemPrompt := ""
	if state.Calls >= 1 {
		systemPrompt = ch.SystemPrompt
	}
	var backgrounds []model.CharacterBackground
	if state.Calls >= 1 {
		model.DB.Order("id ASC").Find(&backgrounds)
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"id": ch.Id, "model_name": ch.ModelName, "display_name": ch.DisplayName,
		"title": ch.Title, "description": ch.Description, "tags": ch.Tags,
		"system_prompt": systemPrompt,
		"max_stage":     state.MaxStage, "affinity": state.Affinity, "affinity_required": ch.AffinityRequired,
		"total_tokens": state.Tokens, "total_calls": state.Calls,
		"stages": views, "backgrounds": backgrounds,
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
	state, err := model.GetUserCharacterState(userId, &ch)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if stageIdx > state.MaxStage {
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
// （该路由走 UserAuth + Distribute，计费到当前用户），测试中可替换。
// 透传原始请求的 Authorization header 与会话 cookie，保证内部转发认证通过。
var characterChatForward = func(ctx context.Context, url string, src *http.Request, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if auth := src.Header.Get("Authorization"); auth != "" {
		req.Header.Set("Authorization", auth)
	}
	for _, cookie := range src.Cookies() {
		req.AddCookie(cookie)
	}
	return characterChatHTTPClient.Do(req)
}

// UnlockCharacter 手动解锁角色阶段（顺序推进；需 calls>=1 且 token/好感双门槛达标）
func UnlockCharacter(c *gin.Context) {
	userId := c.GetInt("id")
	modelName := c.Param("modelName")
	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	var req struct {
		Stage int `json:"stage"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": "invalid request body"})
		return
	}
	state, err := model.GetUserCharacterState(userId, &ch)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	newMax, err := model.UnlockUserCharacterStage(userId, ch.ModelName, state, ch.AffinityRequired, ch.Stages(), req.Stage)
	switch {
	case errors.Is(err, model.ErrUnlockStageNotFound):
		c.JSON(200, gin.H{"success": false, "message": "阶段不存在"})
		return
	case errors.Is(err, model.ErrUnlockOutOfOrder):
		c.JSON(200, gin.H{"success": false, "message": "请先解锁前一阶段"})
		return
	case errors.Is(err, model.ErrUnlockNotEligible):
		c.JSON(200, gin.H{"success": false, "message": "解锁条件未满足：需要调用记录且 token/好感达标"})
		return
	case err != nil:
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"max_stage": newMax, "affinity": state.Affinity,
		"total_tokens": state.Tokens, "total_calls": state.Calls,
	}})
}
