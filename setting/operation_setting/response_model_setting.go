package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// ResponseModelSetting controls what a caller learns about the model that
// actually answered, and whether a channel's model mapping is hidden again on
// the way back.
type ResponseModelSetting struct {
	// UserVisible lets regular users see the routed and returned model names in
	// their own usage logs. Administrators always see them.
	UserVisible bool `json:"user_visible"`
	// RewriteEnabled replaces the model name in the response body with the name
	// the caller requested, so a channel mapping never leaks the upstream model.
	RewriteEnabled bool `json:"rewrite_enabled"`
}

var responseModelSetting = ResponseModelSetting{
	UserVisible:    true,
	RewriteEnabled: true,
}

func init() {
	config.GlobalConfig.Register("response_model_setting", &responseModelSetting)
}

func GetResponseModelSetting() *ResponseModelSetting {
	return &responseModelSetting
}

// ResponseModelUserVisible reports whether a regular user may see the routed and
// returned model names in their own usage logs.
func ResponseModelUserVisible() bool {
	return responseModelSetting.UserVisible
}

// ResponseModelRewriteEnabled reports whether a response body carries the name
// the caller requested instead of the name the upstream reported.
func ResponseModelRewriteEnabled() bool {
	return responseModelSetting.RewriteEnabled
}
