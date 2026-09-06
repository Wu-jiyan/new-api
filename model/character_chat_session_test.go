package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupCharacterChatModelDB 以内存 SQLite 替换包级 DB，供本包会话/消息测试复用。
func setupCharacterChatModelDB(t *testing.T) {
	t.Helper()
	originalDB := DB
	t.Cleanup(func() { DB = originalDB })
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
}

func TestGetOrCreateCharacterChatSession(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&CharacterChatSession{}, &CharacterChatMessage{}, &UserCharacterProgress{}))
	s1, err := GetOrCreateCharacterChatSession(424100, "deepseek", 0)
	require.NoError(t, err)
	require.Equal(t, 0, s1.StageIndex)
	require.Equal(t, 0, s1.MessageCount)
	require.Equal(t, 0, s1.SummaryThrough)

	// 单主线：再次获取返回既有会话（stage 不覆盖）
	s2, err := GetOrCreateCharacterChatSession(424100, "deepseek", 1)
	require.NoError(t, err)
	require.Equal(t, s1.Id, s2.Id)
	require.Equal(t, 0, s2.StageIndex)

	// 不同角色 -> 新会话
	s3, err := GetOrCreateCharacterChatSession(424100, "other-role", 0)
	require.NoError(t, err)
	require.NotEqual(t, s1.Id, s3.Id)
}

func TestAppendAndRecentAndPagedMessages(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&CharacterChatSession{}, &CharacterChatMessage{}))
	s, err := GetOrCreateCharacterChatSession(424101, "deepseek", 0)
	require.NoError(t, err)

	um, err := AddCharacterChatUserMessage(s, "你好")
	require.NoError(t, err)
	require.Equal(t, 1, s.MessageCount)
	am, err := AddCharacterChatAssistantMessage(s, "你好呀", CharacterChatVisual{}, 0, nil)
	require.NoError(t, err)
	require.Equal(t, 2, s.MessageCount)
	require.Equal(t, "assistant", am.Role)
	require.Equal(t, "你好呀", am.Content)
	require.NotZero(t, um.CreatedAt)
	require.Equal(t, s.Id, am.SessionId)

	// 最近窗口读取（升序，limit 裁剪）
	recent, err := ListRecentCharacterChatMessages(s.Id, 10)
	require.NoError(t, err)
	require.Len(t, recent, 2)
	require.Equal(t, "user", recent[0].Role)
	require.Equal(t, "assistant", recent[1].Role)

	// 分页：无 cursor 取最新 limit 条，返回升序；更旧仍有 -> hasMore
	page, hasMore, err := ListCharacterChatMessagesPaged(s.Id, 0, 1)
	require.NoError(t, err)
	require.Len(t, page, 1)
	require.Equal(t, "assistant", page[0].Role)
	require.True(t, hasMore)
	// cursor = 最旧 id（user 消息）之后再无更旧
	page2, hasMore2, err := ListCharacterChatMessagesPaged(s.Id, um.Id, 10)
	require.NoError(t, err)
	require.Len(t, page2, 0)
	require.False(t, hasMore2)

	// 摘要待归档段：返回 id > afterId 的最新 limit 条（升序）
	since, err := ListRecentCharacterChatMessagesSince(s.Id, um.Id, 10)
	require.NoError(t, err)
	require.Len(t, since, 1)
	require.Equal(t, "assistant", since[0].Role)
	since2, err := ListRecentCharacterChatMessagesSince(s.Id, am.Id, 10)
	require.NoError(t, err)
	require.Len(t, since2, 0)
}

func TestHourlyAffinityDeltaSum(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&CharacterChatSession{}, &CharacterChatMessage{}))
	s, err := GetOrCreateCharacterChatSession(424102, "deepseek", 0)
	require.NoError(t, err)
	now := common.GetTimestamp()
	// created_at 为 Unix 秒：近 1 小时内两笔 +2 / -1，一小时外一笔 +5（忽略）
	require.NoError(t, DB.Create(&CharacterChatMessage{SessionId: s.Id, UserId: s.UserId, ModelName: s.ModelName, Role: "assistant", Content: "a", AffinityDelta: 2, CreatedAt: now}).Error)
	require.NoError(t, DB.Create(&CharacterChatMessage{SessionId: s.Id, UserId: s.UserId, ModelName: s.ModelName, Role: "assistant", Content: "b", AffinityDelta: -1, CreatedAt: now - 600}).Error)
	require.NoError(t, DB.Create(&CharacterChatMessage{SessionId: s.Id, UserId: s.UserId, ModelName: s.ModelName, Role: "assistant", Content: "old", AffinityDelta: 5, CreatedAt: now - 3601}).Error)
	sum, err := HourlyAffinityDeltaSum(s.Id, now)
	require.NoError(t, err)
	require.Equal(t, 1, sum)
}
