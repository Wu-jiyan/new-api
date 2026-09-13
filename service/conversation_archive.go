package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// 归档捕获的请求/响应体上限，超出则跳过该请求，避免大文件类请求占用内存。
const ConversationArchiveMaxCaptureBytes = 8 * 1024 * 1024

// 对话格式标识，与捕获路径一一对应。
const (
	conversationFormatOpenAIChat = "openai"
	conversationFormatOpenAIText = "text"
	conversationFormatClaude     = "claude"
	conversationFormatResponses  = "responses"
	conversationFormatGemini     = "gemini"
)

// ConversationArchiveFormatForPath 根据请求路径识别可归档的对话端点。
func ConversationArchiveFormatForPath(path string) (string, bool) {
	switch path {
	case "/v1/chat/completions", "/pg/chat/completions":
		return conversationFormatOpenAIChat, true
	case "/v1/completions":
		return conversationFormatOpenAIText, true
	case "/v1/messages":
		return conversationFormatClaude, true
	case "/v1/responses":
		return conversationFormatResponses, true
	}
	if strings.HasSuffix(path, ":generateContent") || strings.HasSuffix(path, ":streamGenerateContent") {
		return conversationFormatGemini, true
	}
	return "", false
}

// ShouldCaptureConversation 供中间件快速判断是否需要包装响应。
func ShouldCaptureConversation(path string) bool {
	if !operation_setting.GetConversationArchiveSetting().Enabled {
		return false
	}
	_, ok := ConversationArchiveFormatForPath(path)
	return ok
}

// CaptureConversation 在 relay 响应写完之后被中间件调用：解析请求与响应，
// 组装成统一消息格式后异步归档（本地去重存储 + 可选推送）。
// gin 上下文仅在本函数内读取，goroutine 只携带值拷贝。
func CaptureConversation(c *gin.Context, responseBody []byte, responseTruncated bool, statusCode int, contentType string) {
	if !operation_setting.GetConversationArchiveSetting().Enabled {
		return
	}
	format, ok := ConversationArchiveFormatForPath(c.Request.URL.Path)
	if !ok {
		return
	}
	if statusCode != http.StatusOK || responseTruncated {
		return
	}
	userId := c.GetInt("id")
	modelName := c.GetString("original_model")
	if userId == 0 || modelName == "" {
		return
	}

	requestBody, ok := readArchivedRequestBody(c)
	if !ok {
		return
	}
	requestMessages, ok := parseArchiveRequestMessages(format, requestBody)
	if !ok || len(requestMessages) == 0 {
		return
	}
	isStream := strings.Contains(contentType, "text/event-stream")
	response, ok := assembleArchiveResponse(format, isStream, responseBody)
	if !ok || isArchiveMessageEmpty(response) {
		return
	}

	go func() {
		username, err := model.GetUsernameById(userId, false)
		if err != nil {
			username = ""
		}
		archive, action, err := model.ArchiveConversation(&model.ConversationArchiveInput{
			UserId:    userId,
			Username:  username,
			ModelName: modelName,
			Format:    format,
			Messages:  requestMessages,
			Response:  response,
		})
		if err != nil {
			common.SysError(fmt.Sprintf("failed to archive conversation for user %d: %s", userId, err.Error()))
			return
		}
		if archive == nil || action == model.ArchiveActionDuplicate {
			return
		}
		enqueueConversationArchivePush(archive, action)
	}()
}

func readArchivedRequestBody(c *gin.Context) ([]byte, bool) {
	body, err := common.GetRequestBody(c)
	if err != nil {
		return nil, false
	}
	reader, ok := body.(io.ReadSeeker)
	if !ok {
		return nil, false
	}
	if _, err := reader.Seek(0, io.SeekStart); err != nil {
		return nil, false
	}
	data, err := io.ReadAll(io.LimitReader(reader, ConversationArchiveMaxCaptureBytes+1))
	if err != nil || len(data) == 0 || len(data) > ConversationArchiveMaxCaptureBytes {
		return nil, false
	}
	return data, true
}

// 推送队列：单 worker 串行出站 POST，网关无需公网 IP 即可推送。
const (
	conversationArchivePushQueueSize = 1024
	conversationArchivePushRetries   = 3
	conversationArchivePushTimeout   = 15 * time.Second
)

type conversationArchivePushPayload struct {
	Id           int             `json:"id"`
	Action       string          `json:"action"`
	UserId       int             `json:"user_id"`
	Username     string          `json:"username"`
	ModelName    string          `json:"model_name"`
	Format       string          `json:"format"`
	Messages     json.RawMessage `json:"messages"`
	MessageCount int             `json:"message_count"`
	CreatedAt    int64           `json:"created_at"`
	UpdatedAt    int64           `json:"updated_at"`
}

var (
	conversationArchivePushQueue chan *conversationArchivePushPayload
	conversationArchivePushOnce  sync.Once
)

func enqueueConversationArchivePush(archive *model.ConversationArchive, action string) {
	setting := operation_setting.GetConversationArchiveSetting()
	if setting.PushURL == "" {
		return
	}
	conversationArchivePushOnce.Do(func() {
		conversationArchivePushQueue = make(chan *conversationArchivePushPayload, conversationArchivePushQueueSize)
		go conversationArchivePushWorker()
	})
	payload := &conversationArchivePushPayload{
		Id:           archive.Id,
		Action:       action,
		UserId:       archive.UserId,
		Username:     archive.Username,
		ModelName:    archive.ModelName,
		Format:       archive.Format,
		Messages:     json.RawMessage(archive.Messages),
		MessageCount: archive.MessageCount,
		CreatedAt:    archive.CreatedAt,
		UpdatedAt:    archive.UpdatedAt,
	}
	select {
	case conversationArchivePushQueue <- payload:
	default:
		common.SysError(fmt.Sprintf("conversation archive push queue full, dropping archive %d", archive.Id))
	}
}

func conversationArchivePushWorker() {
	client := &http.Client{Timeout: conversationArchivePushTimeout}
	for payload := range conversationArchivePushQueue {
		setting := operation_setting.GetConversationArchiveSetting()
		if setting.PushURL == "" {
			continue
		}
		body, err := common.Marshal(payload)
		if err != nil {
			common.SysError("failed to marshal conversation archive push payload: " + err.Error())
			continue
		}
		pushConversationArchivePayload(client, setting.PushURL, setting.PushSecret, body, payload.Id)
	}
}

func pushConversationArchivePayload(client *http.Client, pushURL string, pushSecret string, body []byte, archiveId int) {
	var lastErr error
	for attempt := 0; attempt < conversationArchivePushRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
		req, err := http.NewRequest(http.MethodPost, pushURL, bytes.NewReader(body))
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "new-api-conversation-archive")
		if pushSecret != "" {
			req.Header.Set("Authorization", "Bearer "+pushSecret)
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return
		}
		lastErr = fmt.Errorf("push endpoint returned status %d", resp.StatusCode)
	}
	if lastErr != nil {
		common.SysError(fmt.Sprintf("failed to push conversation archive %d: %s", archiveId, lastErr.Error()))
	}
}

// 后台清理：每天检查一次，按 conversation_archive_setting.retention_hours 删除过期归档。
const (
	conversationArchiveCleanupInterval = 24 * time.Hour
	conversationArchiveCleanupStartup  = 5 * time.Minute
)

// StartConversationArchiveCleanup 启动定时清理任务（幂等，重复调用只启动一次）。
// retention_hours 为 0（永久保留）时不删除任何记录，仅跳过。
func StartConversationArchiveCleanup() {
	conversationArchiveCleanupOnce.Do(func() {
		go conversationArchiveCleanupLoop()
	})
}

var conversationArchiveCleanupOnce sync.Once

func conversationArchiveCleanupLoop() {
	// 启动后先等待，避免与初始化/迁移争抢资源。
	time.Sleep(conversationArchiveCleanupStartup)
	for {
		runConversationArchiveCleanup()
		time.Sleep(conversationArchiveCleanupInterval)
	}
}

func runConversationArchiveCleanup() {
	retentionHours := operation_setting.GetConversationArchiveSetting().RetentionHours
	if retentionHours <= 0 {
		return
	}
	deleted, err := model.DeleteExpiredConversationArchives(retentionHours, 1000, 100)
	if err != nil {
		common.SysError("failed to clean up expired conversation archives: " + err.Error())
		return
	}
	if deleted > 0 {
		common.SysLog(fmt.Sprintf("cleaned up %d expired conversation archives (retention %d hours)", deleted, retentionHours))
	}
}
