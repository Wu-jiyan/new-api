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

func stagesFixture() CharacterStages {
	return CharacterStages{Stages: []CharacterStage{
		{Index: 0, Name: "初遇", UnlockTokens: 0, AffinityRequired: 0},
		{Index: 1, Name: "同行", UnlockTokens: 10000000, AffinityRequired: 50},
		{Index: 2, Name: "羁绊", UnlockTokens: 50000000, AffinityRequired: 0},
	}}
}

func clearUcp(uid int, modelName string) {
	_ = DB.Where("user_id = ? AND model_name = ?", uid, modelName).Delete(&UserCharacterProgress{}).Error
}

func TestGetUserCharacterStateNoAutoUnlock(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&UserCharacterProgress{}))
	uid := 424246
	modelName := "state-model"
	clearUcp(uid, modelName)
	t.Cleanup(func() { clearUcp(uid, modelName) })

	ch := &Character{ModelName: modelName}
	st, err := GetUserCharacterState(uid, ch) // 从未调用 -> -1
	require.NoError(t, err)
	require.Equal(t, -1, st.MaxStage)
	require.Equal(t, 0, st.Affinity)

	now := common.GetTimestamp()
	require.NoError(t, LOG_DB.Create(&Log{UserId: uid, ModelName: modelName, Type: LogTypeConsume, PromptTokens: 100, CompletionTokens: 0, CreatedAt: now}).Error)
	t.Cleanup(func() {
		_ = LOG_DB.Where("user_id = ? AND model_name = ?", uid, modelName).Delete(&Log{}).Error
	})
	ClearCharacterUsageCache()

	st, err = GetUserCharacterState(uid, ch)
	require.NoError(t, err)
	require.Equal(t, int64(1), st.Calls)
	require.Equal(t, -1, st.MaxStage) // 关键：不再自动推进
	require.True(t, st.IsStageEligible(stagesFixture().Stages[0], 0))  // calls=1、token0、好感0 -> 达标
	require.False(t, st.IsStageEligible(stagesFixture().Stages[1], 0)) // token 不足 10M / 好感门槛 50
}

func TestUnlockUserCharacterStageFlow(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&UserCharacterProgress{}))
	uid := 424247
	modelName := "unlock-model"
	clearUcp(uid, modelName)
	t.Cleanup(func() { clearUcp(uid, modelName) })

	require.NoError(t, DB.Create(&UserCharacterProgress{UserID: uid, ModelName: modelName, MaxStage: -1, Affinity: 60}).Error)
	st := &UserCharacterState{MaxStage: -1, Tokens: 20000000, Calls: 1, Affinity: 60}
	stages := stagesFixture()

	newMax, err := UnlockUserCharacterStage(uid, modelName, st, 0, stages, 1) // 跳级
	require.ErrorIs(t, err, ErrUnlockOutOfOrder)
	require.Equal(t, -1, newMax)

	_, err = UnlockUserCharacterStage(uid, modelName, st, 0, stages, 5) // 越界
	require.ErrorIs(t, err, ErrUnlockStageNotFound)

	newMax, err = UnlockUserCharacterStage(uid, modelName, st, 0, stages, 0) // stage0 达标
	require.NoError(t, err)
	require.Equal(t, 0, newMax)

	st.MaxStage = 0
	newMax, err = UnlockUserCharacterStage(uid, modelName, st, 0, stages, 1) // 好感 60>=50、token 20M
	require.NoError(t, err)
	require.Equal(t, 1, newMax)

	st.MaxStage = 1
	st.Tokens = 50000000 // 满足 stage2 token 门槛，单独验证角色好感门槛
	_, err = UnlockUserCharacterStage(uid, modelName, st, 85, stages, 2) // 角色门槛 85 > 好感 60
	require.ErrorIs(t, err, ErrUnlockNotEligible)

	st.Affinity = 85
	newMax, err = UnlockUserCharacterStage(uid, modelName, st, 85, stages, 2) // 达标
	require.NoError(t, err)
	require.Equal(t, 2, newMax)

	var p UserCharacterProgress
	require.NoError(t, DB.Where("user_id = ? AND model_name = ?", uid, modelName).First(&p).Error)
	require.Equal(t, 2, p.MaxStage)
}
