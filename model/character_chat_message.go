package model

import (
	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// CharacterChatVisual assistant 消息的可选视觉冗余字段（user 消息恒为空）
type CharacterChatVisual struct {
	Pose       string
	Effect     string
	Background string
}

// CharacterChatMessage 单条对话消息（content 仅存纯台词文本）
type CharacterChatMessage struct {
	Id            int    `json:"id"`
	SessionId     int    `json:"session_id" gorm:"index"`
	UserId        int    `json:"user_id" gorm:"index"`
	ModelName     string `json:"model_name" gorm:"size:128"`
	Role          string `json:"role" gorm:"size:16"`
	Content       string `json:"content" gorm:"type:text"`
	Pose          string `json:"pose,omitempty" gorm:"size:64"`
	Effect        string `json:"effect,omitempty" gorm:"size:16"`
	Background    string `json:"background,omitempty" gorm:"size:64"`
	AffinityDelta int    `json:"affinity_delta" gorm:"default:0"`
	ChoicesJSON   string                `json:"-" gorm:"type:text"`          // assistant 回复携带的回答选项（JSON 数组）
	Choices       []CharacterChatChoice `json:"choices,omitempty" gorm:"-"`  // AfterFind 回填
	CreatedAt     int64  `json:"created_at" gorm:"bigint"`
}

// AfterFind 把 ChoicesJSON 回填为结构化 Choices（解析失败静默为空）
func (m *CharacterChatMessage) AfterFind(*gorm.DB) error {
	if m.ChoicesJSON != "" {
		_ = common.Unmarshal([]byte(m.ChoicesJSON), &m.Choices)
	}
	return nil
}

func AddCharacterChatUserMessage(s *CharacterChatSession, content string) (*CharacterChatMessage, error) {
	m := &CharacterChatMessage{
		SessionId: s.Id, UserId: s.UserId, ModelName: s.ModelName,
		Role: "user", Content: content, CreatedAt: common.GetTimestamp(),
	}
	if err := DB.Create(m).Error; err != nil {
		return nil, err
	}
	touchSession(s, true)
	return m, nil
}

// RemoveCharacterChatUserMessage 回滚刚落库的 user 消息并回退会话消息计数。
// 用于上游转发失败：历史不留无应答的孤行，前端重试不会造成重复 user 消息。
func RemoveCharacterChatUserMessage(s *CharacterChatSession, m *CharacterChatMessage) {
	if m == nil || m.Id == 0 {
		return
	}
	if err := DB.Delete(&CharacterChatMessage{}, "id = ?", m.Id).Error; err != nil {
		return
	}
	if s.MessageCount > 0 {
		s.MessageCount--
	}
	touchSession(s, false)
}

func AddCharacterChatAssistantMessage(s *CharacterChatSession, content string, visual CharacterChatVisual, delta int, choices []CharacterChatChoice) (*CharacterChatMessage, error) {
	choicesJSON := ""
	if len(choices) > 0 {
		if data, err := common.Marshal(choices); err == nil {
			choicesJSON = string(data)
		}
	}
	m := &CharacterChatMessage{
		SessionId: s.Id, UserId: s.UserId, ModelName: s.ModelName,
		Role: "assistant", Content: content,
		Pose: visual.Pose, Effect: visual.Effect, Background: visual.Background,
		AffinityDelta: delta, ChoicesJSON: choicesJSON, CreatedAt: common.GetTimestamp(),
	}
	if err := DB.Create(m).Error; err != nil {
		return nil, err
	}
	touchSession(s, true)
	return m, nil
}

// ListRecentCharacterChatMessages 返回某会话最近 limit 条（升序，id 越大越新）
func ListRecentCharacterChatMessages(sessionId int, limit int) ([]CharacterChatMessage, error) {
	var list []CharacterChatMessage
	err := DB.Where("session_id = ?", sessionId).Order("id DESC").Limit(limit).Find(&list).Error
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
		list[i], list[j] = list[j], list[i]
	}
	return list, nil
}

// ListRecentCharacterChatMessagesSince 返回 id > afterId 的最新 limit 条（升序）——摘要待归档段读取
func ListRecentCharacterChatMessagesSince(sessionId int, afterId int, limit int) ([]CharacterChatMessage, error) {
	var list []CharacterChatMessage
	err := DB.Where("session_id = ? AND id > ?", sessionId, afterId).Order("id DESC").Limit(limit).Find(&list).Error
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
		list[i], list[j] = list[j], list[i]
	}
	return list, nil
}

// ListCharacterChatMessagesPaged 倒序分页：cursorId>0 取 id<cursorId 的最新 limit 条；否则取最新 limit 条。
// 返回升序列表与 hasMore（更旧消息是否还有）。
func ListCharacterChatMessagesPaged(sessionId int, cursorId int, limit int) ([]CharacterChatMessage, bool, error) {
	q := DB.Where("session_id = ?", sessionId)
	if cursorId > 0 {
		q = q.Where("id < ?", cursorId)
	}
	var rows []CharacterChatMessage
	if err := q.Order("id DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	return rows, hasMore, nil
}

// HourlyAffinityDeltaSum 会话最近 1 小时已应用好感 delta 之和（小时护栏输入）。
// created_at 为 Unix 秒（common.GetTimestamp），窗口即 now-3600 秒。
func HourlyAffinityDeltaSum(sessionId int, now int64) (int, error) {
	var sum int
	err := DB.Model(&CharacterChatMessage{}).
		Where("session_id = ? AND role = ? AND affinity_delta <> 0 AND created_at >= ?", sessionId, "assistant", now-3600).
		Select("COALESCE(SUM(affinity_delta), 0)").Scan(&sum).Error
	return sum, err
}
