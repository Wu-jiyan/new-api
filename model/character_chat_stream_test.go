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

func TestParseCharacterChatReplyChoices(t *testing.T) {
	// choices 正常解析与清洗：去空、截断超长文案、最多 4 个
	r, ok := ParseCharacterChatReply(`{"reply":"她看向你","choices":[
		{"text":"  陪她看星星  "},
		{"text":""},
		{"text":"转身离开"},
		{"text":"问她的名字"},
		{"text":"沉默不语"},
		{"text":"多余第六项"}]}`)
	require.True(t, ok)
	require.Len(t, r.Choices, 4)
	require.Equal(t, "陪她看星星", r.Choices[0].Text) // 去首尾空白
	require.Equal(t, "转身离开", r.Choices[1].Text) // 空文案被剔除
	require.Equal(t, "沉默不语", r.Choices[3].Text) // 超出上限截断

	// 超长文案截断到 100 rune
	long := make([]rune, 150)
	for i := range long {
		long[i] = '选'
	}
	r2, ok := ParseCharacterChatReply(`{"reply":"嗯","choices":[{"text":"`+string(long)+`"}]}`)
	require.True(t, ok)
	require.Len(t, r2.Choices, 1)
	require.Len(t, []rune(r2.Choices[0].Text), 100)

	// 无 choices 字段 -> nil
	r3, ok := ParseCharacterChatReply(`{"reply":"闲聊一句"}`)
	require.True(t, ok)
	require.Nil(t, r3.Choices)
}

func TestParseCharacterChatReplyScriptLines(t *testing.T) {
	// 新协议：多句剧本段，最后一句带选项；兼容字段 Reply 取首句
	r, ok := ParseCharacterChatReply(`{"lines":[
		{"speaker":"旁白","text":"  她转过身来。 "},
		{"text":""},
		{"speaker":"DeepSeek娘","text":"你来了呀","pose":"happy","effect":"fade","background":"机房"},
		{"speaker":"DeepSeek娘","text":"接下来你想做什么？","choices":[{"text":"摸摸头"},{"text":""},{"text":"转身逃跑"}]},
		{"text":"多余第五句"}]}`)
	require.True(t, ok)
	require.Len(t, r.Lines, 4) // 空句剔除、8 句内全保留
	require.Equal(t, "旁白", r.Lines[0].Speaker)
	require.Equal(t, "她转过身来。", r.Lines[0].Text) // 去首尾空白
	require.Equal(t, "happy", r.Lines[1].Pose)
	require.Equal(t, "机房", r.Lines[1].Background)
	require.Equal(t, "她转过身来。", r.Reply) // 兼容字段取首句
	require.Len(t, r.Lines[2].Choices, 2)
	require.Equal(t, "摸摸头", r.Lines[2].Choices[0].Text)
}

func TestParseCharacterChatReplyLinesCap(t *testing.T) {
	// 拆句后超过 12 句时保留段尾（结尾句才携带 choices）
	raw := `{"lines":[`
	for i := 0; i < 16; i++ {
		raw += `{"text":"第` + string(rune('A'+i)) + `句"}`
		if i != 15 {
			raw += ","
		}
	}
	raw += `]}`
	r, ok := ParseCharacterChatReply(raw)
	require.True(t, ok)
	require.Len(t, r.Lines, 12)
	require.Equal(t, "第E句", r.Lines[0].Text)
	require.Equal(t, "第P句", r.Lines[11].Text)
}

func TestParseCharacterChatReplySplitsLongLine(t *testing.T) {
	// 长内容拆成短句：括号动作独立、句末标点切分；省略号不拆；选项落在末句
	r, ok := ParseCharacterChatReply(`{"lines":[
		{"speaker":"测试星","text":"（愣了一下，尾巴微微翘起）……抱、拥抱？这不在服务范围内啦！","pose":"shy",
		 "choices":[{"text":"再逗逗她"}]}]}`)
	require.True(t, ok)
	require.Len(t, r.Lines, 3)
	require.Equal(t, "（愣了一下，尾巴微微翘起）", r.Lines[0].Text) // 动作独立成句
	require.Equal(t, "shy", r.Lines[0].Pose)                          // 首句继承姿态
	require.Equal(t, "……抱、拥抱？", r.Lines[1].Text)                      // 省略号不切分
	require.Equal(t, "这不在服务范围内啦！", r.Lines[2].Text)
	require.Len(t, r.Lines[2].Choices, 1) // 选项挂在拆分后的末句
	require.Empty(t, r.Lines[0].Choices)

	// 省略号台词不被拆散
	r2, ok := ParseCharacterChatReply(`{"lines":[{"text":"好……好吧，既然你这么坚持……"}]}`)
	require.True(t, ok)
	require.Len(t, r2.Lines, 1)
	require.Equal(t, "好……好吧，既然你这么坚持……", r2.Lines[0].Text)
}

func TestParseCharacterChatReplyRejectsEmptyLines(t *testing.T) {
	// lines 全为空句且无 reply -> 解析失败
	_, ok := ParseCharacterChatReply(`{"lines":[{"text":" "},{"text":""}]}`)
	require.False(t, ok)
}

func TestCharacterChatMessageChoicesPersistence(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&CharacterChatSession{}, &CharacterChatMessage{}))
	s, err := GetOrCreateCharacterChatSession(424154, "deepseek", 0)
	require.NoError(t, err)

	choices := []CharacterChatChoice{{Text: "留下"}, {Text: "离开"}}
	_, err = AddCharacterChatAssistantMessage(s, "她站在门口", CharacterChatVisual{}, 0, choices)
	require.NoError(t, err)

	var got CharacterChatMessage
	require.NoError(t, DB.Where("session_id = ?", s.Id).First(&got).Error)
	require.NotEmpty(t, got.ChoicesJSON)
	require.Len(t, got.Choices, 2) // AfterFind 回填
	require.Equal(t, "留下", got.Choices[0].Text)

	// 无选项消息：ChoicesJSON 为空、Choices 为 nil
	_, err = AddCharacterChatAssistantMessage(s, "普通台词", CharacterChatVisual{}, 0, nil)
	require.NoError(t, err)
	var plain CharacterChatMessage
	require.NoError(t, DB.Where("session_id = ? AND content = ?", s.Id, "普通台词").First(&plain).Error)
	require.Empty(t, plain.ChoicesJSON)
	require.Nil(t, plain.Choices)
}
