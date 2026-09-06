package model

import (
	"github.com/QuantumNous/new-api/common"
)

const (
	OptionKeyCharacterThresholds = "character_stage_thresholds"
	OptionKeyCharacterImageModel = "character_image_model"
	OptionKeyCharacterImageGroup = "character_image_group"
	OptionKeyCharacterImageToken = "character_image_token"
)

// CharacterStageThresholds 全局阶段阈值（token）
type CharacterStageThresholds struct {
	Stage2Tokens int64 `json:"stage2_tokens"`
	Stage3Tokens int64 `json:"stage3_tokens"`
}

var characterStageThresholdsDefault = CharacterStageThresholds{Stage2Tokens: 10000000, Stage3Tokens: 50000000}

// CharacterStageThresholdsValue 当前生效的全局阈值（进程内缓存）
var CharacterStageThresholdsValue = characterStageThresholdsDefault

// ReloadCharacterStageThresholds 从选项表重新加载阈值
func ReloadCharacterStageThresholds() {
	common.OptionMapRWMutex.RLock()
	str, ok := common.OptionMap[OptionKeyCharacterThresholds]
	common.OptionMapRWMutex.RUnlock()
	if !ok || str == "" {
		CharacterStageThresholdsValue = characterStageThresholdsDefault
		return
	}
	t := characterStageThresholdsDefault
	if err := common.Unmarshal([]byte(str), &t); err == nil && t.Stage2Tokens >= 0 && t.Stage3Tokens >= t.Stage2Tokens {
		CharacterStageThresholdsValue = t
	}
}

// GetCharacterOption 读取角色系统字符串配置
func GetCharacterOption(key string) string {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap[key]
}
