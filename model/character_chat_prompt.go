package model

import (
	"strings"
)

// characterChatProtocol 输出协议声明（system prompt 尾部）
const characterChatProtocol = `
## 输出协议（每回合严格遵循）
你每一回合只能输出一个 JSON 对象（不带 markdown 代码围栏、不带任何额外文字或解释）。
你是在创作 galgame 剧本：每一回合生成一段由多个短句组成的剧本，逐句播放给玩家：
{
  "lines": [
    { "speaker": "旁白", "text": "（机房的风扇声忽然停了。）" },
    { "speaker": "角色名", "text": "（鼓起勇气，声音带着一丝犹豫）" },
    { "speaker": "角色名", "text": "好……好吧，既然你这么坚持……", "pose": "shy" },
    { "speaker": "角色名", "text": "那说好了，只看一眼哦。", "choices": [ { "text": "点点头" }, { "text": "再逗她一句" } ] }
  ],
  "affinity_delta": 1
}
字段规则：
- lines：必填数组，4 到 8 句。每回合要推进一段完整的小剧情（动作、反应、情绪转折），最后一句必须带 choices 结尾。禁止只输出一两句的回合。
- 拆句：一次只写一个动作（用括号包住）或一句台词。长台词与连续动作必须拆成多句，一句一拍。省略号（……）表示语气拖延，不作为拆分点。
- 括号动作描写不带主语、不带名字：写（鼓起勇气，声音带着一丝犹豫），不要写（她鼓起勇气……）也不要写（测试星鼓起勇气……）。
- speaker：台词填你自己（角色）的名字；环境、场景与氛围描写用 "旁白"。text 里绝对不要重复写自己的名字（界面已经显示说话人）。
- text：简短口语，每句一般不超过 30 字。不要替玩家生成发言——玩家的选择会作为用户消息注入；玩家消息为 "（继续剧情）" 时不是玩家的发言或回应，只是玩家点击继续的信号，不要让角色对此发表评论，直接自然往下推进剧情。
- pose：当上方列出了可用姿态时**每回合至少使用一次**（跟随剧情情绪变化，如害羞用 shy、惊讶用 surprised）；只能取列表中的名字，不写表示保持。没有列出姿态时省略此字段。
- effect：可选，只能取 fade | black | white，用于场景/姿态切换的过渡。
- background：可选，只能取上列可用背景名之一；不写表示保持当前背景。
- choices：最后一句必须携带，2 到 4 项，每项 {"text": "简短的玩家第一人称台词或行动"}。禁止在没有 choices 的情况下结束回合，禁止连续生成多段而不给玩家选择。
- affinity_delta：可选整数 -3 到 3，本段剧情让角色好感的变化（服务端会校验限幅）。

输出前自查（每回合必须全部满足）：
1. lines 有 4~8 句，剧情有实际推进？
2. 最后一句带 choices（2~4 项）？——漏掉 choices 是严重错误。
3. 若列出了可用姿态：本回合至少用了一次 pose，且名字来自列表？
4. 括号动作无主语、无名字？每句不超过 30 字？
只输出上述 JSON 对象本身。`

// BuildCharacterChatSystemPrompt 拼装角色对话 system prompt。
// 顺序：角色人设 → 阶段设定 → 可用视觉资源清单 → 剧情回顾 → 记忆摘要 → 输出协议。
func BuildCharacterChatSystemPrompt(ch *Character, stage CharacterStage, sess *CharacterChatSession, backgrounds []CharacterBackground) string {
	var b strings.Builder
	persona := ch.SystemPrompt
	if strings.TrimSpace(persona) == "" {
		persona = "你是一位 galgame 女主角。始终沉浸于角色扮演：按设定人设说话，用中文口语化表达，简短自然，允许少量内心独白与表情动作描写（用（……）括起）。"
	}
	b.WriteString(persona)

	b.WriteString("\n\n## 当前场景\n")
	b.WriteString("阶段：")
	b.WriteString(stage.Name)
	if stage.DefaultEffect != "" {
		b.WriteString("（阶段默认过渡：")
		b.WriteString(stage.DefaultEffect)
		b.WriteString("）")
	}

	if len(stage.Poses) > 0 {
		b.WriteString("\n\n## 当前阶段可用姿态\n")
		names := make([]string, 0, len(stage.Poses))
		for _, p := range stage.Poses {
			names = append(names, p.Name)
		}
		b.WriteString(strings.Join(names, "、"))
	}
	if len(backgrounds) > 0 {
		b.WriteString("\n\n## 可用背景\n")
		names := make([]string, 0, len(backgrounds))
		for _, bg := range backgrounds {
			names = append(names, bg.Name)
		}
		b.WriteString(strings.Join(names, "、"))
	}

	if strings.TrimSpace(sess.InitialContext) != "" {
		b.WriteString("\n\n## 剧情回顾（从小剧场带入，务必延续）\n")
		b.WriteString(sess.InitialContext)
	}
	if strings.TrimSpace(sess.Summary) != "" {
		b.WriteString("\n\n## 早期记忆摘要（发生在较久以前，保持连贯）\n")
		b.WriteString(sess.Summary)
	}
	b.WriteString("\n")
	b.WriteString(characterChatProtocol)
	return b.String()
}

// AssembleCharacterChatMessages 组装 system + 窗口历史（仅取最近 CharacterChatWindowSize 条原文）
func AssembleCharacterChatMessages(sys string, recent []CharacterChatMessage) []map[string]string {
	start := 0
	if len(recent) > CharacterChatWindowSize {
		start = len(recent) - CharacterChatWindowSize
	}
	out := make([]map[string]string, 0, 1+len(recent)-start)
	out = append(out, map[string]string{"role": "system", "content": sys})
	for _, m := range recent[start:] {
		out = append(out, map[string]string{"role": m.Role, "content": m.Content})
	}
	return out
}

// BuildCharacterChatPayload 组装整轮请求体（供 /chat SSE 主链路使用）。
// chatModel 为会话选定的具体模型（前缀内），chatGroup 为选定分组（空=用户默认）。
func BuildCharacterChatPayload(ch *Character, stage CharacterStage, sess *CharacterChatSession, recent []CharacterChatMessage, backgrounds []CharacterBackground, chatModel string, chatGroup string) ([]byte, error) {
	sys := BuildCharacterChatSystemPrompt(ch, stage, sess, backgrounds)
	msgs := AssembleCharacterChatMessages(sys, recent)
	return BuildChatCompletionsBody(chatModel, msgs, true, chatGroup)
}
