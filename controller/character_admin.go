package controller

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
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
	if dm := strings.TrimSpace(req.DefaultModel); dm != "" && !strings.HasPrefix(dm, req.ModelName) {
		c.JSON(200, gin.H{"success": false, "message": "默认模型须匹配模型名前缀"})
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
		ModelName        string `json:"model_name"`
		DisplayName      string `json:"display_name"`
		Title            string `json:"title"`
		Description      string `json:"description"`
		Tags             string `json:"tags"`
		SystemPrompt     string `json:"system_prompt"`
		AffinityRequired *int   `json:"affinity_required"`
		DefaultModel     string `json:"default_model"`
		StagesJSON       string `json:"stages_json"`
		Enabled          *bool  `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	updates := map[string]interface{}{
		"display_name": req.DisplayName, "title": req.Title, "description": req.Description,
		"tags": req.Tags, "system_prompt": req.SystemPrompt, "updated_at": common.GetTimestamp(),
	}
	// 默认对话模型：空=不指定；非空须匹配（更新后的）model_name 前缀
	effectiveModelName := req.ModelName
	if effectiveModelName == "" {
		if err := model.DB.Model(&model.Character{}).Select("model_name").
			Where("id = ?", id).Row().Scan(&effectiveModelName); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
	}
	defaultModel := strings.TrimSpace(req.DefaultModel)
	if defaultModel != "" && !strings.HasPrefix(defaultModel, effectiveModelName) {
		c.JSON(200, gin.H{"success": false, "message": "默认模型须匹配模型名前缀"})
		return
	}
	updates["default_model"] = defaultModel
	if req.ModelName != "" {
		var cnt int64
		if err := model.DB.Model(&model.Character{}).
			Where("model_name = ? AND id != ?", req.ModelName, id).Count(&cnt).Error; err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		if cnt > 0 {
			c.JSON(200, gin.H{"success": false, "message": "该模型已存在角色配置"})
			return
		}
		updates["model_name"] = req.ModelName
	}
	if req.StagesJSON != "" {
		var stages model.CharacterStages
		if err := common.Unmarshal([]byte(req.StagesJSON), &stages); err != nil {
			c.JSON(200, gin.H{"success": false, "message": "stages_json 格式错误"})
			return
		}
		updates["stages_json"] = req.StagesJSON
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}
	if req.AffinityRequired != nil {
		updates["affinity_required"] = *req.AffinityRequired
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
	data, _ := common.Marshal(req)
	if err := model.UpdateOption(model.OptionKeyCharacterThresholds, string(data)); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.ReloadCharacterStageThresholds()
	c.JSON(200, gin.H{"success": true, "data": model.CharacterStageThresholdsValue})
}

// AdminUploadCharacterImage 手动上传角色素材（multipart: file + type[portrait/background/pose] + pose_name）
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
	assetType := c.PostForm("type")
	if assetType == "" {
		assetType = "portrait"
	}
	switch assetType {
	case "background":
		url, _, err := model.SaveCharacterAsset(ch.ModelName, stage, "bg", data)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := updateCharacterStageBackground(&ch, stage, url); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"background_url": url}})
		return
	case "pose":
		poseName := c.PostForm("pose_name")
		if poseName == "" {
			c.JSON(200, gin.H{"success": false, "message": "缺少 pose_name 字段"})
			return
		}
		url, _, err := model.SaveCharacterAsset(ch.ModelName, stage, "poses/"+poseName, data)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := updateCharacterStagePose(&ch, stage, poseName, url); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"pose_name": poseName, "image_url": url}})
		return
	default: // portrait
		url, _, err := model.SaveCharacterImage(ch.ModelName, stage, data)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := updateCharacterStageImage(&ch, stage, url); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"image_url": url}})
		return
	}
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
		Prompt     string `json:"prompt"`
		Style      string `json:"style"`
		Type       string `json:"type"`        // portrait/background/pose
		PoseName   string `json:"pose_name"`   // type=pose 时必填
		PosePrompt string `json:"pose_prompt"` // 姿态描述（生成提示词用，可选）
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	assetType := req.Type
	if assetType == "" {
		assetType = "portrait"
	}
	if assetType == "pose" && req.PoseName == "" {
		c.JSON(200, gin.H{"success": false, "message": "缺少 pose_name 字段"})
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
		prompt = buildCharacterImagePrompt(&ch, stage, assetType, req.PoseName, req.PosePrompt)
	}
	if req.Style != "" {
		prompt = req.Style + "。" + prompt
	}

	imgSize := "1024x1536"
	if assetType == "background" {
		imgSize = "1536x1024"
	}
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", *common.Port)
	payload, _ := common.Marshal(map[string]interface{}{
		"model":  imgModel,
		"prompt": prompt,
		"n":      1,
		"size":   imgSize,
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
	if err := common.Unmarshal(body, &gen); err != nil || len(gen.Data) == 0 {
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
	switch assetType {
	case "background":
		url, _, err := model.SaveCharacterAsset(ch.ModelName, stage, "bg", imageData)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := updateCharacterStageBackground(&ch, stage, url); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"background_url": url}})
		return
	case "pose":
		url, _, err := model.SaveCharacterAsset(ch.ModelName, stage, "poses/"+req.PoseName, imageData)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := updateCharacterStagePose(&ch, stage, req.PoseName, url); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"pose_name": req.PoseName, "image_url": url}})
		return
	default: // portrait
		url, _, err := model.SaveCharacterImage(ch.ModelName, stage, imageData)
		if err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		if err := updateCharacterStageImage(&ch, stage, url); err != nil {
			c.JSON(200, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(200, gin.H{"success": true, "data": gin.H{"image_url": url}})
		return
	}
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

// buildCharacterImagePrompt 按素材类型组装生图提示词
func buildCharacterImagePrompt(ch *model.Character, stage int, assetType, poseName, posePrompt string) string {
	switch assetType {
	case "background":
		return buildCharacterBackgroundPrompt(ch)
	case "pose":
		return buildCharacterPosePrompt(ch, stage, poseName, posePrompt)
	default:
		return buildCharacterPortraitPrompt(ch, stage)
	}
}

// buildCharacterPortraitPrompt 展示立绘提示词（完整画面，含氛围背景）
func buildCharacterPortraitPrompt(ch *model.Character, stage int) string {
	stageName := "初遇"
	switch stage {
	case 1:
		stageName = "同行"
	case 2:
		stageName = "羁绊"
	}
	return fmt.Sprintf("日本动漫美少女立绘，角色名：%s，称号：%s，人设：%s，阶段：%s，全身像，竖版构图，精致细节", ch.DisplayName, ch.Title, ch.Description, stageName)
}

// buildCharacterBackgroundPrompt 剧情空白背景提示词：无人物/文字/比例敏感元素，适配多分辨率裁切
func buildCharacterBackgroundPrompt(ch *model.Character) string {
	style := ch.Title
	if style == "" {
		style = ch.Description
	}
	return fmt.Sprintf("干净的空场景背景，适合作为动漫美少女角色立绘的场景，风格与角色（%s：%s）一致，无人物，无文字，无标志性物体，元素均匀分布可任意裁切，柔和光影氛围，横向构图", ch.DisplayName, style)
}

// posePromptOf 姿态名的简单语义映射（生成提示词用）
func posePromptOf(poseName string) string {
	switch poseName {
	case "normal":
		return "平静站立，双手自然下垂，表情温和"
	case "happy":
		return "开心微笑，微微挥手，表情明朗"
	case "shy":
		return "害羞低头，脸颊微红，目光躲闪"
	case "sad":
		return "低落垂眸，神情忧郁"
	case "angry":
		return "生气叉腰，眉头微皱"
	case "surprised":
		return "惊讶睁大眼睛，捂嘴"
	default:
		return "自然站姿，表情柔和"
	}
}

// buildCharacterPosePrompt 剧情姿态立绘提示词：透明背景、光影与背景一致
func buildCharacterPosePrompt(ch *model.Character, stage int, poseName, posePrompt string) string {
	if posePrompt == "" {
		posePrompt = posePromptOf(poseName)
	}
	stageName := "初遇"
	switch stage {
	case 1:
		stageName = "同行"
	case 2:
		stageName = "羁绊"
	}
	return fmt.Sprintf("日本动漫美少女立绘，角色名：%s，称号：%s，人设：%s，阶段：%s，全身像，动作表情：%s，纯透明背景 PNG，不要背景不要地面不要任何场景元素，人物完整，竖版构图，光影柔和与场景背景一致", ch.DisplayName, ch.Title, ch.Description, stageName, posePrompt)
}

// updateCharacterStageBackground 更新阶段剧情背景 URL 并持久化
func updateCharacterStageBackground(ch *model.Character, stage int, url string) error {
	stages := ch.Stages()
	if stage >= len(stages.Stages) {
		return fmt.Errorf("阶段不存在")
	}
	stages.Stages[stage].BackgroundURL = url
	if err := ch.SetStages(stages); err != nil {
		return err
	}
	return model.DB.Model(&model.Character{}).Where("id = ?", ch.Id).
		Updates(map[string]interface{}{"stages_json": ch.StagesJSON, "updated_at": common.GetTimestamp()}).Error
}

// updateCharacterStagePose 更新/追加阶段姿态立绘（同名覆盖）并持久化
func updateCharacterStagePose(ch *model.Character, stage int, poseName, url string) error {
	stages := ch.Stages()
	if stage >= len(stages.Stages) {
		return fmt.Errorf("阶段不存在")
	}
	poses := stages.Stages[stage].Poses
	found := false
	for i := range poses {
		if poses[i].Name == poseName {
			poses[i].ImageURL = url
			found = true
			break
		}
	}
	if !found {
		poses = append(poses, model.CharacterPose{Name: poseName, ImageURL: url})
	}
	stages.Stages[stage].Poses = poses
	if err := ch.SetStages(stages); err != nil {
		return err
	}
	return model.DB.Model(&model.Character{}).Where("id = ?", ch.Id).
		Updates(map[string]interface{}{"stages_json": ch.StagesJSON, "updated_at": common.GetTimestamp()}).Error
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
