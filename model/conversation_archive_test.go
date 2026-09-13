package model

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupArchiveDBForTest(t *testing.T) {
	t.Helper()
	previousDB := DB
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	t.Cleanup(func() {
		DB = previousDB
		sqlDB, err := db.DB()
		if err == nil && sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, DB.AutoMigrate(&ConversationArchive{}))
}

func archiveMessages(t *testing.T, raw string) []ArchiveMessage {
	t.Helper()
	var messages []ArchiveMessage
	require.NoError(t, common.UnmarshalJsonStr(raw, &messages))
	return messages
}

func storedArchiveMessages(t *testing.T, archive *ConversationArchive) []ArchiveMessage {
	t.Helper()
	var messages []ArchiveMessage
	require.NoError(t, common.UnmarshalJsonStr(archive.Messages, &messages))
	return messages
}

func archiveUserTurn(user string, content string) ArchiveMessage {
	return ArchiveMessage{Role: "user", Content: content, Name: user}
}

// TestArchiveConversationDedupLifecycle 覆盖同一会话跨轮次归档的完整生命周期：
// 新建 -> 重复跳过 -> 重新生成更新 -> 续写追加 -> 工具调用续写 -> 跨用户/模型隔离。
func TestArchiveConversationDedupLifecycle(t *testing.T) {
	setupArchiveDBForTest(t)

	turn1 := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages:  archiveMessages(t, `[{"role":"system","content":"be brief"},{"role":"user","content":"hi"}]`),
		Response:  ArchiveMessage{Role: "assistant", Content: "hello!"},
	}
	archive, action, err := ArchiveConversation(turn1)
	require.NoError(t, err)
	require.NotNil(t, archive)
	assert.Equal(t, ArchiveActionCreated, action)
	assert.Equal(t, 3, archive.MessageCount)
	firstId := archive.Id

	// 完全相同的请求+回复再次归档 -> duplicate，不产生新记录。
	_, action, err = ArchiveConversation(turn1)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionDuplicate, action)
	var count int64
	require.NoError(t, DB.Model(&ConversationArchive{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)

	// 相同请求、不同回复（重新生成）-> 更新原记录的回复。
	regen := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages:  turn1.Messages,
		Response:  ArchiveMessage{Role: "assistant", Content: "hi there!"},
	}
	archive, action, err = ArchiveConversation(regen)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionUpdated, action)
	require.NotNil(t, archive)
	assert.Equal(t, firstId, archive.Id)
	assert.Equal(t, []ArchiveMessage{
		{Role: "system", Content: "be brief"},
		archiveUserTurn("", "hi"),
		{Role: "assistant", Content: "hi there!"},
	}, storedArchiveMessages(t, archive))

	// 第二轮：请求为既有归档的前缀扩展 -> 追加，不新建。
	turn2 := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages:  archiveMessages(t, `[{"role":"system","content":"be brief"},{"role":"user","content":"hi"},{"role":"assistant","content":"hi there!"},{"role":"user","content":"bye"}]`),
		Response:  ArchiveMessage{Role: "assistant", Content: "goodbye!"},
	}
	archive, action, err = ArchiveConversation(turn2)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionUpdated, action)
	require.NotNil(t, archive)
	assert.Equal(t, firstId, archive.Id)
	assert.Equal(t, 5, archive.MessageCount)
	require.NoError(t, DB.Model(&ConversationArchive{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)

	// 工具调用续写：请求末尾是 tool 结果消息，仍应匹配前缀并追加。
	turn3 := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages:  archiveMessages(t, `[{"role":"system","content":"be brief"},{"role":"user","content":"hi"},{"role":"assistant","content":"hi there!"},{"role":"user","content":"bye"},{"role":"assistant","content":"goodbye!"},{"role":"assistant","tool_calls":[{"id":"c1","type":"function","function":{"name":"f","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c1","content":"42"}]`),
		Response:  ArchiveMessage{Role: "assistant", Content: "the answer is 42"},
	}
	archive, action, err = ArchiveConversation(turn3)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionUpdated, action)
	require.NotNil(t, archive)
	assert.Equal(t, firstId, archive.Id)
	assert.Equal(t, 8, archive.MessageCount)
	messages := storedArchiveMessages(t, archive)
	assert.Equal(t, "tool", messages[6].Role)
	assert.Equal(t, "the answer is 42", messages[7].Content)

	// 不同用户、相同消息内容 -> 隔离为新的会话记录。
	otherUser := &ConversationArchiveInput{
		UserId:    2,
		Username:  "bob",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages:  turn1.Messages,
		Response:  ArchiveMessage{Role: "assistant", Content: "hello!"},
	}
	archive, action, err = ArchiveConversation(otherUser)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionCreated, action)
	assert.NotEqual(t, firstId, archive.Id)

	// 同一用户、不同模型 -> 新的会话记录。
	otherModel := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "claude-3-5-sonnet",
		Format:    "claude",
		Messages:  turn1.Messages,
		Response:  ArchiveMessage{Role: "assistant", Content: "hello!"},
	}
	_, action, err = ArchiveConversation(otherModel)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionCreated, action)
	require.NoError(t, DB.Model(&ConversationArchive{}).Count(&count).Error)
	assert.Equal(t, int64(3), count)
}

func TestArchiveConversationEmptyMessagesRejected(t *testing.T) {
	setupArchiveDBForTest(t)
	_, _, err := ArchiveConversation(&ConversationArchiveInput{UserId: 1, ModelName: "gpt-4o"})
	require.NoError(t, err)
	var count int64
	require.NoError(t, DB.Model(&ConversationArchive{}).Count(&count).Error)
	assert.Equal(t, int64(0), count)
}

// TestExportConversationArchivesAfterId 验证增量导出游标：after_id 之后的记录
// 按 id 升序返回，供无公网 IP 的接收端轮询同步。
func TestExportConversationArchivesAfterId(t *testing.T) {
	setupArchiveDBForTest(t)
	var ids []int
	for _, content := range []string{"first", "second", "third"} {
		archive, _, err := ArchiveConversation(&ConversationArchiveInput{
			UserId:    1,
			Username:  "alice",
			ModelName: "gpt-4o",
			Format:    "openai",
			Messages:  []ArchiveMessage{{Role: "user", Content: content}},
			Response:  ArchiveMessage{Role: "assistant", Content: "ok"},
		})
		require.NoError(t, err)
		ids = append(ids, archive.Id)
	}

	var exported []*ConversationArchive
	require.NoError(t, ExportConversationArchives(0, 0, "", "", ids[0], 500, func(archives []*ConversationArchive) error {
		exported = append(exported, archives...)
		return nil
	}))
	require.Len(t, exported, 2)
	assert.Equal(t, ids[1], exported[0].Id)
	assert.Equal(t, ids[2], exported[1].Id)

	exported = nil
	require.NoError(t, ExportConversationArchives(0, 0, "", "", ids[2], 500, func(archives []*ConversationArchive) error {
		exported = append(exported, archives...)
		return nil
	}))
	assert.Empty(t, exported)

	// 不带游标时导出全部记录。
	exported = nil
	require.NoError(t, ExportConversationArchives(0, 0, "", "", 0, 500, func(archives []*ConversationArchive) error {
		exported = append(exported, archives...)
		return nil
	}))
	require.Len(t, exported, 3)
}

// testConversationArchiveOnDatabase 在真实数据库上验证：迁移（跑两遍证明幂等）、
// messages 长文本列类型、唯一索引，以及去重生命周期与 SQLite 语义一致。
func testConversationArchiveOnDatabase(t *testing.T, db *gorm.DB, dialect string) {
	t.Helper()
	previousDB := DB
	DB = db
	t.Cleanup(func() { DB = previousDB })

	require.NoError(t, DB.Migrator().DropTable(&ConversationArchive{}))
	require.NoError(t, DB.AutoMigrate(&ConversationArchive{}))
	// 第二次迁移不得报错，也不得破坏已有数据与约束。
	require.NoError(t, DB.AutoMigrate(&ConversationArchive{}))

	columnTypes, err := DB.Table("conversation_archives").Migrator().ColumnTypes(&ConversationArchive{})
	require.NoError(t, err)
	messagesType := ""
	var columnNames []string
	for _, columnType := range columnTypes {
		columnNames = append(columnNames, columnType.Name())
		if strings.EqualFold(columnType.Name(), "messages") {
			messagesType = strings.ToUpper(columnType.DatabaseTypeName())
		}
	}
	require.Contains(t, columnNames, "history_hash")
	require.Contains(t, columnNames, "full_hash")
	require.Contains(t, columnNames, "created_at")
	switch dialect {
	case "mysql":
		assert.Equal(t, "LONGTEXT", messagesType)
	case "postgres":
		assert.Equal(t, "TEXT", messagesType)
	}

	// 唯一索引必须存在：相同 full_hash 的插入必须被拒绝。
	turn1 := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages:  archiveMessages(t, `[{"role":"user","content":"hi"}]`),
		Response:  ArchiveMessage{Role: "assistant", Content: "hello!"},
	}
	archive, action, err := ArchiveConversation(turn1)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionCreated, action)
	require.NotNil(t, archive)

	dup := &ConversationArchive{
		UserId:       turn1.UserId,
		Username:     turn1.Username,
		ModelName:    turn1.ModelName,
		Messages:     archive.Messages,
		MessageCount: archive.MessageCount,
		HistoryHash:  archive.HistoryHash,
		FullHash:     archive.FullHash,
		Format:       archive.Format,
	}
	err = DB.Create(dup).Error
	require.Error(t, err)
	require.True(t, isConversationArchiveDuplicateKeyError(err), "expected duplicate key error, got: %v", err)

	// 去重生命周期在真实数据库上与 SQLite 行为一致。
	_, action, err = ArchiveConversation(turn1)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionDuplicate, action)

	regen := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages:  turn1.Messages,
		Response:  ArchiveMessage{Role: "assistant", Content: "hi again!"},
	}
	archive, action, err = ArchiveConversation(regen)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionUpdated, action)
	require.NotNil(t, archive)
	assert.Contains(t, archive.Messages, "hi again!")

	continuation := &ConversationArchiveInput{
		UserId:    1,
		Username:  "alice",
		ModelName: "gpt-4o",
		Format:    "openai",
		Messages: append(archiveMessages(t, `[{"role":"user","content":"hi"}]`),
			ArchiveMessage{Role: "assistant", Content: "hi again!"},
			ArchiveMessage{Role: "user", Content: "bye"}),
		Response: ArchiveMessage{Role: "assistant", Content: "goodbye!"},
	}
	_, action, err = ArchiveConversation(continuation)
	require.NoError(t, err)
	assert.Equal(t, ArchiveActionUpdated, action)

	var count int64
	require.NoError(t, DB.Model(&ConversationArchive{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)

	// 保留时长清理：把记录改成过期（以 updated_at 判定）后按保留时长删除。
	expiredAt := common.GetTimestamp() - 48*3600
	require.NoError(t, DB.Model(&ConversationArchive{}).Where("id = ?", archive.Id).Update("updated_at", expiredAt).Error)
	deleted, err := DeleteExpiredConversationArchives(24, 1000, 100)
	require.NoError(t, err)
	assert.EqualValues(t, 1, deleted)
	require.NoError(t, DB.Model(&ConversationArchive{}).Count(&count).Error)
	assert.Equal(t, int64(0), count)
}

func TestConversationArchiveOnConfiguredDatabases(t *testing.T) {
	tests := []struct {
		name      string
		env       string
		dialect   string
		dialector func(string) gorm.Dialector
	}{
		{name: "mysql", env: "TEST_MYSQL_DSN", dialect: "mysql", dialector: func(dsn string) gorm.Dialector { return mysql.Open(dsn) }},
		{name: "postgres", env: "TEST_POSTGRES_DSN", dialect: "postgres", dialector: func(dsn string) gorm.Dialector {
			return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dsn := strings.TrimSpace(os.Getenv(test.env))
			if dsn == "" {
				t.Skip(test.env + " is not configured")
			}
			db, err := gorm.Open(test.dialector(dsn), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			testConversationArchiveOnDatabase(t, db, test.dialect)
		})
	}
}

// TestDeleteExpiredConversationArchives 验证保留时长清理：仅删除 updated_at 早于
// 截止时间的记录；retention_hours=0 表示永久保留。
func TestDeleteExpiredConversationArchives(t *testing.T) {
	setupArchiveDBForTest(t)
	now := common.GetTimestamp()
	records := []ConversationArchive{
		{UserId: 1, ModelName: "gpt-4o", Messages: "[]", FullHash: "old-1", CreatedAt: now - 25*3600, UpdatedAt: now - 25*3600},
		{UserId: 1, ModelName: "gpt-4o", Messages: "[]", FullHash: "active", CreatedAt: now - 25*3600, UpdatedAt: now - 3600},
		{UserId: 1, ModelName: "gpt-4o", Messages: "[]", FullHash: "fresh", CreatedAt: now, UpdatedAt: now},
	}
	for i := range records {
		require.NoError(t, DB.Create(&records[i]).Error)
	}

	// retention_hours = 0：不清理。
	deleted, err := DeleteExpiredConversationArchives(0, 1000, 10)
	require.NoError(t, err)
	assert.EqualValues(t, 0, deleted)

	// 24 小时保留：只删除 updated_at 超过 24h 的记录，活跃会话（旧创建但刚更新）保留。
	deleted, err = DeleteExpiredConversationArchives(24, 1000, 10)
	require.NoError(t, err)
	assert.EqualValues(t, 1, deleted)

	var remaining []ConversationArchive
	require.NoError(t, DB.Order("id asc").Find(&remaining).Error)
	require.Len(t, remaining, 2)
	assert.Equal(t, "active", remaining[0].FullHash)
	assert.Equal(t, "fresh", remaining[1].FullHash)
}

// TestVerifyConversationArchivePullToken 验证专用令牌校验：未配置时拒绝一切，
// 配置后仅接受完全一致的令牌。
func TestVerifyConversationArchivePullToken(t *testing.T) {
	setting := operation_setting.GetConversationArchiveSetting()
	previous := setting.PullToken
	t.Cleanup(func() { setting.PullToken = previous })

	setting.PullToken = ""
	assert.False(t, VerifyConversationArchivePullToken("anything"))

	const token = "0f8c1d4be5a94f0d8e3b7c2a6d5f1e90abc1234567890def"
	setting.PullToken = token
	assert.True(t, VerifyConversationArchivePullToken(token))
	assert.False(t, VerifyConversationArchivePullToken(""))
	assert.False(t, VerifyConversationArchivePullToken("0f8c1d4be5a94f0d8e3b7c2a6d5f1e90abc1234567890deg"))
	assert.False(t, VerifyConversationArchivePullToken(token[:len(token)-1]))
}
