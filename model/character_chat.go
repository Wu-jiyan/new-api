package model

import "encoding/json"

// BuildChatCompletionsBody 构造 chat/completions JSON 请求体。
// messages 由调用方完整组装（首条为 role=system）；stream 控制流式与否。
func BuildChatCompletionsBody(model string, messages []map[string]string, stream bool) ([]byte, error) {
	return json.Marshal(map[string]interface{}{
		"model":    model,
		"messages": messages,
		"stream":   stream,
	})
}
