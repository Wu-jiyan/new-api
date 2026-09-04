package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractStreamContent(t *testing.T) {
	raw := "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\"，世界\"}}]}\n\n" +
		"data: [DONE]\n\n"
	got, ok := ExtractStreamContent(raw)
	require.True(t, ok)
	require.Equal(t, "你好，世界", got)
}

func TestExtractStreamContentInvalid(t *testing.T) {
	_, ok := ExtractStreamContent("not a sse body at all")
	require.False(t, ok)
}

func TestParseCharacterChatReply(t *testing.T) {
	// 裸 JSON
	r, ok := ParseCharacterChatReply(`{"reply":"hi","pose":"happy","effect":"fade","background":"机房","affinity_delta":2}`)
	require.True(t, ok)
	require.Equal(t, "hi", r.Reply)
	require.Equal(t, "happy", r.Pose)
	require.Equal(t, 2, r.AffinityDelta)

	// markdown 围栏
	r2, ok := ParseCharacterChatReply("```json\n{\"reply\":\"ok\"}\n```")
	require.True(t, ok)
	require.Equal(t, "ok", r2.Reply)

	// 前后说明文字
	r3, ok := ParseCharacterChatReply("好的，她说：{\"reply\":\"嗯嗯\",\"affinity_delta\":1} 以上。")
	require.True(t, ok)
	require.Equal(t, "嗯嗯", r3.Reply)

	// 坏 JSON -> 解析失败（走原文兜底）
	_, ok = ParseCharacterChatReply("完全不是 json")
	require.False(t, ok)
}

func TestParseCharacterChatReplyEmptyReply(t *testing.T) {
	// reply 为空视为解析失败（避免落空消息）
	_, ok := ParseCharacterChatReply(`{"pose":"happy"}`)
	require.False(t, ok)
}
