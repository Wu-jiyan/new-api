package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestClampAffinityDelta(t *testing.T) {
	require.Equal(t, 3, ClampAffinityDelta(99))
	require.Equal(t, -3, ClampAffinityDelta(-99))
	require.Equal(t, 1, ClampAffinityDelta(1))
	require.Equal(t, 0, ClampAffinityDelta(0))
}

func TestApplyCharacterAffinityDelta(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&CharacterChatSession{}, &CharacterChatMessage{}, &UserCharacterProgress{}))
	require.NoError(t, DB.Create(&UserCharacterProgress{UserID: 424150, ModelName: "deepseek", Affinity: 50}).Error)
	s, err := GetOrCreateCharacterChatSession(424150, "deepseek", 0)
	require.NoError(t, err)
	now := common.GetTimestamp()

	applied, err := ApplyCharacterAffinityDelta(s.Id, 424150, "deepseek", 2, now)
	require.NoError(t, err)
	require.Equal(t, 2, applied)
	var p UserCharacterProgress
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", 424150, "deepseek").First(&p).Error)
	require.Equal(t, 52, p.Affinity)
	// 落一条已应用 delta 供护栏统计
	require.NoError(t, DB.Create(&CharacterChatMessage{SessionId: s.Id, UserId: 424150, ModelName: "deepseek", Role: "assistant", AffinityDelta: applied, CreatedAt: now}).Error)
}

func TestApplyCharacterAffinityDeltaHourGuard(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&CharacterChatSession{}, &CharacterChatMessage{}, &UserCharacterProgress{}))
	require.NoError(t, DB.Create(&UserCharacterProgress{UserID: 424151, ModelName: "deepseek", Affinity: 50}).Error)
	s, err := GetOrCreateCharacterChatSession(424151, "deepseek", 0)
	require.NoError(t, err)
	now := common.GetTimestamp()
	// 近 1 小时已应用 +9
	require.NoError(t, DB.Create(&CharacterChatMessage{SessionId: s.Id, UserId: 424151, ModelName: "deepseek", Role: "assistant", AffinityDelta: 9, CreatedAt: now - 1000}).Error)
	// 再 +3 -> |9+3|=12 > 10 -> 丢弃
	applied, err := ApplyCharacterAffinityDelta(s.Id, 424151, "deepseek", 3, now)
	require.NoError(t, err)
	require.Equal(t, 0, applied)
	var p UserCharacterProgress
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", 424151, "deepseek").First(&p).Error)
	require.Equal(t, 50, p.Affinity) // 未变
}

func TestApplyCharacterAffinityDeltaCapsAt100(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&CharacterChatSession{}, &CharacterChatMessage{}, &UserCharacterProgress{}))
	require.NoError(t, DB.Create(&UserCharacterProgress{UserID: 424152, ModelName: "deepseek", Affinity: 99}).Error)
	s, err := GetOrCreateCharacterChatSession(424152, "deepseek", 0)
	require.NoError(t, err)
	applied, err := ApplyCharacterAffinityDelta(s.Id, 424152, "deepseek", 3, common.GetTimestamp())
	require.NoError(t, err)
	require.Equal(t, 3, applied)
	var p UserCharacterProgress
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", 424152, "deepseek").First(&p).Error)
	require.Equal(t, 100, p.Affinity) // 封顶
}
