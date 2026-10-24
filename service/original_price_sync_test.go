package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/original_price_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseUSDCNYRate(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		want    float64
		wantErr string
	}{
		{
			name: "v6 payload with cny rate",
			body: `{"result":"success","base_code":"USD","time_last_update_unix":1792800151,"rates":{"USD":1,"CNY":6.684864,"EUR":0.892784}}`,
			want: 6.684864,
		},
		{
			name: "mirror without result field",
			body: `{"base_code":"USD","rates":{"CNY":7.1}}`,
			want: 7.1,
		},
		{
			name:    "error result is rejected",
			body:    `{"result":"error","rates":{"CNY":7.1}}`,
			wantErr: "reported",
		},
		{
			name:    "non usd base is rejected",
			body:    `{"result":"success","base_code":"EUR","rates":{"CNY":7.1}}`,
			wantErr: "base currency",
		},
		{
			name:    "payload without cny is rejected",
			body:    `{"result":"success","base_code":"USD","rates":{"JPY":156.8}}`,
			wantErr: "no CNY rate",
		},
		{
			name:    "zero rate is rejected",
			body:    `{"result":"success","rates":{"CNY":0}}`,
			wantErr: "outside the accepted range",
		},
		{
			name:    "absurd rate is rejected",
			body:    `{"result":"success","rates":{"CNY":100000}}`,
			wantErr: "outside the accepted range",
		},
		{
			name:    "malformed json is rejected",
			body:    `{"rates":`,
			wantErr: "invalid exchange rate payload",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rate, err := parseUSDCNYRate([]byte(tc.body))
			if tc.wantErr == "" {
				require.NoError(t, err)
				assert.InDelta(t, tc.want, rate, 1e-9)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErr)
		})
	}
}

// 同步任务请求的地址由基础地址拼出来：管理端可能填站点根地址、带版本的地址，
// 也可能已经写成 .../USD。三种都要落到同一个「取 USD 牌价」的端点上。
func TestOriginalPriceRateEndpoint(t *testing.T) {
	tests := []struct {
		name    string
		base    string
		want    string
		wantErr string
	}{
		{name: "default api base", base: original_price_setting.DefaultSyncBaseURL, want: "https://open.er-api.com/v6/latest/USD"},
		{name: "cn mirror with version", base: "https://er-api.25y.cn/v6/latest", want: "https://er-api.25y.cn/v6/latest/USD"},
		{name: "trailing slash is trimmed", base: "https://er-api.25y.cn/v6/latest/", want: "https://er-api.25y.cn/v6/latest/USD"},
		{name: "currency suffix is kept", base: "https://open.er-api.com/v6/latest/usd", want: "https://open.er-api.com/v6/latest/usd"},
		{name: "missing scheme is rejected", base: "open.er-api.com/v6/latest", wantErr: "must start with http"},
		{name: "empty base is rejected", base: "  ", wantErr: "required"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			endpoint, err := original_price_setting.LatestRatesURL(tc.base)
			if tc.wantErr == "" {
				require.NoError(t, err)
				assert.Equal(t, tc.want, endpoint)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErr)
		})
	}
}
