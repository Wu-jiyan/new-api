package controller

import (
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// petStatusItem 一条需要用户注意的站点信息。
//
// Key 是英文源串，由前端 i18n 翻译；Params 只放原始数值/名称，金额与数量的格式化
// 全部交给前端按当前语言处理 —— 与项目「API 消息用英文源串、前端翻译」的约定一致，
// 也避免后端把某种语言的数字格式写死进响应。
type petStatusItem struct {
	Key      string         `json:"key"`
	Severity string         `json:"severity"`
	Params   map[string]any `json:"params"`
}

const (
	petSeverityInfo     = "info"
	petSeverityWarning  = "warning"
	petSeverityCritical = "critical"
)

// errorBurstWindow 错误突增的观察窗口（秒）。
const errorBurstWindow = time.Hour

// errorBurstThreshold 窗口内错误日志达到该条数才算「突增」：个别错误是噪声，
// 连着报错才值得打断用户。阈值低到能在真实故障时立刻反应，高到不会被单次失败打扰。
const errorBurstThreshold = 5

// expiredToken 视为已过期的边界：给时钟漂移留一分钟余量。
const expiredToken = 60

// GetCharacterPetStatus 汇总「用户自己数据」上需要主动告知的事情。
//
// 只读、只碰当前用户自己的行，不涉及任何跨用户或管理员数据 —— 桌宠不该有能力
// 探查站点其它部分的状态。返回空列表是正常情况，不代表出错。
func GetCharacterPetStatus(c *gin.Context) {
	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	setting := user.GetSetting()

	items := make([]petStatusItem, 0, 4)

	quota, err := model.GetUserQuota(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// A configured 0 is a real value, not "unset": read the threshold without
	// an `|| fallback` that would swallow it.
	if quota <= 0 {
		items = append(items, petStatusItem{
			Key:      "character.pet.status.quotaExhausted",
			Severity: petSeverityCritical,
			Params:   map[string]any{"quota": quota},
		})
	} else if threshold := setting.QuotaWarningThreshold; threshold > 0 && float64(quota) < threshold {
		items = append(items, petStatusItem{
			Key:      "character.pet.status.quotaLow",
			Severity: petSeverityWarning,
			Params:   map[string]any{"quota": quota, "threshold": threshold},
		})
	}

	var tokens []model.Token
	if err := model.DB.Where("user_id = ?", userId).Find(&tokens).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	now := common.GetTimestamp()
	exhausted, expired := 0, 0
	for i := range tokens {
		if !tokens[i].UnlimitedQuota && tokens[i].RemainQuota <= 0 {
			exhausted++
		}
		if tokens[i].ExpiredTime > 0 && tokens[i].ExpiredTime+expiredToken < now {
			expired++
		}
	}
	if exhausted > 0 {
		items = append(items, petStatusItem{
			Key:      "character.pet.status.tokenExhausted",
			Severity: petSeverityWarning,
			Params:   map[string]any{"count": exhausted},
		})
	}
	if expired > 0 {
		items = append(items, petStatusItem{
			Key:      "character.pet.status.tokenExpired",
			Severity: petSeverityWarning,
			Params:   map[string]any{"count": expired},
		})
	}

	var errorCount int64
	if err := model.LOG_DB.Model(&model.Log{}).
		Where("user_id = ? AND type = ? AND created_at >= ?",
			userId, model.LogTypeError, now-int64(errorBurstWindow/time.Second)).
		Count(&errorCount).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if errorCount >= errorBurstThreshold {
		items = append(items, petStatusItem{
			Key:      "character.pet.status.errorBurst",
			Severity: petSeverityWarning,
			Params:   map[string]any{"count": errorCount, "threshold": errorBurstThreshold},
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items}})
}
