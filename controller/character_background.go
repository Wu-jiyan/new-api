package controller

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// globalBackgroundDefaultPrompt 全局背景生成默认提示词（无角色上下文时的兜底）
const globalBackgroundDefaultPrompt = "干净空旷的场景背景，柔和光影，无人物，无文字，元素分布均匀便于任意裁切，细腻质感，日系动画背景风格"

// ListCharacterBackgrounds 用户端获取全局背景库（所有角色共用，台词按名引用）
func ListCharacterBackgrounds(c *gin.Context) {
	var list []model.CharacterBackground
	if err := model.DB.Order("id ASC").Find(&list).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": list})
}

// AdminListCharacterBackgrounds 后台背景库列表
func AdminListCharacterBackgrounds(c *gin.Context) {
	var list []model.CharacterBackground
	if err := model.DB.Order("id ASC").Find(&list).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": list})
}

// AdminUploadCharacterBackground 上传全局背景图（multipart: file + name）
func AdminUploadCharacterBackground(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "缺少图片文件"})
		return
	}
	if file.Size > maxCharacterImageBytes {
		c.JSON(200, gin.H{"success": false, "message": "图片过大（最大 8MB）"})
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
	name := c.PostForm("name")
	if name == "" {
		c.JSON(200, gin.H{"success": false, "message": "缺少背景名称"})
		return
	}
	url, err := model.SaveGlobalBackground(data)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	bg, err := upsertCharacterBackground(name, url)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": bg})
}

// AdminGenerateCharacterBackground 生成全局背景图（json: name + prompt）
func AdminGenerateCharacterBackground(c *gin.Context) {
	var req struct {
		Name   string `json:"name"`
		Prompt string `json:"prompt"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if req.Name == "" {
		c.JSON(200, gin.H{"success": false, "message": "缺少背景名称"})
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
		prompt = globalBackgroundDefaultPrompt
	}
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", *common.Port)
	payload, _ := common.Marshal(map[string]interface{}{
		"model":  imgModel,
		"prompt": prompt,
		"n":      1,
		"size":   "1536x1024",
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
	url, err := model.SaveGlobalBackground(imageData)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	bg, err := upsertCharacterBackground(req.Name, url)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": bg})
}

// AdminDeleteCharacterBackground 删除全局背景
func AdminDeleteCharacterBackground(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(200, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.DB.Delete(&model.CharacterBackground{}, "id = ?", id).Error; err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"success": true})
}

// upsertCharacterBackground 按名称新增/更新全局背景
func upsertCharacterBackground(name, url string) (*model.CharacterBackground, error) {
	var bg model.CharacterBackground
	err := model.DB.Where("name = ?", name).First(&bg).Error
	if err == nil {
		bg.ImageURL = url
		bg.UpdatedAt = common.GetTimestamp()
		if err := model.DB.Save(&bg).Error; err != nil {
			return nil, err
		}
		return &bg, nil
	}
	now := common.GetTimestamp()
	bg = model.CharacterBackground{Name: name, ImageURL: url, CreatedAt: now, UpdatedAt: now}
	if err := model.DB.Create(&bg).Error; err != nil {
		return nil, err
	}
	return &bg, nil
}
