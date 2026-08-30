package controller

import (
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
