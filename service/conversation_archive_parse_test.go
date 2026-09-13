package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func mustArchiveRequestMessages(t *testing.T, format string, body string) []model.ArchiveMessage {
	t.Helper()
	messages, ok := parseArchiveRequestMessages(format, []byte(body))
	require.True(t, ok)
	return messages
}

func TestParseOpenAIChatRequest(t *testing.T) {
	messages := mustArchiveRequestMessages(t, conversationFormatOpenAIChat, `{
		"model": "gpt-4o",
		"messages": [
			{"role": "system", "content": "be brief"},
			{"role": "user", "content": [
				{"type": "text", "text": "look "},
				{"type": "image_url", "image_url": {"url": "data:image/png;base64,xxx"}},
				{"type": "text", "text": "here"}
			]},
			{"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "get", "arguments": "{\"q\":1}"}}]},
			{"role": "tool", "tool_call_id": "c1", "content": "42"}
		]
	}`)
	require.Len(t, messages, 4)
	assert.Equal(t, model.ArchiveMessage{Role: "system", Content: "be brief"}, messages[0])
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "look \nhere"}, messages[1])
	assert.Equal(t, "assistant", messages[2].Role)
	require.Len(t, messages[2].ToolCalls, 1)
	assert.Equal(t, "c1", messages[2].ToolCalls[0].ID)
	assert.Equal(t, "get", messages[2].ToolCalls[0].Function.Name)
	assert.Equal(t, `{"q":1}`, messages[2].ToolCalls[0].Function.Arguments)
	assert.Equal(t, model.ArchiveMessage{Role: "tool", ToolCallID: "c1", Content: "42"}, messages[3])
}

func TestParseOpenAIChatRequestDropsEmptyMessages(t *testing.T) {
	messages := mustArchiveRequestMessages(t, conversationFormatOpenAIChat, `{
		"messages": [
			{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,xxx"}}]},
			{"role": "user", "content": "hi"}
		]
	}`)
	require.Len(t, messages, 1)
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "hi"}, messages[0])
}

func TestAssembleOpenAIChatStream(t *testing.T) {
	body := "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"Hel\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think\",\"content\":\"lo\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"type\":\"function\",\"function\":{\"name\":\"get\",\"arguments\":\"{\\\"q\\\":\"}}]}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"1}\"}}]}}]}\n\n" +
		"data: {\"choices\":[],\"usage\":{\"total_tokens\":10}}\n\n" +
		"data: [DONE]\n\n"
	msg, ok := assembleOpenAIChatStream([]byte(body))
	require.True(t, ok)
	assert.Equal(t, "assistant", msg.Role)
	assert.Equal(t, "Hello", msg.Content)
	assert.Equal(t, "think", msg.ReasoningContent)
	require.Len(t, msg.ToolCalls, 1)
	assert.Equal(t, "c1", msg.ToolCalls[0].ID)
	assert.Equal(t, "get", msg.ToolCalls[0].Function.Name)
	assert.Equal(t, `{"q":1}`, msg.ToolCalls[0].Function.Arguments)
}

func TestAssembleOpenAIChatNonStream(t *testing.T) {
	body := `{"choices":[{"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}`
	msg, ok := assembleOpenAIChatResponse([]byte(body))
	require.True(t, ok)
	assert.Equal(t, model.ArchiveMessage{Role: "assistant", Content: "hello"}, msg)
}

func TestParseClaudeRequest(t *testing.T) {
	messages := mustArchiveRequestMessages(t, conversationFormatClaude, `{
		"model": "claude-3-5-sonnet",
		"system": "be brief",
		"messages": [
			{"role": "user", "content": "hi"},
			{"role": "assistant", "content": [
				{"type": "thinking", "thinking": "hmm"},
				{"type": "text", "text": "let me check"},
				{"type": "tool_use", "id": "toolu_1", "name": "get", "input": {"q": 1}}
			]},
			{"role": "user", "content": [
				{"type": "tool_result", "tool_use_id": "toolu_1", "content": "42"},
				{"type": "text", "text": "thanks"}
			]}
		]
	}`)
	require.Len(t, messages, 5)
	assert.Equal(t, model.ArchiveMessage{Role: "system", Content: "be brief"}, messages[0])
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "hi"}, messages[1])
	assert.Equal(t, "assistant", messages[2].Role)
	assert.Equal(t, "hmm", messages[2].ReasoningContent)
	assert.Equal(t, "let me check", messages[2].Content)
	require.Len(t, messages[2].ToolCalls, 1)
	assert.Equal(t, "toolu_1", messages[2].ToolCalls[0].ID)
	// tool_use input 按原始字节保留。
	assert.Equal(t, `{"q": 1}`, messages[2].ToolCalls[0].Function.Arguments)
	assert.Equal(t, model.ArchiveMessage{Role: "tool", ToolCallID: "toolu_1", Content: "42"}, messages[3])
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "thanks"}, messages[4])
}

func TestAssembleClaudeStream(t *testing.T) {
	body := "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"role\":\"assistant\"}}\n\n" +
		"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}\n\n" +
		"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n" +
		"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"get\"}}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\":\"}}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"1}\"}}\n\n" +
		"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
	msg, ok := assembleClaudeStream([]byte(body))
	require.True(t, ok)
	assert.Equal(t, "assistant", msg.Role)
	assert.Equal(t, "Hel", msg.Content)
	require.Len(t, msg.ToolCalls, 1)
	assert.Equal(t, "toolu_1", msg.ToolCalls[0].ID)
	assert.Equal(t, `{"q":1}`, msg.ToolCalls[0].Function.Arguments)
}

func TestParseResponsesRequest(t *testing.T) {
	messages := mustArchiveRequestMessages(t, conversationFormatResponses, `{
		"model": "codex-mini",
		"instructions": "be brief",
		"input": [
			{"type": "message", "role": "user", "content": [{"type": "input_text", "text": "run it"}]},
			{"type": "function_call", "call_id": "call_1", "name": "shell", "arguments": "{\"cmd\":\"ls\"}"},
			{"type": "function_call_output", "call_id": "call_1", "output": "a.txt"},
			{"type": "reasoning", "summary": []}
		]
	}`)
	require.Len(t, messages, 4)
	assert.Equal(t, model.ArchiveMessage{Role: "system", Content: "be brief"}, messages[0])
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "run it"}, messages[1])
	assert.Equal(t, "assistant", messages[2].Role)
	require.Len(t, messages[2].ToolCalls, 1)
	assert.Equal(t, "call_1", messages[2].ToolCalls[0].ID)
	assert.Equal(t, `{"cmd":"ls"}`, messages[2].ToolCalls[0].Function.Arguments)
	assert.Equal(t, model.ArchiveMessage{Role: "tool", ToolCallID: "call_1", Content: "a.txt"}, messages[3])
}

func TestParseResponsesStringInput(t *testing.T) {
	messages := mustArchiveRequestMessages(t, conversationFormatResponses, `{"input": "hello"}`)
	require.Len(t, messages, 1)
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "hello"}, messages[0])
}

func TestAssembleResponsesStreamPrefersCompletedOutput(t *testing.T) {
	body := "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"par\"}\n\n" +
		"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"partial done\"}]},{\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"shell\",\"arguments\":\"{}\"}]}}\n\n"
	msg, ok := assembleResponsesStream([]byte(body))
	require.True(t, ok)
	assert.Equal(t, "assistant", msg.Role)
	assert.Equal(t, "partial done", msg.Content)
	require.Len(t, msg.ToolCalls, 1)
	assert.Equal(t, "shell", msg.ToolCalls[0].Function.Name)
}

func TestAssembleGeminiResponse(t *testing.T) {
	// 非流式：单个 JSON 对象。
	msg, ok := assembleGeminiResponse([]byte(`{"candidates":[{"content":{"role":"model","parts":[{"text":"hi"},{"functionCall":{"name":"get","args":{"q":1}}}]}}]}`), false)
	require.True(t, ok)
	assert.Equal(t, "assistant", msg.Role)
	assert.Equal(t, "hi", msg.Content)
	require.Len(t, msg.ToolCalls, 1)
	assert.Equal(t, `{"q":1}`, msg.ToolCalls[0].Function.Arguments)

	// 无 alt=sse 的流式：JSON 分块数组。
	arrayBody := `[{"candidates":[{"content":{"parts":[{"text":"he"},{"thought":true,"text":"think"}]}}]},{"candidates":[{"content":{"parts":[{"text":"llo"}]}}]}]`
	msg, ok = assembleGeminiResponse([]byte(arrayBody), true)
	require.True(t, ok)
	assert.Equal(t, "hello", msg.Content)
	assert.Equal(t, "think", msg.ReasoningContent)

	// alt=sse 流式：SSE 数据行。
	sseBody := "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hey\"}]}}]}\n\n" +
		"data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"get\",\"args\":{}}}]}}]}\n\n"
	msg, ok = assembleGeminiResponse([]byte(sseBody), true)
	require.True(t, ok)
	assert.Equal(t, "hey", msg.Content)
	require.Len(t, msg.ToolCalls, 1)
	assert.Equal(t, "{}", msg.ToolCalls[0].Function.Arguments)
}

func TestParseGeminiRequestNormalizesRoles(t *testing.T) {
	messages := mustArchiveRequestMessages(t, conversationFormatGemini, `{
		"systemInstruction": {"parts": [{"text": "be brief"}]},
		"contents": [
			{"role": "user", "parts": [{"text": "hi"}]},
			{"role": "model", "parts": [{"text": "hello"}]},
			{"role": "user", "parts": [{"functionResponse": {"name": "get", "response": {"result": "42"}}}]}
		]
	}`)
	require.Len(t, messages, 4)
	assert.Equal(t, model.ArchiveMessage{Role: "system", Content: "be brief"}, messages[0])
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "hi"}, messages[1])
	assert.Equal(t, model.ArchiveMessage{Role: "assistant", Content: "hello"}, messages[2])
	assert.Equal(t, "tool", messages[3].Role)
	assert.Equal(t, "get", messages[3].Name)
	// functionResponse 的 JSON 按原始字节保留。
	assert.Equal(t, `{"result": "42"}`, messages[3].Content)
}

func TestParseOpenAITextCompletions(t *testing.T) {
	messages := mustArchiveRequestMessages(t, conversationFormatOpenAIText, `{"prompt": ["one", "two"]}`)
	require.Len(t, messages, 1)
	assert.Equal(t, model.ArchiveMessage{Role: "user", Content: "one\ntwo"}, messages[0])

	msg, ok := assembleOpenAITextResponse([]byte(`{"choices":[{"text":"done"}]}`), false)
	require.True(t, ok)
	assert.Equal(t, model.ArchiveMessage{Role: "assistant", Content: "done"}, msg)
}

func TestConversationArchiveFormatForPath(t *testing.T) {
	cases := map[string]string{
		"/v1/chat/completions":                            conversationFormatOpenAIChat,
		"/pg/chat/completions":                            conversationFormatOpenAIChat,
		"/v1/completions":                                 conversationFormatOpenAIText,
		"/v1/messages":                                    conversationFormatClaude,
		"/v1/responses":                                   conversationFormatResponses,
		"/v1beta/models/gemini-2.0:generateContent":       conversationFormatGemini,
		"/v1beta/models/gemini-2.0:streamGenerateContent": conversationFormatGemini,
		"/v1/models/gemini-2.0:streamGenerateContent":     conversationFormatGemini,
		"/v1/embeddings":                                  "",
		"/v1/images/generations":                          "",
		"/v1/models":                                      "",
		"/v1/responses/compact":                           "",
		"/v1beta/models/gemini-2.0:countTokens":           "",
	}
	for path, expected := range cases {
		format, ok := ConversationArchiveFormatForPath(path)
		if expected == "" {
			assert.False(t, ok, path)
		} else {
			assert.True(t, ok, path)
			assert.Equal(t, expected, format, path)
		}
	}
}

// TestCaptureConversationEndToEnd 覆盖捕获链路：请求体解析 -> 异步去重归档落库。
func TestCaptureConversationEndToEnd(t *testing.T) {
	previousDB := model.DB
	dsn := "file:" + strings.ReplaceAll(t.Name(), "/", "_") + "?mode=memory&cache=shared"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, err := db.DB()
		if err == nil && sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, model.DB.AutoMigrate(&model.ConversationArchive{}))

	setting := operation_setting.GetConversationArchiveSetting()
	previousEnabled := setting.Enabled
	setting.Enabled = true
	t.Cleanup(func() { setting.Enabled = previousEnabled })

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	requestBody := `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(requestBody))
	c.Set("id", 7)
	c.Set("original_model", "gpt-4o")

	responseBody := `{"choices":[{"message":{"role":"assistant","content":"hello!"}}]}`
	CaptureConversation(c, []byte(responseBody), false, http.StatusOK, "application/json")

	// 归档在后台 goroutine 中执行，轮询等待落库。
	var archives []*model.ConversationArchive
	require.Eventually(t, func() bool {
		archives, _, err = model.GetAllConversationArchives(0, 0, "", "", 0, 10)
		return err == nil && len(archives) == 1
	}, 5*time.Second, 20*time.Millisecond, "conversation archive should be written asynchronously")
	require.Len(t, archives, 1)
	assert.Equal(t, "gpt-4o", archives[0].ModelName)
	assert.Equal(t, conversationFormatOpenAIChat, archives[0].Format)
	assert.Contains(t, archives[0].Messages, "hello!")

	// 同一对话重放（相同请求+相同回复）不得产生第二条记录。
	CaptureConversation(c, []byte(responseBody), false, http.StatusOK, "application/json")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		_, total, err := model.GetAllConversationArchives(0, 0, "", "", 0, 10)
		require.NoError(t, err)
		if total != 1 {
			t.Fatalf("duplicate capture must not create a new record, got %d", total)
		}
		if total == 1 {
			break
		}
	}
	_, total, err := model.GetAllConversationArchives(0, 0, "", "", 0, 10)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total, "duplicate capture must not create a new record")
}
