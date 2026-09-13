package service

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// 本文件把各 relay 格式（OpenAI Chat/文本补全、Claude、Gemini、Responses）的
// 客户端可见请求/响应解析并规范化为 model.ArchiveMessage。规范化必须稳定：
// 同一会话两轮请求的消息列表规范化结果需保持前缀一致，跨格式续写亦能匹配。

// ---- 公共工具 ----

func isArchiveMessageEmpty(m model.ArchiveMessage) bool {
	return m.Content == "" && m.ReasoningContent == "" && len(m.ToolCalls) == 0 && m.ToolCallID == ""
}

// archiveSSEDataItems 提取 SSE 缓冲中的所有 data 行内容。
func archiveSSEDataItems(raw []byte) []string {
	items := make([]string, 0, 8)
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimRight(line, "\r")
		if data, ok := strings.CutPrefix(line, "data:"); ok {
			data = strings.TrimSpace(data)
			if data != "" && data != "[DONE]" {
				items = append(items, data)
			}
		}
	}
	return items
}

// ---- OpenAI Chat Completions ----

type archiveOpenAIMessage struct {
	Role             string                  `json:"role"`
	Content          json.RawMessage         `json:"content"`
	ReasoningContent string                  `json:"reasoning_content"`
	ToolCalls        []model.ArchiveToolCall `json:"tool_calls"`
	ToolCallID       string                  `json:"tool_call_id"`
	Name             string                  `json:"name"`
}

type archiveOpenAIChatRequest struct {
	Messages []archiveOpenAIMessage `json:"messages"`
}

type archiveOpenAIChatResponse struct {
	Choices []struct {
		Message archiveOpenAIMessage `json:"message"`
		Text    string               `json:"text"`
	} `json:"choices"`
}

type archiveOpenAIDeltaToolCall struct {
	Index    int    `json:"index"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type archiveOpenAIChatChunk struct {
	Choices []struct {
		Delta struct {
			Role             string                       `json:"role"`
			Content          string                       `json:"content"`
			ReasoningContent string                       `json:"reasoning_content"`
			ToolCalls        []archiveOpenAIDeltaToolCall `json:"tool_calls"`
		} `json:"delta"`
	} `json:"choices"`
}

// archiveTextFromContent 解析 OpenAI 风格 content：字符串或 {type,text} 分块数组。
func archiveTextFromContent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := common.Unmarshal(raw, &text); err == nil {
		return text
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := common.Unmarshal(raw, &parts); err == nil {
		var b strings.Builder
		for _, part := range parts {
			// 兼容 OpenAI content part 与 Responses 的 input_text/output_text。
			switch part.Type {
			case "text", "input_text", "output_text":
			default:
				continue
			}
			if part.Text == "" {
				continue
			}
			if b.Len() > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(part.Text)
		}
		return b.String()
	}
	return ""
}

func parseOpenAIChatRequest(body []byte) ([]model.ArchiveMessage, bool) {
	var req archiveOpenAIChatRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, false
	}
	messages := make([]model.ArchiveMessage, 0, len(req.Messages))
	for i := range req.Messages {
		src := &req.Messages[i]
		msg := model.ArchiveMessage{
			Role:             src.Role,
			Content:          archiveTextFromContent(src.Content),
			ReasoningContent: src.ReasoningContent,
			ToolCalls:        src.ToolCalls,
			ToolCallID:       src.ToolCallID,
			Name:             src.Name,
		}
		if isArchiveMessageEmpty(msg) {
			continue
		}
		messages = append(messages, msg)
	}
	return messages, true
}

func assembleOpenAIChatResponse(body []byte) (model.ArchiveMessage, bool) {
	var resp archiveOpenAIChatResponse
	if err := common.Unmarshal(body, &resp); err != nil || len(resp.Choices) == 0 {
		return model.ArchiveMessage{}, false
	}
	first := &resp.Choices[0]
	if first.Message.Role != "" || first.Message.Content != nil || len(first.Message.ToolCalls) > 0 {
		msg := model.ArchiveMessage{
			Role:             "assistant",
			Content:          archiveTextFromContent(first.Message.Content),
			ReasoningContent: first.Message.ReasoningContent,
			ToolCalls:        first.Message.ToolCalls,
		}
		return msg, true
	}
	return model.ArchiveMessage{Role: "assistant", Content: first.Text}, true
}

func assembleOpenAIChatStream(body []byte) (model.ArchiveMessage, bool) {
	var content, reasoning strings.Builder
	var toolCalls []model.ArchiveToolCall
	toolIndex := make(map[int]int) // 上游 index -> toolCalls 下标
	for _, item := range archiveSSEDataItems(body) {
		var chunk archiveOpenAIChatChunk
		if err := common.UnmarshalJsonStr(item, &chunk); err != nil || len(chunk.Choices) == 0 {
			continue
		}
		delta := &chunk.Choices[0].Delta
		content.WriteString(delta.Content)
		reasoning.WriteString(delta.ReasoningContent)
		for i := range delta.ToolCalls {
			call := &delta.ToolCalls[i]
			idx, ok := toolIndex[call.Index]
			if !ok {
				idx = len(toolCalls)
				toolIndex[call.Index] = idx
				toolCalls = append(toolCalls, model.ArchiveToolCall{ID: call.ID, Type: call.Type})
			}
			if call.ID != "" {
				toolCalls[idx].ID = call.ID
			}
			if call.Type != "" {
				toolCalls[idx].Type = call.Type
			}
			toolCalls[idx].Function.Name += call.Function.Name
			toolCalls[idx].Function.Arguments += call.Function.Arguments
		}
	}
	msg := model.ArchiveMessage{
		Role:             "assistant",
		Content:          content.String(),
		ReasoningContent: reasoning.String(),
		ToolCalls:        toolCalls,
	}
	return msg, true
}

// ---- OpenAI 文本补全（legacy completions） ----

type archiveOpenAITextRequest struct {
	Prompt json.RawMessage `json:"prompt"`
}

func archiveTextFromStringOrList(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := common.Unmarshal(raw, &text); err == nil {
		return text
	}
	var list []string
	if err := common.Unmarshal(raw, &list); err == nil {
		return strings.Join(list, "\n")
	}
	return ""
}

func parseOpenAITextRequest(body []byte) ([]model.ArchiveMessage, bool) {
	var req archiveOpenAITextRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, false
	}
	prompt := archiveTextFromStringOrList(req.Prompt)
	if prompt == "" {
		return nil, false
	}
	return []model.ArchiveMessage{{Role: "user", Content: prompt}}, true
}

func assembleOpenAITextResponse(body []byte, isStream bool) (model.ArchiveMessage, bool) {
	var content strings.Builder
	if isStream {
		for _, item := range archiveSSEDataItems(body) {
			var chunk archiveOpenAIChatResponse
			if err := common.UnmarshalJsonStr(item, &chunk); err != nil || len(chunk.Choices) == 0 {
				continue
			}
			content.WriteString(chunk.Choices[0].Text)
		}
	} else {
		var resp archiveOpenAIChatResponse
		if err := common.Unmarshal(body, &resp); err != nil || len(resp.Choices) == 0 {
			return model.ArchiveMessage{}, false
		}
		content.WriteString(resp.Choices[0].Text)
	}
	return model.ArchiveMessage{Role: "assistant", Content: content.String()}, true
}

// ---- Claude /v1/messages ----

type archiveClaudeMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type archiveClaudeRequest struct {
	System   json.RawMessage        `json:"system"`
	Messages []archiveClaudeMessage `json:"messages"`
}

type archiveClaudeBlock struct {
	Type        string          `json:"type"`
	Text        string          `json:"text"`
	Thinking    string          `json:"thinking"`
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Input       json.RawMessage `json:"input"`
	ToolUseID   string          `json:"tool_use_id"`
	Content     json.RawMessage `json:"content"`
	PartialJSON string          `json:"partial_json"`
}

type archiveClaudeStreamEvent struct {
	Type         string                    `json:"type"`
	Index        int                       `json:"index"`
	ContentBlock *archiveClaudeBlock       `json:"content_block"`
	Delta        *archiveClaudeStreamDelta `json:"delta"`
}

type archiveClaudeStreamDelta struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	Thinking    string `json:"thinking"`
	PartialJSON string `json:"partial_json"`
}

// appendArchiveClaudeContent 把一段 Claude content（字符串或分块数组）展开为
// 统一消息并追加到 out。user 消息中的 tool_result 会展开为独立的 tool 消息。
func appendArchiveClaudeContent(out []model.ArchiveMessage, role string, raw json.RawMessage) []model.ArchiveMessage {
	var text, reasoning strings.Builder
	var toolCalls []model.ArchiveToolCall
	var toolResults []model.ArchiveMessage

	appendText := func(b *strings.Builder, value string) {
		if value == "" {
			return
		}
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(value)
	}

	var blocks []archiveClaudeBlock
	if err := common.Unmarshal(raw, &blocks); err == nil {
		for i := range blocks {
			block := &blocks[i]
			switch block.Type {
			case "text", "input_text", "output_text":
				appendText(&text, block.Text)
			case "thinking":
				appendText(&reasoning, block.Thinking)
			case "tool_use":
				toolCalls = append(toolCalls, model.ArchiveToolCall{
					ID:       block.ID,
					Type:     "function",
					Function: model.ArchiveToolFunction{Name: block.Name, Arguments: string(block.Input)},
				})
			case "tool_result":
				toolResults = append(toolResults, model.ArchiveMessage{
					Role:       "tool",
					ToolCallID: block.ToolUseID,
					Content:    archiveTextFromContent(block.Content),
				})
			}
		}
	} else {
		appendText(&text, archiveTextFromContent(raw))
	}

	// OpenAI 语义中 tool 结果紧随 assistant 消息之后，排在文本前。
	out = append(out, toolResults...)
	msg := model.ArchiveMessage{
		Role:             role,
		Content:          text.String(),
		ReasoningContent: reasoning.String(),
		ToolCalls:        toolCalls,
	}
	if !isArchiveMessageEmpty(msg) {
		out = append(out, msg)
	}
	return out
}

func parseClaudeRequest(body []byte) ([]model.ArchiveMessage, bool) {
	var req archiveClaudeRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, false
	}
	messages := make([]model.ArchiveMessage, 0, len(req.Messages)+1)
	if system := archiveTextFromContent(req.System); system != "" {
		messages = append(messages, model.ArchiveMessage{Role: "system", Content: system})
	}
	for i := range req.Messages {
		messages = appendArchiveClaudeContent(messages, req.Messages[i].Role, req.Messages[i].Content)
	}
	return messages, true
}

func assembleClaudeResponse(body []byte) (model.ArchiveMessage, bool) {
	var resp struct {
		Content json.RawMessage `json:"content"`
	}
	if err := common.Unmarshal(body, &resp); err != nil {
		return model.ArchiveMessage{}, false
	}
	var merged []model.ArchiveMessage
	merged = appendArchiveClaudeContent(merged, "assistant", resp.Content)
	// Claude 响应不会包含 tool_result，最多产出一条 assistant 消息。
	for i := range merged {
		if merged[i].Role == "assistant" {
			return merged[i], true
		}
	}
	return model.ArchiveMessage{}, false
}

func assembleClaudeStream(body []byte) (model.ArchiveMessage, bool) {
	type blockAcc struct {
		text      strings.Builder
		reasoning strings.Builder
		toolCall  *model.ArchiveToolCall
		arguments strings.Builder
	}
	var accs []*blockAcc
	for _, item := range archiveSSEDataItems(body) {
		var event archiveClaudeStreamEvent
		if err := common.UnmarshalJsonStr(item, &event); err != nil {
			continue
		}
		switch event.Type {
		case "content_block_start":
			acc := &blockAcc{}
			if event.ContentBlock != nil && event.ContentBlock.Type == "tool_use" {
				acc.toolCall = &model.ArchiveToolCall{
					ID:       event.ContentBlock.ID,
					Type:     "function",
					Function: model.ArchiveToolFunction{Name: event.ContentBlock.Name},
				}
			}
			accs = append(accs, acc)
		case "content_block_delta":
			if len(accs) == 0 || event.Delta == nil || event.Index >= len(accs) {
				continue
			}
			acc := accs[event.Index]
			switch event.Delta.Type {
			case "text_delta":
				acc.text.WriteString(event.Delta.Text)
			case "thinking_delta":
				acc.reasoning.WriteString(event.Delta.Thinking)
			case "input_json_delta":
				acc.arguments.WriteString(event.Delta.PartialJSON)
			}
		}
	}
	var text, reasoning strings.Builder
	var toolCalls []model.ArchiveToolCall
	for _, acc := range accs {
		if text.Len() > 0 && acc.text.Len() > 0 {
			text.WriteByte('\n')
		}
		text.WriteString(acc.text.String())
		if reasoning.Len() > 0 && acc.reasoning.Len() > 0 {
			reasoning.WriteByte('\n')
		}
		reasoning.WriteString(acc.reasoning.String())
		if acc.toolCall != nil {
			acc.toolCall.Function.Arguments = acc.arguments.String()
			toolCalls = append(toolCalls, *acc.toolCall)
		}
	}
	return model.ArchiveMessage{
		Role:             "assistant",
		Content:          text.String(),
		ReasoningContent: reasoning.String(),
		ToolCalls:        toolCalls,
	}, true
}

// ---- OpenAI Responses ----

type archiveResponsesItem struct {
	Type      string          `json:"type"`
	Role      string          `json:"role"`
	Content   json.RawMessage `json:"content"`
	CallID    string          `json:"call_id"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments string          `json:"arguments"`
	Output    string          `json:"output"`
}

type archiveResponsesRequest struct {
	Instructions json.RawMessage `json:"instructions"`
	Input        json.RawMessage `json:"input"`
}

type archiveResponsesResponse struct {
	Output []archiveResponsesItem `json:"output"`
}

type archiveResponsesStreamEvent struct {
	Type     string                    `json:"type"`
	Delta    string                    `json:"delta"`
	Response *archiveResponsesResponse `json:"response"`
}

// appendArchiveResponsesItems 展开 Responses 的 input/output 条目。
// function_call 连续条目合并进同一条 assistant 消息，与 OpenAI 语义一致。
func appendArchiveResponsesItems(messages []model.ArchiveMessage, items []archiveResponsesItem) []model.ArchiveMessage {
	for i := range items {
		item := &items[i]
		switch item.Type {
		case "message":
			role := item.Role
			if role == "" {
				role = "user"
			}
			messages = appendArchiveClaudeContent(messages, role, item.Content)
		case "function_call":
			callID := item.CallID
			if callID == "" {
				callID = item.ID
			}
			call := model.ArchiveToolCall{
				ID:       callID,
				Type:     "function",
				Function: model.ArchiveToolFunction{Name: item.Name, Arguments: item.Arguments},
			}
			if n := len(messages); n > 0 && messages[n-1].Role == "assistant" && len(messages[n-1].ToolCalls) > 0 {
				messages[n-1].ToolCalls = append(messages[n-1].ToolCalls, call)
			} else {
				messages = append(messages, model.ArchiveMessage{Role: "assistant", ToolCalls: []model.ArchiveToolCall{call}})
			}
		case "function_call_output":
			messages = append(messages, model.ArchiveMessage{
				Role:       "tool",
				ToolCallID: item.CallID,
				Content:    item.Output,
			})
		}
	}
	return messages
}

func parseResponsesRequest(body []byte) ([]model.ArchiveMessage, bool) {
	var req archiveResponsesRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, false
	}
	messages := make([]model.ArchiveMessage, 0, 8)
	if instructions := archiveTextFromContent(req.Instructions); instructions != "" {
		messages = append(messages, model.ArchiveMessage{Role: "system", Content: instructions})
	}
	var inputText string
	if err := common.Unmarshal(req.Input, &inputText); err == nil {
		if inputText != "" {
			messages = append(messages, model.ArchiveMessage{Role: "user", Content: inputText})
		}
	} else {
		var items []archiveResponsesItem
		if err := common.Unmarshal(req.Input, &items); err == nil {
			messages = appendArchiveResponsesItems(messages, items)
		}
	}
	return messages, true
}

func assembleResponsesResponse(body []byte) (model.ArchiveMessage, bool) {
	var resp archiveResponsesResponse
	if err := common.Unmarshal(body, &resp); err != nil || len(resp.Output) == 0 {
		return model.ArchiveMessage{}, false
	}
	return mergeResponsesOutputItems(resp.Output), true
}

// mergeResponsesOutputItems 把 Responses 的 output 条目合并为单条 assistant 消息。
func mergeResponsesOutputItems(items []archiveResponsesItem) model.ArchiveMessage {
	var text strings.Builder
	var toolCalls []model.ArchiveToolCall
	for i := range items {
		item := &items[i]
		switch item.Type {
		case "message":
			var parts []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}
			if err := common.Unmarshal(item.Content, &parts); err == nil {
				for _, part := range parts {
					if part.Text == "" {
						continue
					}
					if text.Len() > 0 {
						text.WriteByte('\n')
					}
					text.WriteString(part.Text)
				}
			} else {
				text.WriteString(archiveTextFromContent(item.Content))
			}
		case "function_call":
			callID := item.CallID
			if callID == "" {
				callID = item.ID
			}
			toolCalls = append(toolCalls, model.ArchiveToolCall{
				ID:       callID,
				Type:     "function",
				Function: model.ArchiveToolFunction{Name: item.Name, Arguments: item.Arguments},
			})
		}
	}
	return model.ArchiveMessage{
		Role:      "assistant",
		Content:   text.String(),
		ToolCalls: toolCalls,
	}
}

func assembleResponsesStream(body []byte) (model.ArchiveMessage, bool) {
	var deltaText strings.Builder
	var completed *archiveResponsesResponse
	for _, item := range archiveSSEDataItems(body) {
		var event archiveResponsesStreamEvent
		if err := common.UnmarshalJsonStr(item, &event); err != nil {
			continue
		}
		switch event.Type {
		case "response.output_text.delta":
			deltaText.WriteString(event.Delta)
		case "response.completed":
			if event.Response != nil {
				completed = event.Response
			}
		}
	}
	if completed != nil && len(completed.Output) > 0 {
		return mergeResponsesOutputItems(completed.Output), true
	}
	if deltaText.Len() > 0 {
		return model.ArchiveMessage{Role: "assistant", Content: deltaText.String()}, true
	}
	return model.ArchiveMessage{}, false
}

// ---- Gemini ----

type archiveGeminiFuncCall struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type archiveGeminiFuncResp struct {
	Name     string          `json:"name"`
	Response json.RawMessage `json:"response"`
}

type archiveGeminiPart struct {
	Text             string                 `json:"text"`
	Thought          bool                   `json:"thought"`
	FunctionCall     *archiveGeminiFuncCall `json:"functionCall"`
	FunctionResponse *archiveGeminiFuncResp `json:"functionResponse"`
}

type archiveGeminiContent struct {
	Role  string              `json:"role"`
	Parts []archiveGeminiPart `json:"parts"`
}

type archiveGeminiRequest struct {
	SystemInstruction *archiveGeminiContent  `json:"systemInstruction"`
	Contents          []archiveGeminiContent `json:"contents"`
}

type archiveGeminiResponse struct {
	Candidates []struct {
		Content archiveGeminiContent `json:"content"`
	} `json:"candidates"`
}

func appendArchiveGeminiContent(messages []model.ArchiveMessage, content *archiveGeminiContent) []model.ArchiveMessage {
	role := content.Role
	if role == "model" {
		role = "assistant"
	} else if role == "" {
		role = "user"
	}
	var text, reasoning strings.Builder
	var toolCalls []model.ArchiveToolCall
	for i := range content.Parts {
		part := &content.Parts[i]
		switch {
		case part.FunctionCall != nil:
			arguments := string(part.FunctionCall.Args)
			if strings.TrimSpace(arguments) == "" {
				arguments = "{}"
			}
			toolCalls = append(toolCalls, model.ArchiveToolCall{
				Type:     "function",
				Function: model.ArchiveToolFunction{Name: part.FunctionCall.Name, Arguments: arguments},
			})
		case part.FunctionResponse != nil:
			response := string(part.FunctionResponse.Response)
			if response == "" {
				response = "{}"
			}
			messages = append(messages, model.ArchiveMessage{
				Role:    "tool",
				Name:    part.FunctionResponse.Name,
				Content: response,
			})
		case part.Thought:
			if part.Text != "" {
				if reasoning.Len() > 0 {
					reasoning.WriteByte('\n')
				}
				reasoning.WriteString(part.Text)
			}
		default:
			if part.Text != "" {
				if text.Len() > 0 {
					text.WriteByte('\n')
				}
				text.WriteString(part.Text)
			}
		}
	}
	msg := model.ArchiveMessage{
		Role:             role,
		Content:          text.String(),
		ReasoningContent: reasoning.String(),
		ToolCalls:        toolCalls,
	}
	if !isArchiveMessageEmpty(msg) {
		messages = append(messages, msg)
	}
	return messages
}

func parseGeminiRequest(body []byte) ([]model.ArchiveMessage, bool) {
	var req archiveGeminiRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, false
	}
	messages := make([]model.ArchiveMessage, 0, len(req.Contents)+1)
	if req.SystemInstruction != nil {
		messages = appendArchiveGeminiContent(messages, &archiveGeminiContent{Parts: req.SystemInstruction.Parts})
		// systemInstruction 归一为系统提示。
		messages[len(messages)-1].Role = "system"
	}
	for i := range req.Contents {
		messages = appendArchiveGeminiContent(messages, &req.Contents[i])
	}
	return messages, true
}

func assembleGeminiResponse(body []byte, isStream bool) (model.ArchiveMessage, bool) {
	var chunks []archiveGeminiResponse
	if err := common.Unmarshal(body, &chunks); err != nil {
		var single archiveGeminiResponse
		if err := common.Unmarshal(body, &single); err == nil {
			chunks = []archiveGeminiResponse{single}
		} else if isStream {
			// alt=sse：每个 data 行是一个完整的 generateContent 分块。
			for _, item := range archiveSSEDataItems(body) {
				var chunk archiveGeminiResponse
				if err := common.UnmarshalJsonStr(item, &chunk); err == nil {
					chunks = append(chunks, chunk)
				}
			}
			if len(chunks) == 0 {
				return model.ArchiveMessage{}, false
			}
		} else {
			return model.ArchiveMessage{}, false
		}
	}
	// 流式分块中的文本是增量内容，直接拼接。
	var text, reasoning strings.Builder
	var toolCalls []model.ArchiveToolCall
	for i := range chunks {
		if len(chunks[i].Candidates) == 0 {
			continue
		}
		parts := chunks[i].Candidates[0].Content.Parts
		for j := range parts {
			part := &parts[j]
			switch {
			case part.FunctionCall != nil:
				arguments := string(part.FunctionCall.Args)
				if strings.TrimSpace(arguments) == "" {
					arguments = "{}"
				}
				toolCalls = append(toolCalls, model.ArchiveToolCall{
					Type:     "function",
					Function: model.ArchiveToolFunction{Name: part.FunctionCall.Name, Arguments: arguments},
				})
			case part.Thought:
				reasoning.WriteString(part.Text)
			default:
				text.WriteString(part.Text)
			}
		}
	}
	return model.ArchiveMessage{
		Role:             "assistant",
		Content:          text.String(),
		ReasoningContent: reasoning.String(),
		ToolCalls:        toolCalls,
	}, true
}

// ---- 分发入口 ----

func parseArchiveRequestMessages(format string, body []byte) ([]model.ArchiveMessage, bool) {
	switch format {
	case conversationFormatOpenAIChat:
		return parseOpenAIChatRequest(body)
	case conversationFormatOpenAIText:
		return parseOpenAITextRequest(body)
	case conversationFormatClaude:
		return parseClaudeRequest(body)
	case conversationFormatResponses:
		return parseResponsesRequest(body)
	case conversationFormatGemini:
		return parseGeminiRequest(body)
	}
	return nil, false
}

func assembleArchiveResponse(format string, isStream bool, body []byte) (model.ArchiveMessage, bool) {
	switch format {
	case conversationFormatOpenAIChat:
		if isStream {
			return assembleOpenAIChatStream(body)
		}
		return assembleOpenAIChatResponse(body)
	case conversationFormatOpenAIText:
		return assembleOpenAITextResponse(body, isStream)
	case conversationFormatClaude:
		if isStream {
			return assembleClaudeStream(body)
		}
		return assembleClaudeResponse(body)
	case conversationFormatResponses:
		if isStream {
			return assembleResponsesStream(body)
		}
		return assembleResponsesResponse(body)
	case conversationFormatGemini:
		return assembleGeminiResponse(body, isStream)
	}
	return model.ArchiveMessage{}, false
}
