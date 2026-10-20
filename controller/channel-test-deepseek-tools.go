package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
)

// deepSeekToolsTestRequest is the sample payload used when a channel serves
// the DeepSeek Search or Fetch endpoint. The relay forwards the request body
// verbatim, so the test body must carry the fields the upstream expects:
// "query" for /v1/tools/search and "url" for /v1/tools/fetch.
type deepSeekToolsTestRequest struct {
	Model string `json:"-"`
	Query string `json:"query,omitempty"`
	Count int    `json:"count,omitempty"`
	URL   string `json:"url,omitempty"`
}

// SetModelName records the routing model without adding it to the body: the
// DeepSeek tools endpoints carry no model field.
func (r *deepSeekToolsTestRequest) SetModelName(modelName string) {
	if modelName != "" {
		r.Model = modelName
	}
}

// IsStream reports that the DeepSeek tools endpoints never stream.
func (r *deepSeekToolsTestRequest) IsStream(_ *http.Request) bool { return false }

// GetTokenCountMeta bills the sample body like any other request.
func (r *deepSeekToolsTestRequest) GetTokenCountMeta() *types.TokenCountMeta {
	return &types.TokenCountMeta{
		CombineText: r.Query + r.URL,
		TokenType:   types.TokenTypeTokenizer,
	}
}

var _ dto.Request = (*deepSeekToolsTestRequest)(nil)
