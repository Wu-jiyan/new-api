package model

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func buildPromptFixture(t *testing.T) (*Character, CharacterStage, *CharacterChatSession, []CharacterBackground) {
	t.Helper()
	ch := &Character{ModelName: "deepseek", DisplayName: "深寻", SystemPrompt: "你是深寻，一名少女。", AffinityRequired: 0}
	stage := CharacterStage{Index: 0, Name: "初遇", Poses: []CharacterPose{{Name: "happy", ImageURL: "a.png"}, {Name: "sad", ImageURL: "b.png"}}}
	sess := &CharacterChatSession{Id: 1, StageIndex: 0, InitialContext: "", Summary: "", MessageCount: 45, SummaryThrough: 0}
	bgs := []CharacterBackground{{Name: "机房", ImageURL: "room.png"}}
	return ch, stage, sess, bgs
}

func TestBuildCharacterChatSystemPrompt(t *testing.T) {
	ch, stage, sess, bgs := buildPromptFixture(t)
	sys := BuildCharacterChatSystemPrompt(ch, stage, sess, bgs)
	require.Contains(t, sys, "你是深寻，一名少女。")       // 人设
	require.Contains(t, sys, "初遇")               // 阶段
	require.Contains(t, sys, "happy")            // pose 清单
	require.Contains(t, sys, "机房")               // background 清单
	require.Contains(t, sys, `"affinity_delta"`) // 协议 schema
	// summary / initial_context 注入
	sess.Summary = "早期记忆：她喜欢观星。"
	sys2 := BuildCharacterChatSystemPrompt(ch, stage, sess, bgs)
	require.Contains(t, sys2, "早期记忆：她喜欢观星。")
	sess.Summary = ""
	sess.InitialContext = "剧情回顾：你们刚在机房相遇。"
	sys3 := BuildCharacterChatSystemPrompt(ch, stage, sess, bgs)
	require.Contains(t, sys3, "剧情回顾：你们刚在机房相遇。")
}

func TestDefaultCharacterSystemPrompt(t *testing.T) {
	ch, stage, sess, bgs := buildPromptFixture(t)
	ch.SystemPrompt = ""
	sys := BuildCharacterChatSystemPrompt(ch, stage, sess, bgs)
	require.Contains(t, sys, "galgame") // 默认人设兜底
}

func TestAssembleCharacterChatMessagesWindow(t *testing.T) {
	msgs := make([]CharacterChatMessage, 0, 50)
	for i := 0; i < 50; i++ {
		msgs = append(msgs, CharacterChatMessage{Role: "user", Content: "m" + string(rune('a'+i%26))})
	}
	sys := "SYS"
	out := AssembleCharacterChatMessages(sys, msgs)
	require.Len(t, out, CharacterChatWindowSize+1)
	require.Equal(t, "system", out[0]["role"])
	// 窗口保留的是最后 40 条：out[1] 对应 msgs[10]（'a'+10='k'）
	require.Equal(t, "mk", out[1]["content"])
}

func TestBuildCharacterChatPayload(t *testing.T) {
	ch, stage, sess, bgs := buildPromptFixture(t)
	recent := []CharacterChatMessage{{Role: "user", Content: "最后一问"}}
	body, err := BuildCharacterChatPayload(ch, stage, sess, recent, bgs)
	require.NoError(t, err)
	var decoded struct {
		Model    string              `json:"model"`
		Messages []map[string]string `json:"messages"`
		Stream   bool                `json:"stream"`
	}
	require.NoError(t, json.Unmarshal(body, &decoded))
	require.Equal(t, "deepseek", decoded.Model)
	require.True(t, decoded.Stream)
	require.Equal(t, "system", decoded.Messages[0]["role"])
	require.Equal(t, "user", decoded.Messages[1]["role"])
	require.Equal(t, "最后一问", decoded.Messages[1]["content"])
}
