package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const maxCharacterImageBytes = 8 << 20 // 8MB

// AdminListCharacters 角色列表
func AdminListCharacters(c *gin.Context) {
	keyword := c.Query("keyword")
	db := model.DB.Model(&model.Character{})
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("model_name LIKE ? OR display_name LIKE ?", like, like)
	}
	var list []*model.Character
	if err := db.Order("id DESC").Find(&list).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": list})
}

// AdminCreateCharacter 创建角色；未指定阶段时按全局阈值生成三阶段默认。
func AdminCreateCharacter(c *gin.Context) {
	var req model.Character
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if req.ModelName == "" {
		c.JSON(200, gin.H{"success": false, "message": "model_name 不能为空"})
		return
	}
	var cnt int64
	if err := model.DB.Model(&model.Character{}).Where("model_name = ?", req.ModelName).Count(&cnt).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if cnt > 0 {
		c.JSON(200, gin.H{"success": false, "message": "该模型已存在角色配置"})
		return
	}
	if req.StagesJSON == "" {
		if err := req.SetStages(model.DefaultCharacterStages()); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
	}
	req.CreatedAt = common.GetTimestamp()
	req.UpdatedAt = common.GetTimestamp()
	if err := model.DB.Create(&req).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": req})
}

// AdminUpdateCharacter 更新角色；StagesJSON 前端全量提交。
func AdminUpdateCharacter(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req struct {
		DisplayName  string `json:"display_name"`
		Title        string `json:"title"`
		Description  string `json:"description"`
		Tags         string `json:"tags"`
		SystemPrompt string `json:"system_prompt"`
		StagesJSON   string `json:"stages_json"`
		Enabled      *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	updates := map[string]interface{}{
		"display_name": req.DisplayName, "title": req.Title, "description": req.Description,
		"tags": req.Tags, "system_prompt": req.SystemPrompt, "updated_at": common.GetTimestamp(),
	}
	if req.StagesJSON != "" {
		var stages model.CharacterStages
		if err := json.Unmarshal([]byte(req.StagesJSON), &stages); err != nil {
			c.JSON(200, gin.H{"success": false, "message": "stages_json 格式错误"})
			return
		}
		updates["stages_json"] = req.StagesJSON
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if err := model.DB.Model(&model.Character{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// AdminDeleteCharacter 删除角色
func AdminDeleteCharacter(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.DB.Delete(&model.Character{}, id).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// AdminUpdateCharacterThresholds 更新全局阈值
func AdminUpdateCharacterThresholds(c *gin.Context) {
	var req model.CharacterStageThresholds
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if req.Stage2Tokens < 0 || req.Stage3Tokens < req.Stage2Tokens {
		c.JSON(200, gin.H{"success": false, "message": "阈值必须满足 0 <= stage2 <= stage3"})
		return
	}
	data, _ := json.Marshal(req)
	if err := model.UpdateOption(model.OptionKeyCharacterThresholds, string(data)); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.ReloadCharacterStageThresholds()
	c.JSON(200, gin.H{"success": true, "data": model.CharacterStageThresholdsValue})
}

// AdminUploadCharacterImage 手动上传立绘（multipart: file）
func AdminUploadCharacterImage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "invalid id"})
		return
	}
	stage, err := strconv.Atoi(c.Param("index"))
	if err != nil || stage < 0 || stage > 2 {
		c.JSON(200, gin.H{"success": false, "message": "invalid stage index"})
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "缺少 file 字段"})
		return
	}
	if file.Size > maxCharacterImageBytes {
		c.JSON(200, gin.H{"success": false, "message": "图片过大（上限 8MB）"})
		return
	}
	src, err := file.Open()
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	defer src.Close()
	data, err := io.ReadAll(io.LimitReader(src, maxCharacterImageBytes))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	var ch model.Character
	if err := model.DB.First(&ch, id).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	url, err := model.SaveCharacterImage(ch.ModelName, stage, data)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := updateCharacterStageImage(&ch, stage, url); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"image_url": url}})
}

// AdminGenerateCharacterImage AI 生成立绘：内部调用平台自身 /v1/images/generations。
func AdminGenerateCharacterImage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "invalid id"})
		return
	}
	stage, err := strconv.Atoi(c.Param("index"))
	if err != nil || stage < 0 || stage > 2 {
		c.JSON(200, gin.H{"success": false, "message": "invalid stage index"})
		return
	}
	var req struct {
		Prompt string `json:"prompt"`
		Style  string `json:"style"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	var ch model.Character
	if err := model.DB.First(&ch, id).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	token := model.GetCharacterOption(model.OptionKeyCharacterImageToken)
	if token == "" {
		c.JSON(200, gin.H{"success": false, "message": "未配置生图令牌（character_image_token）"})
		return
	}
	imgModel := model.GetCharacterOption(model.OptionKeyCharacterImageModel)
	if imgModel == "" {
		imgModel = "gpt-image-1"
	}
	prompt := req.Prompt
	if prompt == "" {
		prompt = buildCharacterImagePrompt(&ch, stage)
	}
	if req.Style != "" {
		prompt = req.Style + "。" + prompt
	}

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", *common.Port)
	payload, _ := json.Marshal(map[string]interface{}{
		"model":  imgModel,
		"prompt": prompt,
		"n":      1,
		"size":   "1024x1536",
	})
	httpReq, err := http.NewRequest(http.MethodPost, baseURL+"/v1/images/generations", bytes.NewReader(payload))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "生图请求失败: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if resp.StatusCode != http.StatusOK {
		c.JSON(200, gin.H{"success": false, "message": "生图失败(" + strconv.Itoa(resp.StatusCode) + "): " + string(body)})
		return
	}
	var gen struct {
		Data []struct {
			URL     string `json:"url"`
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &gen); err != nil || len(gen.Data) == 0 {
		c.JSON(200, gin.H{"success": false, "message": "生图响应解析失败"})
		return
	}
	var imageData []byte
	switch {
	case gen.Data[0].B64JSON != "":
		imageData, err = base64.StdEncoding.DecodeString(gen.Data[0].B64JSON)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": "生图数据解码失败"})
			return
		}
	case gen.Data[0].URL != "":
		imageData, err = downloadImage(gen.Data[0].URL)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": "下载生图结果失败: " + err.Error()})
			return
		}
	default:
		c.JSON(200, gin.H{"success": false, "message": "生图响应缺少图片数据"})
		return
	}
	url, err := model.SaveCharacterImage(ch.ModelName, stage, imageData)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := updateCharacterStageImage(&ch, stage, url); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"image_url": url}})
}

// AdminSaveCharacterScript 保存某阶段小剧场剧本
func AdminSaveCharacterScript(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "invalid id"})
		return
	}
	stage, err := strconv.Atoi(c.Param("index"))
	if err != nil || stage < 0 || stage > 2 {
		c.JSON(200, gin.H{"success": false, "message": "invalid stage index"})
		return
	}
	var req struct {
		Script []model.CharacterScript `json:"script"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	var ch model.Character
	if err := model.DB.First(&ch, id).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": "角色不存在"})
		return
	}
	stages := ch.Stages()
	if stage >= len(stages.Stages) {
		c.JSON(200, gin.H{"success": false, "message": "阶段不存在"})
		return
	}
	stages.Stages[stage].Script = req.Script
	if err := ch.SetStages(stages); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.DB.Model(&model.Character{}).Where("id = ?", id).
		Updates(map[string]interface{}{"stages_json": ch.StagesJSON, "updated_at": common.GetTimestamp()}).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// updateCharacterStageImage 更新角色某阶段立绘 URL 并持久化
func updateCharacterStageImage(ch *model.Character, stage int, url string) error {
	stages := ch.Stages()
	if stage >= len(stages.Stages) {
		return fmt.Errorf("阶段不存在")
	}
	stages.Stages[stage].ImageURL = url
	if err := ch.SetStages(stages); err != nil {
		return err
	}
	return model.DB.Model(&model.Character{}).Where("id = ?", ch.Id).
		Updates(map[string]interface{}{"stages_json": ch.StagesJSON, "updated_at": common.GetTimestamp()}).Error
}

// buildCharacterImagePrompt 基于角色人设自动组装生图提示词
func buildCharacterImagePrompt(ch *model.Character, stage int) string {
	stageName := "初遇"
	switch stage {
	case 1:
		stageName = "同行"
	case 2:
		stageName = "羁绊"
	}
	return fmt.Sprintf("日本动漫美少女立绘，角色名：%s，称号：%s，人设：%s，阶段：%s，全身像，竖版构图，精致细节", ch.DisplayName, ch.Title, ch.Description, stageName)
}

// downloadImage 下载远端图片（生图返回 url 时）
func downloadImage(url string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxCharacterImageBytes))
}
