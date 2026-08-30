package model

import (
	"encoding/json"
)

// BuildCharacterChatRequest 构造角色对话 chat/completions 请求体。
// model 由调用方指定；messages 头部插入 {role:"system",content:systemPrompt}，
// 若 messages 第一条已是 system 则跳过插入避免冲突；stream 固定为 true。
func BuildCharacterChatRequest(model string, systemPrompt string, messages []map[string]string) ([]byte, error) {
	msgs := make([]map[string]string, 0, len(messages)+1)
	firstIsSystem := len(messages) > 0 && messages[0]["role"] == "system"
	if systemPrompt != "" && !firstIsSystem {
		msgs = append(msgs, map[string]string{"role": "system", "content": systemPrompt})
	}
	msgs = append(msgs, messages...)

	return json.Marshal(map[string]interface{}{
		"model":    model,
		"messages": msgs,
		"stream":   true,
	})
}
