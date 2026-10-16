package controller

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// characterPetView 桌宠对外视图：只有"能显示出来"才算 active，
// 配置过期（角色被删/停用/清空桌宠图/用户已不再解锁）时退化为 inactive 而不是报错。
type characterPetView struct {
	Active      bool   `json:"active"`
	ModelName   string `json:"model_name,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
	ImageURL    string `json:"image_url,omitempty"`
}

// resolveCharacterPet 按用户设置解析当前桌宠；不可显示时返回 inactive 视图。
func resolveCharacterPet(userId int, modelName string) characterPetView {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return characterPetView{}
	}
	var ch model.Character
	if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
		return characterPetView{}
	}
	if ch.PetImageURL == "" {
		return characterPetView{}
	}
	state, err := model.GetUserCharacterState(userId, &ch)
	if err != nil || state.MaxStage < 0 {
		return characterPetView{}
	}
	return characterPetView{
		Active:      true,
		ModelName:   ch.ModelName,
		DisplayName: ch.DisplayName,
		ImageURL:    ch.PetImageURL,
	}
}

// GetCharacterPet 当前用户的桌宠设置（登录即可读，无需额外角色权限）。
func GetCharacterPet(c *gin.Context) {
	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": resolveCharacterPet(userId, user.GetSetting().PetCharacter)})
}

// SetCharacterPet 设置/清除当前用户的桌宠。model_name 为空表示收回桌宠。
// 校验三件事：角色存在且启用、有桌宠图、该用户已解锁——否则拒绝，
// 避免把无法渲染的角色写进设置，让全局挂件拿到一个空壳。
func SetCharacterPet(c *gin.Context) {
	var req struct {
		ModelName string `json:"model_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	modelName := strings.TrimSpace(req.ModelName)
	if modelName != "" {
		var ch model.Character
		if err := model.DB.Where("model_name = ? AND enabled = ?", modelName, true).First(&ch).Error; err != nil {
			common.ApiErrorT(c, "Character not found")
			return
		}
		if ch.PetImageURL == "" {
			common.ApiErrorT(c, "Character has no pet image")
			return
		}
		state, err := model.GetUserCharacterState(userId, &ch)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if state.MaxStage < 0 {
			common.ApiErrorT(c, "Character is locked")
			return
		}
	}

	setting := user.GetSetting()
	setting.PetCharacter = modelName
	if err := model.UpdateUserSetting(userId, setting); err != nil {
		common.ApiErrorT(c, "Update failed")
		return
	}
	common.ApiSuccessT(c, "Update successful", resolveCharacterPet(userId, modelName))
}

// AdminUploadCharacterPetImage 手动上传桌宠小图（multipart: file）。桌宠图与阶段无关，故不带 stage 参数。
func AdminUploadCharacterPetImage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	file, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorT(c, "Missing file field")
		return
	}
	if file.Size > maxCharacterImageBytes {
		common.ApiErrorT(c, "Image is too large (max 8MB)")
		return
	}
	src, err := file.Open()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	defer src.Close()
	data, err := io.ReadAll(io.LimitReader(src, maxCharacterImageBytes))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var ch model.Character
	if err := model.DB.First(&ch, id).Error; err != nil {
		common.ApiErrorT(c, "Character not found")
		return
	}
	url, err := model.SaveCharacterPetImage(ch.ModelName, data)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DB.Model(&model.Character{}).Where("id = ?", id).
		Updates(map[string]interface{}{"pet_image_url": url, "updated_at": common.GetTimestamp()}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Update successful", gin.H{"pet_image_url": url})
}

// AdminGenerateCharacterPetImage AI 生成桌宠小图：内部调用平台自身 /v1/images/generations。
func AdminGenerateCharacterPetImage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req struct {
		Prompt string `json:"prompt"`
		Style  string `json:"style"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	var ch model.Character
	if err := model.DB.First(&ch, id).Error; err != nil {
		common.ApiErrorT(c, "Character not found")
		return
	}
	token := model.GetCharacterOption(model.OptionKeyCharacterImageToken)
	if token == "" {
		common.ApiErrorT(c, "Character image token is not configured")
		return
	}
	imgModel := model.GetCharacterOption(model.OptionKeyCharacterImageModel)
	if imgModel == "" {
		imgModel = "gpt-image-1"
	}
	prompt := req.Prompt
	if prompt == "" {
		prompt = buildCharacterPetPrompt(&ch)
	}
	if req.Style != "" {
		prompt = req.Style + "。" + prompt
	}
	// 桌宠在页面上只有几十到一百多像素，用 1024x1024 出图即可，避免为看不见的分辨率付费。
	imageData, err := generateCharacterImageBytes(token, imgModel, prompt, "1024x1024")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	url, err := model.SaveCharacterPetImage(ch.ModelName, imageData)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DB.Model(&model.Character{}).Where("id = ?", id).
		Updates(map[string]interface{}{"pet_image_url": url, "updated_at": common.GetTimestamp()}).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Update successful", gin.H{"pet_image_url": url})
}

// buildCharacterPetPrompt 桌宠小图提示词：Q 版全身、透明底、正方形构图。
// 与剧情立绘的关键差别是 Q 版与正方形——桌宠要缩小到指甲盖大小还能认得出是谁。
func buildCharacterPetPrompt(ch *model.Character) string {
	style := ch.Title
	if style == "" {
		style = ch.Description
	}
	return "日本动漫 Q 版 chibi 角色，角色名：" + ch.DisplayName + "，称号：" + style +
		"，头身比二头身，全身站立，双手自然下垂，表情友好可爱，视线正对镜头，" +
		"纯透明背景 PNG，不要背景不要地面不要阴影不要文字不要边框，人物完整不裁切，四周留白，方形构图"
}
