package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestGetUserCharacterUsage(t *testing.T) {
	require.NoError(t, LOG_DB.AutoMigrate(&Log{}))
	modelName := "char-test-model"
	uid := 424242
	prefixClean := func() {
		require.NoError(t, LOG_DB.Where("user_id = ? AND model_name LIKE ?", uid, modelName+"%").Delete(&Log{}).Error)
	}
	prefixClean()
	t.Cleanup(prefixClean)
	now := common.GetTimestamp()
	logs := []*Log{
		{UserId: uid, ModelName: modelName, Type: LogTypeConsume, PromptTokens: 1000, CompletionTokens: 500, CreatedAt: now},
		{UserId: uid, ModelName: modelName, Type: LogTypeConsume, PromptTokens: 2000, CompletionTokens: 1000, CreatedAt: now},
		// 同前缀的其他模型名也应计入（前缀匹配）
		{UserId: uid, ModelName: modelName + "-suffix", Type: LogTypeConsume, PromptTokens: 500, CompletionTokens: 250, CreatedAt: now},
		{UserId: uid, ModelName: modelName, Type: LogTypeError, PromptTokens: 9999, CompletionTokens: 9999, CreatedAt: now},    // 不计
		{UserId: uid, ModelName: "other-model", Type: LogTypeConsume, PromptTokens: 9000, CompletionTokens: 0, CreatedAt: now}, // 不计
	}
	for _, l := range logs {
		require.NoError(t, LOG_DB.Create(l).Error)
	}

	tokens, calls, err := GetUserCharacterUsage(uid, modelName)
	require.NoError(t, err)
	require.Equal(t, int64(5250), tokens)
	require.Equal(t, int64(3), calls)
}

func TestRefreshUserCharacterProgress(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&UserCharacterProgress{}))
	uid := 424243
	require.NoError(t, DB.Where("user_id = ?", uid).Delete(&UserCharacterProgress{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Where("user_id = ?", uid).Delete(&UserCharacterProgress{}).Error)
	})

	stages := CharacterStages{Stages: []CharacterStage{
		{Index: 0, UnlockTokens: 0},
		{Index: 1, UnlockTokens: 10000000},
		{Index: 2, UnlockTokens: 50000000},
	}}

	// 从未调用 -> 未解锁（-1）
	m, err := RefreshUserCharacterProgress(uid, "m1", 0, 0, stages)
	require.NoError(t, err)
	require.Equal(t, -1, m)

	// 1 次调用、0 token -> 阶段0
	m, err = RefreshUserCharacterProgress(uid, "m1", 0, 1, stages)
	require.NoError(t, err)
	require.Equal(t, 0, m)

	// 边界：恰好 10M -> 阶段1
	m, err = RefreshUserCharacterProgress(uid, "m1", 10000000, 5, stages)
	require.NoError(t, err)
	require.Equal(t, 1, m)

	// 50M -> 阶段2
	m, err = RefreshUserCharacterProgress(uid, "m1", 50000000, 6, stages)
	require.NoError(t, err)
	require.Equal(t, 2, m)

	// 进度不回退
	m, err = RefreshUserCharacterProgress(uid, "m1", 0, 7, stages)
	require.NoError(t, err)
	require.Equal(t, 2, m)

	// 0 调用 -> 强制未解锁（清理历史误解锁数据）
	m, err = RefreshUserCharacterProgress(uid, "m1", 99999999, 0, stages)
	require.NoError(t, err)
	require.Equal(t, -1, m)
}

func TestUserCharacterProgressAffinityDefaults(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&UserCharacterProgress{}))
	uid := 424244
	require.NoError(t, DB.Where("user_id = ?", uid).Delete(&UserCharacterProgress{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Where("user_id = ?", uid).Delete(&UserCharacterProgress{}).Error)
	})
	p := UserCharacterProgress{UserID: uid, ModelName: "aff-model", MaxStage: -1}
	require.NoError(t, DB.Create(&p).Error)

	var got UserCharacterProgress
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", uid, "aff-model").First(&got).Error)
	require.Equal(t, 0, got.Affinity)
}

func TestGainAffinity(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&UserCharacterProgress{}))
	uid := 424245
	require.NoError(t, DB.Where("user_id = ?", uid).Delete(&UserCharacterProgress{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Where("user_id = ?", uid).Delete(&UserCharacterProgress{}).Error)
	})
	require.NoError(t, DB.Create(&UserCharacterProgress{UserID: uid, ModelName: "aff-model2", MaxStage: -1}).Error)

	require.NoError(t, GainAffinity(uid, "aff-model2", 30))
	require.NoError(t, GainAffinity(uid, "aff-model2", 50))
	var got UserCharacterProgress
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", uid, "aff-model2").First(&got).Error)
	require.Equal(t, 80, got.Affinity)

	require.NoError(t, GainAffinity(uid, "aff-model2", 50)) // 封顶 100
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", uid, "aff-model2").First(&got).Error)
	require.Equal(t, 100, got.Affinity)

	require.NoError(t, GainAffinity(uid, "aff-model2", -200)) // 下限 0
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", uid, "aff-model2").First(&got).Error)
	require.Equal(t, 0, got.Affinity)
}
