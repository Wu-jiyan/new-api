package operation_setting

import (
	"errors"
	"strconv"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/setting/config"
)

// ConversationArchiveSetting 控制用户对话上下文归档，用于训练数据收集。
// 归档会在每次对话请求完成后把请求消息与模型回复写入本地数据库，并按
// 会话前缀自动去重合并；配置了 PushURL 时再异步推送到外部服务器
// （出站推送，要求接收端可被网关访问）；无公网 IP 的接收端用 PullToken
// 走 /api/conversation_archive/export 增量拉取。
type ConversationArchiveSetting struct {
	Enabled        bool   `json:"enabled"`
	PushURL        string `json:"push_url"`
	PushSecret     string `json:"push_secret"`
	PullToken      string `json:"pull_token"`
	RetentionHours int    `json:"retention_hours"`
}

var conversationArchiveSetting = ConversationArchiveSetting{
	Enabled:        false,
	PushURL:        "",
	PushSecret:     "",
	PullToken:      "",
	RetentionHours: 0,
}

func init() {
	config.GlobalConfig.Register("conversation_archive_setting", &conversationArchiveSetting)
}

func GetConversationArchiveSetting() *ConversationArchiveSetting {
	return &conversationArchiveSetting
}

// ValidateConversationArchivePullToken 约束专用拉取令牌：非空时至少 24 个字符
// 且不得包含空白字符（Authorization 头按空白分词，含空白的令牌无法通过头部传递）。
func ValidateConversationArchivePullToken(value string) error {
	if value == "" {
		return nil
	}
	if len(value) < 24 {
		return errors.New("归档拉取令牌长度至少为 24 个字符")
	}
	if strings.ContainsFunc(value, unicode.IsSpace) {
		return errors.New("归档拉取令牌不能包含空白字符")
	}
	return nil
}

// ValidateConversationArchiveRetentionHours 约束保留时长：0 表示永久保留，
// 上限 10 年。
func ValidateConversationArchiveRetentionHours(value string) error {
	hours, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return errors.New("归档保留时长必须为整数小时")
	}
	if hours < 0 || hours > 10*365*24 {
		return errors.New("归档保留时长超出范围（0-87600 小时）")
	}
	return nil
}
