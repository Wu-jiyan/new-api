package model

import (
	"encoding/json"
)

// CharacterPose 剧情姿态立绘（透明背景，对话行按 name 引用）
type CharacterPose struct {
	Name     string `json:"name"`
	ImageURL string `json:"image_url"`
}

// CharacterChoice 剧情回答选项（简单分支：选中后播放 Reply，随后回到主线）
type CharacterChoice struct {
	Text       string `json:"text"`                 // 选项按钮文案
	Reply      string `json:"reply"`                // 选中后的回应台词
	Pose       string `json:"pose,omitempty"`       // 回应时姿态
	Effect     string `json:"effect,omitempty"`     // 回应时过渡效果
	Background string `json:"background,omitempty"` // 回应时背景（引用全局背景库名称）
}

// CharacterScript 小剧场剧本台词（逐句播放）
type CharacterScript struct {
	Speaker    string            `json:"speaker"`
	Text       string            `json:"text"`
	Pose       string            `json:"pose,omitempty"`       // 本句姿态（引用 CharacterPose.Name）
	Effect     string            `json:"effect,omitempty"`     // 本句过渡效果（覆盖阶段默认）
	Background string            `json:"background,omitempty"` // 本句背景（引用全局背景库名称）
	Choices    []CharacterChoice `json:"choices,omitempty"`    // 回答选项（可选）
}

// CharacterStage 角色单个阶段配置
type CharacterStage struct {
	Index            int               `json:"index"`
	Name             string            `json:"name"`                        // 阶段名：初遇/同行/羁绊
	ImageURL         string            `json:"image_url"`                   // 展示立绘相对路径 /uploads/characters/...
	BackgroundURL    string            `json:"background_url,omitempty"`    // 剧情默认背景（可裁切适配多分辨率）
	DefaultEffect    string            `json:"default_effect,omitempty"`    // 阶段默认过渡：fade/black/white
	Poses            []CharacterPose   `json:"poses,omitempty"`             // 多姿态透明立绘
	AffinityRequired int               `json:"affinity_required,omitempty"` // 该阶段解锁所需好感（0=不要求）
	UnlockTokens     int64             `json:"unlock_tokens"`               // 解锁所需累计 token（0=首次调用）
	UnlockText       string            `json:"unlock_text"`                 // 未解锁时的文案提示
	Script           []CharacterScript `json:"script"`
}

// CharacterStages 三阶段配置容器
type CharacterStages struct {
	Stages []CharacterStage `json:"stages"`
}

// Character 角色配置（1:1 绑定模型名）
type Character struct {
	Id               int    `json:"id"`
	ModelName        string `json:"model_name" gorm:"size:128;uniqueIndex;not null"`
	DisplayName      string `json:"display_name" gorm:"size:64"`
	Title            string `json:"title" gorm:"size:128"`
	Description      string `json:"description" gorm:"type:text"`
	Tags             string `json:"tags" gorm:"type:text"`
	SystemPrompt     string `json:"system_prompt" gorm:"type:text"`     // 二期对话人设
	AffinityRequired int    `json:"affinity_required" gorm:"default:0"` // 角色整体解锁所需好感（0=不要求）
	StagesJSON       string `json:"stages_json" gorm:"type:text"`
	Enabled          bool   `json:"enabled" gorm:"default:true"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt        int64  `json:"updated_at" gorm:"bigint"`
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
		{Index: 0, Name: "初遇", DefaultEffect: "fade", UnlockTokens: 0, UnlockText: "首次调用该模型即可解锁基础立绘"},
		{Index: 1, Name: "同行", DefaultEffect: "fade", UnlockTokens: th.Stage2Tokens, UnlockText: "累计消耗 10M tokens 解锁第二形象与剧情"},
		{Index: 2, Name: "羁绊", DefaultEffect: "fade", UnlockTokens: th.Stage3Tokens, UnlockText: "累计消耗 50M tokens 解锁最终形象与完整剧情"},
	}}
}
