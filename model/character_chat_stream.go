package model

import (
	"encoding/json"
	"strings"
)

// ExtractStreamContent 从 SSE 原始文本聚合 assistant 增量文本。
// 仅识别 OpenAI 流式 data: {...delta.content...} 行；无法解析返回 ok=false。
func ExtractStreamContent(raw string) (string, bool) {
	var b strings.Builder
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		for _, ch := range chunk.Choices {
			b.WriteString(ch.Delta.Content)
		}
	}
	return b.String(), b.Len() > 0
}

// CharacterChatReply 流结束解析出的回复 JSON
type CharacterChatReply struct {
	Reply         string `json:"reply"`
	Pose          string `json:"pose"`
	Effect        string `json:"effect"`
	Background    string `json:"background"`
	AffinityDelta int    `json:"affinity_delta"`
}

// ParseCharacterChatReply 容错解析 AI 回复 JSON：剥围栏/前言后语，取首 '{' 至末 '}' 解析。
// reply 为空视为失败（上游走原文兜底）。
func ParseCharacterChatReply(raw string) (CharacterChatReply, bool) {
	raw = strings.TrimSpace(raw)
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return CharacterChatReply{}, false
	}
	var r CharacterChatReply
	if err := json.Unmarshal([]byte(raw[start:end+1]), &r); err != nil {
		return CharacterChatReply{}, false
	}
	if strings.TrimSpace(r.Reply) == "" {
		return CharacterChatReply{}, false
	}
	return r, true
}
