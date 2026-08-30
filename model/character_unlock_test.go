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
	require.NoError(t, LOG_DB.Where("user_id = ? AND model_name = ?", uid, modelName).Delete(&Log{}).Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Where("user_id = ? AND model_name = ?", uid, modelName).Delete(&Log{}).Error)
	})
	now := common.GetTimestamp()
	logs := []*Log{
		{UserId: uid, ModelName: modelName, Type: LogTypeConsume, PromptTokens: 1000, CompletionTokens: 500, CreatedAt: now},
		{UserId: uid, ModelName: modelName, Type: LogTypeConsume, PromptTokens: 2000, CompletionTokens: 1000, CreatedAt: now},
		{UserId: uid, ModelName: modelName, Type: LogTypeError, PromptTokens: 9999, CompletionTokens: 9999, CreatedAt: now}, // 不计
		{UserId: uid, ModelName: "other-model", Type: LogTypeConsume, PromptTokens: 9000, CompletionTokens: 0, CreatedAt: now}, // 不计
	}
	for _, l := range logs {
		require.NoError(t, LOG_DB.Create(l).Error)
	}

	tokens, calls, err := GetUserCharacterUsage(uid, modelName)
	require.NoError(t, err)
	require.Equal(t, int64(4500), tokens)
	require.Equal(t, int64(2), calls)
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

	// 1 次调用、0 token -> 阶段0
	m, err := RefreshUserCharacterProgress(uid, "m1", 0, 1, stages)
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

	// 0 调用 -> 阶段0（首次未调用不解锁）
	m, err = RefreshUserCharacterProgress(uid, "m1", 99999999, 0, stages)
	require.NoError(t, err)
	require.Equal(t, 2, m) // 已有进度不受影响
}
