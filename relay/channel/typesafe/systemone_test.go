package typesafe

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func parseSystemOneRequest(t *testing.T, body string) *dto.SystemOneRequest {
	t.Helper()
	request := &dto.SystemOneRequest{}
	require.NoError(t, common.Unmarshal([]byte(body), request))
	request.RawBody = []byte(body)
	return request
}

func TestSystemOneRequestValidate(t *testing.T) {
	valid := func(body string) *dto.SystemOneRequest {
		return parseSystemOneRequest(t, body)
	}

	tests := []struct {
		name    string
		request *dto.SystemOneRequest
		wantErr string
	}{
		{
			name:    "noul question with rubric",
			request: valid(`{"model":"jev-latest","state":"payouts failing","questions":{"urgent":{"type":"noul","instructions":"Is this urgent?","criteria":{"true":"time sensitive"}}}}`),
		},
		{
			name:    "object state and choice question",
			request: valid(`{"model":"jev-1.13.0","state":{"message":"hi","lang":"en"},"questions":{"team":{"type":"choice","instructions":"Which team?","criteria":{"billing":"refunds","tech":"bugs"}}}}`),
		},
		{
			name:    "array state and score question",
			request: valid(`{"model":"jev-preview","state":["a","b"],"questions":{"mood":{"type":"score","instructions":"Mood?","criteria":["calm","angry"]}}}`),
		},
		{
			name:    "model is required",
			request: valid(`{"state":"hi","questions":{"a":{"type":"noul","instructions":"?"}}}`),
			wantErr: "field model is required",
		},
		{
			name:    "state is required",
			request: valid(`{"model":"jev-latest","questions":{"a":{"type":"noul","instructions":"?"}}}`),
			wantErr: "field state is required",
		},
		{
			name:    "questions are required",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{}}`),
			wantErr: "field questions is required",
		},
		{
			name:    "unknown question type",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{"a":{"type":"rank","instructions":"?"}}}`),
			wantErr: `question "a" has unsupported type "rank"`,
		},
		{
			name:    "question without instructions",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{"a":{"type":"noul"}}}`),
			wantErr: `question "a" is missing instructions`,
		},
		{
			name:    "empty instructions are rejected",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{"a":{"type":"noul","instructions":""}}}`),
			wantErr: `question "a" is missing instructions`,
		},
		{
			name:    "choice criteria must be an object",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{"a":{"type":"choice","instructions":"?","criteria":["x","y"]}}}`),
			wantErr: `question "a" requires a criteria object of options`,
		},
		{
			name:    "choice options are bounded",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{"a":{"type":"choice","instructions":"?","criteria":` + objectOf("o", dto.MaxSystemOneChoiceOptions+1) + `}}}`),
			wantErr: fmt.Sprintf("exceeds the %d choice option limit", dto.MaxSystemOneChoiceOptions),
		},
		{
			name:    "score needs at least two levels",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{"a":{"type":"score","instructions":"?","criteria":["only"]}}}`),
			wantErr: "requires between 2 and 10 score levels",
		},
		{
			name:    "score levels are bounded",
			request: valid(`{"model":"jev-latest","state":"hi","questions":{"a":{"type":"score","instructions":"?","criteria":` + arrayOf("l", dto.MaxSystemOneScoreLevels+1) + `}}}`),
			wantErr: "requires between 2 and 10 score levels",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.request.Validate()
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

// objectOf renders {"o0":"v",...} with the requested number of members.
func objectOf(prefix string, count int) string {
	members := make([]string, 0, count)
	for i := range count {
		members = append(members, fmt.Sprintf(`"%s%d":"v"`, prefix, i))
	}
	return "{" + strings.Join(members, ",") + "}"
}

// arrayOf renders ["l0","l1",...] with the requested number of entries.
func arrayOf(prefix string, count int) string {
	values := make([]string, 0, count)
	for i := range count {
		values = append(values, fmt.Sprintf(`"%s%d"`, prefix, i))
	}
	return "[" + strings.Join(values, ",") + "]"
}

func TestBuildSystemOneRequestBody(t *testing.T) {
	t.Run("mapped model rewrites only the model field", func(t *testing.T) {
		raw := []byte(`{"model":"jev-latest","state":{"message":"hi"},"questions":{"a":{"type":"noul","instructions":"?"}},"metadata":{"trace":"x"}}`)

		body, err := dto.BuildSystemOneRequestBody(raw, "jev-1.13.0")
		require.NoError(t, err)

		var decoded map[string]any
		require.NoError(t, common.Unmarshal(body, &decoded))
		assert.Equal(t, "jev-1.13.0", decoded["model"])
		assert.Equal(t, map[string]any{"message": "hi"}, decoded["state"])
		assert.Equal(t, map[string]any{"trace": "x"}, decoded["metadata"])
		assert.Contains(t, decoded, "questions")
	})

	t.Run("empty body is rejected", func(t *testing.T) {
		_, err := dto.BuildSystemOneRequestBody(nil, "jev-latest")
		require.Error(t, err)
	})
}

func systemOneUpstream(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestSystemOneHandler(t *testing.T) {
	const upstreamBody = `{"model":"jev-1.13.0","answers":{"urgent":{"type":"noul","noul":0.95}},"usage":{"input_tokens":296,"output_tokens":20}}`

	gin.SetMode(gin.TestMode)
	newContext := func() (*httptest.ResponseRecorder, *gin.Context) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/systemone", nil)
		return recorder, c
	}

	t.Run("forwards the upstream payload and reports input tokens", func(t *testing.T) {
		recorder, c := newContext()

		usage, apiErr := SystemOneHandler(c, systemOneUpstream(upstreamBody))

		require.Nil(t, apiErr)
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.JSONEq(t, upstreamBody, recorder.Body.String())
		assert.Equal(t, 296, usage.PromptTokens)
		assert.Equal(t, 20, usage.CompletionTokens)
		assert.Equal(t, 316, usage.TotalTokens)
	})

	t.Run("negative upstream usage is not billed", func(t *testing.T) {
		recorder, c := newContext()
		negative := `{"answers":{},"usage":{"input_tokens":-5,"output_tokens":-1}}`

		usage, apiErr := SystemOneHandler(c, systemOneUpstream(negative))

		require.Nil(t, apiErr)
		assert.JSONEq(t, negative, recorder.Body.String())
		assert.Equal(t, 0, usage.PromptTokens)
		assert.Equal(t, 0, usage.CompletionTokens)
	})

	t.Run("invalid upstream payload is a bad response", func(t *testing.T) {
		_, c := newContext()

		usage, apiErr := SystemOneHandler(c, systemOneUpstream("not json"))

		assert.Nil(t, usage)
		require.NotNil(t, apiErr)
	})
}

func TestAdaptorOnlyServesSystemOne(t *testing.T) {
	adaptor := &Adaptor{}
	channelMeta := func() *relaycommon.ChannelMeta {
		return &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.typesafe.ai", ChannelType: constant.ChannelTypeTypeSafe}
	}

	_, err := adaptor.GetRequestURL(&relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeChatCompletions, ChannelMeta: channelMeta()})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "only /v1/systemone is supported")

	url, err := adaptor.GetRequestURL(&relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeSystemOne, ChannelMeta: channelMeta()})
	require.NoError(t, err)
	assert.Equal(t, "https://api.typesafe.ai/v1/systemone", url)

	assert.Equal(t, ModelList, adaptor.GetModelList())
	assert.Equal(t, ChannelName, adaptor.GetChannelName())
}
