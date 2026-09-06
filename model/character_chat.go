package model

import "github.com/QuantumNous/new-api/common"

// BuildChatCompletionsBody 构造 chat/completions JSON 请求体。
// messages 由调用方完整组装（首条为 role=system）；stream 控制流式与否；
// group 非空时随体携带（/pg 分发器校验后覆盖用户分组）。
func BuildChatCompletionsBody(model string, messages []map[string]string, stream bool, group string) ([]byte, error) {
	body := map[string]interface{}{
		"model":    model,
		"messages": messages,
		"stream":   stream,
	}
	if group != "" {
		body["group"] = group
	}
	return common.Marshal(body)
}
