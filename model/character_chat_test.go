package model

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// 解析 BuildCharacterChatRequest 产物，校验各字段
func unmarshalCharacterChatRequest(t *testing.T, body []byte) struct {
	Model    string              `json:"model"`
	Messages []map[string]string `json:"messages"`
	Stream   bool                `json:"stream"`
} {
	t.Helper()
	require.True(t, json.Valid(body))
	var req struct {
		Model    string              `json:"model"`
		Messages []map[string]string `json:"messages"`
		Stream   bool                `json:"stream"`
	}
	require.NoError(t, json.Unmarshal(body, &req))
	return req
}

func TestBuildCharacterChatRequest(t *testing.T) {
	t.Run("insert system prompt at head", func(t *testing.T) {
		body, err := BuildCharacterChatRequest("char-model", "你是观测者", []map[string]string{
			{"role": "user", "content": "你好"},
		})
		require.NoError(t, err)
		req := unmarshalCharacterChatRequest(t, body)
		require.Equal(t, "char-model", req.Model)
		require.True(t, req.Stream)
		require.Len(t, req.Messages, 2)
		require.Equal(t, "system", req.Messages[0]["role"])
		require.Equal(t, "你是观测者", req.Messages[0]["content"])
		require.Equal(t, "user", req.Messages[1]["role"])
		require.Equal(t, "你好", req.Messages[1]["content"])
	})

	t.Run("skip insertion when first message is system", func(t *testing.T) {
		body, err := BuildCharacterChatRequest("char-model", "你是观测者", []map[string]string{
			{"role": "system", "content": "已有系统提示"},
			{"role": "user", "content": "你好"},
		})
		require.NoError(t, err)
		req := unmarshalCharacterChatRequest(t, body)
		require.Len(t, req.Messages, 2)
		require.Equal(t, "system", req.Messages[0]["role"])
		require.Equal(t, "已有系统提示", req.Messages[0]["content"])
		require.NotContains(t, req.Messages[0]["content"], "你是观测者")
	})

	t.Run("model is taken from caller parameter", func(t *testing.T) {
		body, err := BuildCharacterChatRequest("target-model", "prompt", nil)
		require.NoError(t, err)
		req := unmarshalCharacterChatRequest(t, body)
		require.Equal(t, "target-model", req.Model)
	})

	t.Run("stream is always true", func(t *testing.T) {
		body, err := BuildCharacterChatRequest("m", "p", []map[string]string{{"role": "user", "content": "hi"}})
		require.NoError(t, err)
		req := unmarshalCharacterChatRequest(t, body)
		require.True(t, req.Stream)
	})
}
