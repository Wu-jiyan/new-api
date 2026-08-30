package model

import (
	"encoding/json"
)

// CharacterScript 小剧场剧本台词（逐句播放）
type CharacterScript struct {
	Speaker string `json:"speaker"`
	Text    string `json:"text"`
	Pose    string `json:"pose,omitempty"` // 预留：二期表情/多图切换
}

// CharacterStage 角色单个阶段配置
type CharacterStage struct {
	Index        int               `json:"index"`
	Name         string            `json:"name"`          // 阶段名：初遇/同行/羁绊
	ImageURL     string            `json:"image_url"`     // 立绘相对路径 /uploads/characters/...
	UnlockTokens int64             `json:"unlock_tokens"` // 解锁所需累计 token（0=首次调用）
	UnlockText   string            `json:"unlock_text"`   // 未解锁时的文案提示
	Script       []CharacterScript `json:"script"`
}

// CharacterStages 三阶段配置容器
type CharacterStages struct {
	Stages []CharacterStage `json:"stages"`
}

// Character 角色配置（1:1 绑定模型名）
type Character struct {
	Id           int    `json:"id"`
	ModelName    string `json:"model_name" gorm:"size:128;uniqueIndex;not null"`
	DisplayName  string `json:"display_name" gorm:"size:64"`
	Title        string `json:"title" gorm:"size:128"`
	Description  string `json:"description" gorm:"type:text"`
	Tags         string `json:"tags" gorm:"type:text"`
	SystemPrompt string `json:"system_prompt" gorm:"type:text"` // 二期对话人设
	StagesJSON   string `json:"-" gorm:"type:text"`
	Enabled      bool   `json:"enabled" gorm:"default:true"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint"`
}

// Stages 解析阶段配置（JSON 字段 -> 结构体）
func (c *Character) Stages() CharacterStages {
	var s CharacterStages
	if c.StagesJSON != "" {
		_ = json.Unmarshal([]byte(c.StagesJSON), &s)
	}
	return s
}

// SetStages 序列化阶段配置
func (c *Character) SetStages(s CharacterStages) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	c.StagesJSON = string(data)
	return nil
}

// DefaultCharacterStages 按全局阈值生成三阶段默认配置
func DefaultCharacterStages() CharacterStages {
	th := CharacterStageThresholdsValue
	return CharacterStages{Stages: []CharacterStage{
		{Index: 0, Name: "初遇", UnlockTokens: 0, UnlockText: "首次调用该模型即可解锁基础立绘"},
		{Index: 1, Name: "同行", UnlockTokens: th.Stage2Tokens, UnlockText: "累计消耗 10M tokens 解锁第二形象与剧情"},
		{Index: 2, Name: "羁绊", UnlockTokens: th.Stage3Tokens, UnlockText: "累计消耗 50M tokens 解锁最终形象与完整剧情"},
	}}
}
