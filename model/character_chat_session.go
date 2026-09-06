package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	CharacterChatWindowSize = 40 // 每轮组装携带的最近消息条数
	CharacterChatSummaryGap = 60 // message_count - summary_through 达到该值触发摘要
)

// CharacterChatSession 用户与某角色的单线对话会话（user_id+model_name 联合唯一）
type CharacterChatSession struct {
	Id             int    `json:"id"`
	UserId         int    `json:"user_id" gorm:"uniqueIndex:idx_sess_user_model;not null"`
	ModelName      string `json:"model_name" gorm:"size:128;uniqueIndex:idx_sess_user_model;not null"`
	Model          string `json:"model" gorm:"size:128"` // 会话选定的具体对话模型（前缀内）
	Group          string `json:"group" gorm:"size:64"`  // 会话选定的分组（空=用户默认）
	StageIndex     int    `json:"stage_index" gorm:"default:0"`
	InitialContext string `json:"initial_context" gorm:"type:text"` // 小剧场带入剧情（一次性固定携带）
	Summary        string `json:"summary" gorm:"type:text"`         // 早期记忆滚动摘要
	MessageCount   int    `json:"message_count" gorm:"default:0"`
	SummaryThrough int    `json:"summary_through" gorm:"default:0"` // 摘要水位（已并入 summary 的消息条数）
	LastMessageAt  int64  `json:"last_message_at" gorm:"bigint"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt      int64  `json:"updated_at" gorm:"bigint"`
}

// GetOrCreateCharacterChatSession 幂等获取/创建单线会话。新建时绑定 stageIndex；已存在则忽略入参。
func GetOrCreateCharacterChatSession(userId int, modelName string, stageIndex int) (*CharacterChatSession, error) {
	var s CharacterChatSession
	err := DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&s).Error
	if err == nil {
		return &s, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := common.GetTimestamp()
	s = CharacterChatSession{
		UserId: userId, ModelName: modelName, StageIndex: stageIndex,
		LastMessageAt: now, CreatedAt: now, UpdatedAt: now,
	}
	if err := DB.Create(&s).Error; err != nil {
		// 并发竞争唯一约束：回读既有行
		err2 := DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&s).Error
		if err2 != nil {
			return nil, err
		}
		return &s, nil
	}
	return &s, nil
}

// ForgetCharacterChat 「忘记她」：清除与某角色的全部对话进度、上下文与记忆（删除会话与消息），
// 并将好感度归零。不触碰已解锁阶段（max_stage）与 token/调用统计。
func ForgetCharacterChat(userId int, modelName string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND model_name = ?", userId, modelName).
			Delete(&CharacterChatMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND model_name = ?", userId, modelName).
			Delete(&CharacterChatSession{}).Error; err != nil {
			return err
		}
		return tx.Model(&UserCharacterProgress{}).
			Where("user_id = ? AND model_name = ?", userId, modelName).
			Updates(map[string]interface{}{"affinity": 0, "updated_at": common.GetTimestamp()}).Error
	})
}

// touchSession 消息落库后同步更新会话计数（对象内存与 DB 一致）
func touchSession(s *CharacterChatSession, addMsg bool) {
	now := common.GetTimestamp()
	s.UpdatedAt = now
	s.LastMessageAt = now
	if addMsg {
		s.MessageCount++
	}
	DB.Model(&CharacterChatSession{}).Where("id = ?", s.Id).
		Updates(map[string]interface{}{
			"message_count": s.MessageCount, "last_message_at": now, "updated_at": now,
		})
}
