package dto

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	kitutil "github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
	"github.com/QuantumNous/new-api/relaykit/types"
)

// TypeSafe System One protocol limits, as published in
// https://docs.typesafe.ai/api.
const (
	MaxSystemOneChoiceOptions = 255
	MinSystemOneScoreLevels   = 2
	MaxSystemOneScoreLevels   = 10
)

// Question types accepted by POST /v1/systemone.
const (
	SystemOneQuestionNoul   = "noul"
	SystemOneQuestionChoice = "choice"
	SystemOneQuestionScore  = "score"
)

// SystemOneRequest evaluates a state against typed questions. The request body
// is the upstream protocol, so RawBody preserves unknown fields for forwarding
// while the typed fields drive validation and billing.
type SystemOneRequest struct {
	Model     string                       `json:"model"`
	State     any                          `json:"state"`
	Questions map[string]SystemOneQuestion `json:"questions"`
	RawBody   json.RawMessage              `json:"-"`
}

// SystemOneQuestion is one typed question. Instructions and criteria stay raw
// because both accept a string, an object, or an array, and because the
// criteria shape depends on the question type.
type SystemOneQuestion struct {
	Type         string          `json:"type"`
	Instructions json.RawMessage `json:"instructions"`
	Criteria     json.RawMessage `json:"criteria,omitempty"`
}

// SystemOneResponse is the upstream evaluation result. The gateway forwards it
// to the client verbatim and only reads usage for billing.
type SystemOneResponse struct {
	Model   string                     `json:"model"`
	Answers map[string]json.RawMessage `json:"answers"`
	Usage   SystemOneResponseUsage     `json:"usage"`
}

// SystemOneResponseUsage reports input and output tokens. Jev charges per input
// token only, so output tokens are free.
type SystemOneResponseUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// Validate enforces the upstream request contract so a malformed request fails
// with 400 here instead of 422 at the provider.
func (r *SystemOneRequest) Validate() error {
	if r == nil {
		return errors.New("request is empty")
	}
	if strings.TrimSpace(r.Model) == "" {
		return errors.New("field model is required")
	}
	if r.State == nil {
		return errors.New("field state is required")
	}
	switch state := r.State.(type) {
	case string:
		if strings.TrimSpace(state) == "" {
			return errors.New("field state is empty")
		}
	case map[string]any, []any:
	default:
		return errors.New("field state must be a string, an object, or an array of text")
	}
	if len(r.Questions) == 0 {
		return errors.New("field questions is required")
	}
	for id, question := range r.Questions {
		if err := question.Validate(id); err != nil {
			return err
		}
	}
	return nil
}

// Validate checks one question against the limits of its primitive.
func (q SystemOneQuestion) Validate(id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("question id is empty")
	}
	if systemOneJSONMissing(q.Instructions) {
		return fmt.Errorf("question %q is missing instructions", id)
	}
	switch q.Type {
	case SystemOneQuestionNoul:
		if !systemOneJSONMissing(q.Criteria) {
			var criteria map[string]any
			if err := kitutil.Unmarshal(q.Criteria, &criteria); err != nil {
				return fmt.Errorf("question %q has invalid criteria", id)
			}
		}
	case SystemOneQuestionChoice:
		var criteria map[string]json.RawMessage
		if err := kitutil.Unmarshal(q.Criteria, &criteria); err != nil {
			return fmt.Errorf("question %q requires a criteria object of options", id)
		}
		if len(criteria) == 0 {
			return fmt.Errorf("question %q requires at least one choice option", id)
		}
		if len(criteria) > MaxSystemOneChoiceOptions {
			return fmt.Errorf("question %q exceeds the %d choice option limit", id, MaxSystemOneChoiceOptions)
		}
	case SystemOneQuestionScore:
		var levels []json.RawMessage
		if err := kitutil.Unmarshal(q.Criteria, &levels); err != nil {
			return fmt.Errorf("question %q requires a criteria array of levels", id)
		}
		if len(levels) < MinSystemOneScoreLevels || len(levels) > MaxSystemOneScoreLevels {
			return fmt.Errorf("question %q requires between %d and %d score levels", id, MinSystemOneScoreLevels, MaxSystemOneScoreLevels)
		}
	default:
		return fmt.Errorf("question %q has unsupported type %q, must be one of: noul, choice, score", id, q.Type)
	}
	return nil
}

// TokenCountText flattens the billable input of the request so the tokenizer
// can estimate it: Jev ingests the state once and evaluates every question
// against it.
func (r *SystemOneRequest) TokenCountText() string {
	if r == nil {
		return ""
	}
	var builder strings.Builder
	if r.State != nil {
		if encoded, err := kitutil.Marshal(r.State); err == nil {
			builder.Write(encoded)
		}
	}
	for _, question := range r.Questions {
		builder.WriteString("\n")
		builder.Write(question.Instructions)
		builder.Write(question.Criteria)
	}
	return builder.String()
}

// ToUsage maps the upstream token counts onto the gateway usage shape.
func (r *SystemOneResponse) ToUsage() *Usage {
	if r == nil {
		return &Usage{}
	}
	return &Usage{
		PromptTokens:     r.Usage.InputTokens,
		CompletionTokens: r.Usage.OutputTokens,
		TotalTokens:      r.Usage.InputTokens + r.Usage.OutputTokens,
	}
}

func (r *SystemOneRequest) GetTokenCountMeta() *types.TokenCountMeta {
	return &types.TokenCountMeta{
		CombineText: r.TokenCountText(),
		TokenType:   types.TokenTypeTokenizer,
	}
}

func (r *SystemOneRequest) IsStream(_ *http.Request) bool {
	return false
}

func (r *SystemOneRequest) SetModelName(modelName string) {
	if modelName != "" {
		r.Model = modelName
	}
}

// BuildSystemOneRequestBody returns the client body unchanged unless the model
// was mapped, in which case only "model" is rewritten so unknown fields and the
// original value shapes of state and questions survive.
func BuildSystemOneRequestBody(rawBody []byte, upstreamModel string) ([]byte, error) {
	if len(rawBody) == 0 {
		return nil, errors.New("empty system one request body")
	}
	if strings.TrimSpace(upstreamModel) == "" {
		return rawBody, nil
	}
	var body map[string]json.RawMessage
	if err := kitutil.Unmarshal(rawBody, &body); err != nil {
		return nil, err
	}
	model, err := kitutil.Marshal(upstreamModel)
	if err != nil {
		return nil, err
	}
	body["model"] = model
	return kitutil.Marshal(body)
}

// systemOneJSONMissing reports whether an optional structured field carries no
// content: absent, null, or an empty string.
func systemOneJSONMissing(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed == "" || trimmed == "null" || trimmed == `""`
}
