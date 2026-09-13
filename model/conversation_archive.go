package model

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	gomysql "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

// ArchiveMessage 是归档对话的统一消息格式（OpenAI Chat 风格）。所有 relay 格式
// （OpenAI、Claude、Gemini、Responses）在归档前都规范化为该结构，保证同一会话
// 无论用哪种 API 续写都能通过哈希匹配上。
type ArchiveMessage struct {
	Role             string            `json:"role"`
	Content          string            `json:"content,omitempty"`
	ReasoningContent string            `json:"reasoning_content,omitempty"`
	ToolCalls        []ArchiveToolCall `json:"tool_calls,omitempty"`
	ToolCallID       string            `json:"tool_call_id,omitempty"`
	Name             string            `json:"name,omitempty"`
}

type ArchiveToolCall struct {
	ID       string              `json:"id,omitempty"`
	Type     string              `json:"type,omitempty"`
	Function ArchiveToolFunction `json:"function"`
}

type ArchiveToolFunction struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

// ConversationArchive 保存一条完整对话（多轮 messages 数组）。
// HistoryHash/FullHash 用于跨轮次去重：
//   - HistoryHash = hash(用户ID, 模型, 本次请求的消息)
//   - FullHash    = hash(用户ID, 模型, 本次请求的消息 + 模型回复)
//
// 同一会话的下一轮请求（无状态客户端会重发全部历史）其请求哈希必然等于上一轮
// 的 FullHash，据此追加而非新建；相同请求重发则命中 HistoryHash，仅更新回复，
// 避免重复保存。
type ConversationArchive struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	UserId       int    `json:"user_id" gorm:"index"`
	Username     string `json:"username" gorm:"index;default:''"`
	ModelName    string `json:"model_name" gorm:"index;default:''"`
	Messages     string `json:"messages"`
	MessageCount int    `json:"message_count"`
	HistoryHash  string `json:"history_hash" gorm:"type:varchar(64);index;default:''"`
	FullHash     string `json:"full_hash" gorm:"type:varchar(64);uniqueIndex;default:''"`
	Format       string `json:"format" gorm:"type:varchar(16);default:''"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint"`
}

// ConversationArchiveInput 由捕获层组装：请求消息列表与最终模型回复。
type ConversationArchiveInput struct {
	UserId    int
	Username  string
	ModelName string
	Format    string
	Messages  []ArchiveMessage
	Response  ArchiveMessage
}

// 归档动作结果：created=新建会话，updated=续写/更新既有会话，duplicate=完全重复。
const (
	ArchiveActionCreated   = "created"
	ArchiveActionUpdated   = "updated"
	ArchiveActionDuplicate = "duplicate"
)

// archiveHashLengthPrefix 写入长度前缀字段，避免内容中分隔符造成哈希歧义。
func archiveHashLengthPrefix(w io.Writer, parts ...string) {
	for _, part := range parts {
		fmt.Fprintf(w, "%d:%s\x00", len(part), part)
	}
}

func conversationArchiveHash(userId int, modelName string, messages []ArchiveMessage) string {
	h := sha256.New()
	archiveHashLengthPrefix(h, fmt.Sprintf("%d", userId), modelName)
	for i := range messages {
		m := &messages[i]
		toolCalls := ""
		if len(m.ToolCalls) > 0 {
			if data, err := common.Marshal(m.ToolCalls); err == nil {
				toolCalls = string(data)
			}
		}
		archiveHashLengthPrefix(h, m.Role, m.Content, m.ReasoningContent, m.ToolCallID, m.Name, toolCalls)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// isConversationArchiveDuplicateKeyError 按驱动类型识别唯一键冲突：
// MySQL 错误码 1062、PostgreSQL SQLSTATE 23505、SQLite 约束错误文本。
// 服务端错误消息可能被本地化（如中文 PostgreSQL），不能只匹配英文文本。
func isConversationArchiveDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	var mysqlErr *gomysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == 1062
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") || // SQLite
		strings.Contains(msg, "SQLSTATE 23505") // PostgreSQL 错误文本兜底
}

// ArchiveConversation 将一轮对话（请求消息 + 模型回复）按前缀匹配合并进既有
// 会话或新建会话，返回归档记录与动作类型。
func ArchiveConversation(input *ConversationArchiveInput) (*ConversationArchive, string, error) {
	if len(input.Messages) == 0 {
		return nil, "", nil
	}
	fullMessages := make([]ArchiveMessage, 0, len(input.Messages)+1)
	fullMessages = append(fullMessages, input.Messages...)
	fullMessages = append(fullMessages, input.Response)

	historyHash := conversationArchiveHash(input.UserId, input.ModelName, input.Messages)
	fullHash := conversationArchiveHash(input.UserId, input.ModelName, fullMessages)
	now := common.GetTimestamp()

	var result *ConversationArchive
	var action string
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 1. 同一请求 + 同一回复已归档过，跳过。
		var dup ConversationArchive
		if err := tx.Where("full_hash = ?", fullHash).First(&dup).Error; err == nil {
			result = &dup
			action = ArchiveActionDuplicate
			return nil
		}

		// 2. 相同请求但回复不同（客户端重试/重新生成）：更新该记录的回复。
		var regen ConversationArchive
		if err := tx.Where("history_hash = ?", historyHash).Order("id ASC").First(&regen).Error; err == nil {
			updates := map[string]any{
				"messages":      mustMarshalArchiveMessages(fullMessages),
				"message_count": len(fullMessages),
				"full_hash":     fullHash,
				"updated_at":    now,
			}
			if err := tx.Model(&ConversationArchive{}).Where("id = ?", regen.Id).Updates(updates).Error; err != nil {
				return err
			}
			regen.Messages = updates["messages"].(string)
			regen.MessageCount = len(fullMessages)
			regen.FullHash = fullHash
			regen.UpdatedAt = now
			result = &regen
			action = ArchiveActionUpdated
			return nil
		}

		// 3. 会话续写：请求消息列表是某条既有归档（含其回复）的前缀扩展。
		//    对请求消息计算每个前缀哈希（去掉最后一条后的所有前缀），取最长匹配。
		prefixHashes := make([]string, 0, len(input.Messages))
		prefixLen := make(map[string]int, len(input.Messages))
		for k := len(input.Messages) - 1; k >= 1; k-- {
			prefixHash := conversationArchiveHash(input.UserId, input.ModelName, input.Messages[:k])
			if _, ok := prefixLen[prefixHash]; !ok {
				prefixHashes = append(prefixHashes, prefixHash)
				prefixLen[prefixHash] = k
			}
		}
		if len(prefixHashes) > 0 {
			var matches []ConversationArchive
			if err := tx.Where("full_hash IN ?", prefixHashes).Find(&matches).Error; err != nil {
				return err
			}
			var best *ConversationArchive
			bestLen := 0
			for i := range matches {
				if k := prefixLen[matches[i].FullHash]; k > bestLen {
					bestLen = k
					best = &matches[i]
				}
			}
			if best != nil {
				// 事务内按主键重新加锁读取，避免并发续写丢失更新。
				var locked ConversationArchive
				if err := lockForUpdate(tx).Where("id = ?", best.Id).First(&locked).Error; err != nil {
					return err
				}
				var stored []ArchiveMessage
				if err := common.UnmarshalJsonStr(locked.Messages, &stored); err != nil {
					return err
				}
				merged := append(stored, input.Messages[bestLen:]...)
				merged = append(merged, input.Response)
				updates := map[string]any{
					"messages":      mustMarshalArchiveMessages(merged),
					"message_count": len(merged),
					"full_hash":     fullHash,
					"updated_at":    now,
				}
				if err := tx.Model(&ConversationArchive{}).Where("id = ?", locked.Id).Updates(updates).Error; err != nil {
					return err
				}
				locked.Messages = updates["messages"].(string)
				locked.MessageCount = len(merged)
				locked.FullHash = fullHash
				locked.UpdatedAt = now
				result = &locked
				action = ArchiveActionUpdated
				return nil
			}
		}

		// 4. 新会话。并发插入撞唯一索引说明另一事务刚归档了同一会话，视为重复。
		record := &ConversationArchive{
			UserId:       input.UserId,
			Username:     input.Username,
			ModelName:    input.ModelName,
			Messages:     mustMarshalArchiveMessages(fullMessages),
			MessageCount: len(fullMessages),
			HistoryHash:  historyHash,
			FullHash:     fullHash,
			Format:       input.Format,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Create(record).Error; err != nil {
			if isConversationArchiveDuplicateKeyError(err) {
				action = ArchiveActionDuplicate
				return nil
			}
			return err
		}
		result = record
		action = ArchiveActionCreated
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return result, action, nil
}

func mustMarshalArchiveMessages(messages []ArchiveMessage) string {
	data, err := common.Marshal(messages)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func GetConversationArchivesById(id int) (*ConversationArchive, error) {
	if id == 0 {
		return nil, errors.New("id 为空")
	}
	var archive ConversationArchive
	err := DB.Where("id = ?", id).First(&archive).Error
	return &archive, err
}

func GetAllConversationArchives(startTimestamp int64, endTimestamp int64, modelName string, username string, startIdx int, num int) ([]*ConversationArchive, int64, error) {
	tx := buildConversationArchiveQuery(startTimestamp, endTimestamp, modelName, username)
	var total int64
	if err := tx.Model(&ConversationArchive{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	tx = buildConversationArchiveQuery(startTimestamp, endTimestamp, modelName, username)
	var archives []*ConversationArchive
	err := tx.Order("id desc").Limit(num).Offset(startIdx).Find(&archives).Error
	return archives, total, err
}

// ExportConversationArchives 按 id 升序分批流式导出。afterId 为增量游标：
// 仅导出 id 大于 afterId 的记录，供无公网 IP 的接收端轮询增量同步。
func ExportConversationArchives(startTimestamp int64, endTimestamp int64, modelName string, username string, afterId int, batchSize int, handle func(archives []*ConversationArchive) error) error {
	if batchSize <= 0 {
		batchSize = 500
	}
	lastId := afterId
	if lastId < 0 {
		lastId = 0
	}
	for {
		var archives []*ConversationArchive
		tx := buildConversationArchiveQuery(startTimestamp, endTimestamp, modelName, username)
		err := tx.Where("id > ?", lastId).Order("id asc").Limit(batchSize).Find(&archives).Error
		if err != nil {
			return err
		}
		if len(archives) == 0 {
			return nil
		}
		lastId = archives[len(archives)-1].Id
		if err := handle(archives); err != nil {
			return err
		}
	}
}

func DeleteConversationArchiveById(id int) (int64, error) {
	if id == 0 {
		return 0, errors.New("id 为空")
	}
	result := DB.Where("id = ?", id).Delete(&ConversationArchive{})
	return result.RowsAffected, result.Error
}

// VerifyConversationArchivePullToken 校验专用拉取令牌。先做 SHA-256 归一化再
// 固定时间比较，避免长度差异与时序侧信道。
func VerifyConversationArchivePullToken(token string) bool {
	expected := operation_setting.GetConversationArchiveSetting().PullToken
	if expected == "" || token == "" {
		return false
	}
	expectedHash := sha256.Sum256([]byte(expected))
	tokenHash := sha256.Sum256([]byte(token))
	return subtle.ConstantTimeCompare(expectedHash[:], tokenHash[:]) == 1
}

// DeleteExpiredConversationArchives 按保留时长清理过期归档，返回删除条数。
// 以 updated_at 为准：会话每追加一轮都会刷新，保留的是「仍在活跃的会话」。
// 单次最多清理 maxBatches 批，避免一次持有大量行锁拖慢在线请求。
func DeleteExpiredConversationArchives(retentionHours int, batchSize int, maxBatches int) (int64, error) {
	if retentionHours <= 0 {
		return 0, nil
	}
	if batchSize <= 0 {
		batchSize = 1000
	}
	if maxBatches <= 0 {
		maxBatches = 100
	}
	cutoff := common.GetTimestamp() - int64(retentionHours)*3600
	var total int64
	for i := 0; i < maxBatches; i++ {
		ids := make([]int, 0, batchSize)
		err := DB.Model(&ConversationArchive{}).
			Where("updated_at < ?", cutoff).
			Order("id asc").
			Limit(batchSize).
			Pluck("id", &ids).Error
		if err != nil {
			return total, err
		}
		if len(ids) == 0 {
			return total, nil
		}
		result := DB.Where("id IN ?", ids).Delete(&ConversationArchive{})
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if len(ids) < batchSize {
			return total, nil
		}
	}
	return total, nil
}

func buildConversationArchiveQuery(startTimestamp int64, endTimestamp int64, modelName string, username string) *gorm.DB {
	tx := DB.Model(&ConversationArchive{})
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	return tx
}
