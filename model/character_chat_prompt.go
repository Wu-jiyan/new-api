package model

import (
	"strings"
)

// characterChatProtocol 输出协议声明（system prompt 尾部）
const characterChatProtocol = `
## 输出协议（每回合严格遵循）
你每一回合只能输出一个 JSON 对象（不带 markdown 代码围栏、不带任何额外文字或解释）：
{
  "reply": "台词正文（必填；这是用户看到的全部台词）",
  "pose": "可选；只能取上列可用姿态名之一；null 或不写表示保持当前姿态",
  "effect": "可选；只能取 fade | black | white；null 或不写表示无过渡",
  "background": "可选；只能取上列可用背景名之一；null 或不写表示保持当前背景",
  "affinity_delta": "可选；整数，表示本条回复让角色好感的变化，范围 -3 到 3（仅供参考，服务端会按规则校验）"
}
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

// BuildCharacterChatPayload 组装整轮请求体（供 /chat SSE 主链路使用）
func BuildCharacterChatPayload(ch *Character, stage CharacterStage, sess *CharacterChatSession, recent []CharacterChatMessage, backgrounds []CharacterBackground) ([]byte, error) {
	sys := BuildCharacterChatSystemPrompt(ch, stage, sess, backgrounds)
	msgs := AssembleCharacterChatMessages(sys, recent)
	return BuildChatCompletionsBody(ch.ModelName, msgs, true)
}
