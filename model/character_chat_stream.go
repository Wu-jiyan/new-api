package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
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
		if err := common.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		for _, ch := range chunk.Choices {
			b.WriteString(ch.Delta.Content)
		}
	}
	return b.String(), b.Len() > 0
}

// CharacterChatChoice AI 回复携带的回答选项（玩家点击后以 text 作为下一条 user 输入）
type CharacterChatChoice struct {
	Text string `json:"text"`
}

// CharacterChatLine 剧本段中的单句台词（pose/effect/background 引用阶段与背景库资源）
type CharacterChatLine struct {
	Speaker    string                `json:"speaker,omitempty"`
	Text       string                `json:"text"`
	Pose       string                `json:"pose,omitempty"`
	Effect     string                `json:"effect,omitempty"`
	Background string                `json:"background,omitempty"`
	Choices    []CharacterChatChoice `json:"choices,omitempty"`
}

// CharacterChatReply 流结束解析出的回复：LLM 每回合生成一段多句剧本（lines），兼容旧单句 {reply} 形态
type CharacterChatReply struct {
	Lines         []CharacterChatLine   `json:"lines"`
	Reply         string                `json:"reply"` // 旧协议兼容；lines 存在时取首句文本
	Pose          string                `json:"pose"`
	Effect        string                `json:"effect"`
	Background    string                `json:"background"`
	AffinityDelta int                   `json:"affinity_delta"`
	Choices       []CharacterChatChoice `json:"choices"`
}

// maxChatChoices 单句允许携带的选项上限；maxChatLinesPerTurn 拆句后单回合台词上限
const maxChatChoices = 4
const maxChatLinesPerTurn = 12

// SplitLongLine 把一句长内容拆成多个短句：括号动作独立成句，其余按句末标点切分。
// 省略号（……）与波浪号不作为切分点，保证 "好……好吧，既然你这么坚持……" 这类台词不被拆散。
func SplitLongLine(text string) []string {
	runes := []rune(text)
	var units []string
	var buf strings.Builder
	inParen := false
	for _, r := range runes {
		buf.WriteRune(r)
		if r == '（' || r == '(' {
			inParen = true
			continue
		}
		end := false
		if inParen && (r == '）' || r == ')') {
			inParen = false
			end = true
		} else if !inParen &&
			(r == '。' || r == '！' || r == '？' || r == '!' || r == '?' || r == '；' || r == ';' || r == '\n') {
			end = true
		}
		if end {
			if t := strings.TrimSpace(buf.String()); t != "" {
				units = append(units, t)
			}
			buf.Reset()
		}
	}
	if t := strings.TrimSpace(buf.String()); t != "" {
		units = append(units, t)
	}
	return units
}

// sanitizeChatChoices 清洗 AI 给出的选项：去空、截断过长文案、最多保留 maxChatChoices 个
func sanitizeChatChoices(choices []CharacterChatChoice) []CharacterChatChoice {
	out := make([]CharacterChatChoice, 0, len(choices))
	for _, c := range choices {
		text := strings.TrimSpace(c.Text)
		if text == "" {
			continue
		}
		if len(text) > 100 {
			text = string([]rune(text)[:100])
		}
		out = append(out, CharacterChatChoice{Text: text})
		if len(out) >= maxChatChoices {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// sanitizeChatLine 清洗单句台词：text 必须非空（截断 300 rune），其余字段去空白并清洗选项
func sanitizeChatLine(l CharacterChatLine) (CharacterChatLine, bool) {
	text := strings.TrimSpace(l.Text)
	if text == "" {
		return CharacterChatLine{}, false
	}
	if len([]rune(text)) > 300 {
		text = string([]rune(text)[:300])
	}
	l.Speaker = strings.TrimSpace(l.Speaker)
	l.Pose = strings.TrimSpace(l.Pose)
	l.Effect = strings.TrimSpace(l.Effect)
	l.Background = strings.TrimSpace(l.Background)
	l.Text = text
	l.Choices = sanitizeChatChoices(l.Choices)
	return l, true
}

// ParseCharacterChatReply 容错解析 AI 回复 JSON：剥围栏/前言后语，取首 '{' 至末 '}' 解析。
// 新协议为 {lines: [...]} 多句剧本段；兼容旧协议单句 {reply, pose, ...}。
// 无有效台词视为失败（上游走原文兜底）；choices 就地清洗。
func ParseCharacterChatReply(raw string) (CharacterChatReply, bool) {
	raw = strings.TrimSpace(raw)
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return CharacterChatReply{}, false
	}
	var r CharacterChatReply
	if err := common.Unmarshal([]byte(raw[start:end+1]), &r); err != nil {
		return CharacterChatReply{}, false
	}
	if len(r.Lines) > 0 {
		out := make([]CharacterChatLine, 0, len(r.Lines))
		for _, l := range r.Lines {
			cleaned, ok := sanitizeChatLine(l)
			if !ok {
				continue
			}
			// 长内容拆成短句：一句一动/一句一台词；选项挂在拆分后的末句
			units := SplitLongLine(cleaned.Text)
			for i, unit := range units {
				u := cleaned
				u.Text = unit
				if i != len(units)-1 {
					u.Choices = nil
				}
				out = append(out, u)
			}
		}
		if len(out) == 0 {
			return CharacterChatReply{}, false
		}
		// 超上限时保留段尾：结尾句才携带 choices
		if len(out) > maxChatLinesPerTurn {
			out = out[len(out)-maxChatLinesPerTurn:]
		}
		r.Lines = out
		r.Reply = out[0].Text
		return r, true
	}
	// 旧协议兼容：单句对象视为一段
	reply := strings.TrimSpace(r.Reply)
	if reply == "" {
		return CharacterChatReply{}, false
	}
	choices := sanitizeChatChoices(r.Choices)
	r.Choices = choices
	r.Lines = []CharacterChatLine{{
		Text:       reply,
		Pose:       strings.TrimSpace(r.Pose),
		Effect:     strings.TrimSpace(r.Effect),
		Background: strings.TrimSpace(r.Background),
		Choices:    choices,
	}}
	return r, true
}
