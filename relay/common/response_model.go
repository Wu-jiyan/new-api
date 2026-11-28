package common

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

// ResponseModel records upstream declarations before response conversion. It is
// diagnostic only: it must never change routing, pricing, or downstream output.
// Only the three names are stored; whether they disagree is computed on demand
// so every consumer applies the current comparison rule to old rows as well.
type ResponseModel struct {
	RequestedModel string `json:"requested_model"`
	UpstreamModel  string `json:"upstream_model"`
	ReturnedModel  string `json:"returned_model"`
}

// matches reports whether an upstream declaration is compatible with the
// requested or upstream model: equal ignoring case, a dated or variant name
// that extends it, or the same name behind a provider path such as
// "deepseek/deepseek-v4.1-flash".
func (r *ResponseModel) matches(model string) bool {
	returned := strings.ToLower(model)
	for _, expected := range []string{r.RequestedModel, r.UpstreamModel} {
		expected = strings.ToLower(expected)
		if expected != "" && (strings.HasPrefix(returned, expected) || strings.HasSuffix(returned, expected)) {
			return true
		}
	}
	return false
}

// Mismatch reports whether the retained upstream declaration disagrees with
// both the requested and upstream models.
func (r *ResponseModel) Mismatch() bool {
	return r != nil && r.ReturnedModel != "" && !r.matches(r.ReturnedModel)
}

// ObserveResponseModel retains the first differing model for inspection, with
// mismatches taking priority over provider-path, prefix, or case-only
// differences. A later matching or empty event cannot erase it. Only observe
// upstream declarations, never models synthesized by a response converter.
func (info *RelayInfo) ObserveResponseModel(model string) {
	if info == nil || strings.TrimSpace(model) == "" {
		return
	}
	if info.ResponseModel == nil {
		info.ResponseModel = &ResponseModel{
			RequestedModel: info.OriginModelName,
			UpstreamModel:  info.GetUpstreamModelName(),
		}
	}
	observation := info.ResponseModel
	if observation.Mismatch() {
		return
	}
	if observation.matches(model) && observation.ReturnedModel != "" &&
		observation.ReturnedModel != observation.RequestedModel && observation.ReturnedModel != observation.UpstreamModel {
		return
	}
	observation.ReturnedModel = model
}

// ResponseModelName is the model name a response body carries. With rewriting
// on it is the name the caller asked for, so a channel mapping never leaks the
// upstream model; with rewriting off it stays the name the request was routed to.
func (info *RelayInfo) ResponseModelName() string {
	if info == nil {
		return ""
	}
	if operation_setting.ResponseModelRewriteEnabled() {
		return info.OriginModelName
	}
	return info.GetUpstreamModelName()
}

// RewriteResponseModelName replaces the routed model name with the requested one
// inside an already-serialized response body or stream chunk. It returns the body
// unchanged when rewriting is off, the names do not differ, or the routed name
// does not occur, so a caller can apply it on every chunk without a JSON pass.
func (info *RelayInfo) RewriteResponseModelName(body string) string {
	if info == nil || body == "" || info.OriginModelName == "" {
		return body
	}
	if !operation_setting.ResponseModelRewriteEnabled() {
		return body
	}
	routed := info.GetUpstreamModelName()
	if routed == "" || routed == info.OriginModelName {
		return body
	}
	quoted := strconv.Quote(routed)
	if !strings.Contains(body, quoted) {
		return body
	}
	return strings.ReplaceAll(body, quoted, strconv.Quote(info.OriginModelName))
}
