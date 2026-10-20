package controller

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

func TestBuildTestRequestForDeepSeekTools(t *testing.T) {
	cases := []struct {
		endpointType string
		model        string
		wantField    string
	}{
		{string(constant.EndpointTypeDeepSeekToolsSearch), constant.DeepSeekSearchModel, "query"},
		{string(constant.EndpointTypeDeepSeekToolsFetch), constant.DeepSeekFetchModel, "url"},
	}
	for _, tc := range cases {
		req := buildTestRequest(tc.model, tc.endpointType, nil, false)
		toolsReq, ok := req.(*dto.DeepSeekToolsRequest)
		if !ok {
			t.Fatalf("%s: request type = %T, want *dto.DeepSeekToolsRequest", tc.endpointType, req)
		}
		body, err := marshalTestRequestBody(toolsReq)
		if err != nil {
			t.Fatalf("%s: marshal: %v", tc.endpointType, err)
		}
		var parsed map[string]any
		if err := json.Unmarshal(body, &parsed); err != nil {
			t.Fatalf("%s: unmarshal: %v", tc.endpointType, err)
		}
		if _, ok := parsed[tc.wantField]; !ok {
			t.Errorf("%s: body %s has no %q field", tc.endpointType, body, tc.wantField)
		}
		if _, ok := parsed["model"]; ok {
			t.Errorf("%s: body %s must not carry a model field", tc.endpointType, body)
		}
		if _, ok := parsed["messages"]; ok {
			t.Errorf("%s: body %s must not carry chat messages", tc.endpointType, body)
		}
	}
}

func TestNormalizeChannelTestEndpointInfersDeepSeekTools(t *testing.T) {
	if got := normalizeChannelTestEndpoint(nil, "", constant.DeepSeekSearchModel); got != string(constant.EndpointTypeDeepSeekToolsSearch) {
		t.Errorf("search endpoint = %q", got)
	}
	if got := normalizeChannelTestEndpoint(nil, "", constant.DeepSeekFetchModel); got != string(constant.EndpointTypeDeepSeekToolsFetch) {
		t.Errorf("fetch endpoint = %q", got)
	}
	if got := normalizeChannelTestEndpoint(nil, "", "gpt-4o-mini"); got != "" {
		t.Errorf("plain model endpoint = %q, want empty", got)
	}
	if got := normalizeChannelTestEndpoint(nil, "deepseek-tools-fetch", constant.DeepSeekSearchModel); got != "deepseek-tools-fetch" {
		t.Errorf("explicit endpoint = %q, want the explicit value", got)
	}
}
