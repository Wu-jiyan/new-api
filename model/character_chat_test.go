package model

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildChatCompletionsBody(t *testing.T) {
	msgs := []map[string]string{
		{"role": "system", "content": "sys"},
		{"role": "user", "content": "hi"},
	}
	body, err := BuildChatCompletionsBody("m", msgs, true, "")
	require.NoError(t, err)
	var decoded struct {
		Model    string              `json:"model"`
		Messages []map[string]string `json:"messages"`
		Stream   bool                `json:"stream"`
	}
	require.NoError(t, json.Unmarshal(body, &decoded))
	require.Equal(t, "m", decoded.Model)
	require.True(t, decoded.Stream)
	require.Len(t, decoded.Messages, 2)
	body2, err := BuildChatCompletionsBody("m", msgs, false, "")
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(body2, &decoded))
	require.False(t, decoded.Stream)
}
