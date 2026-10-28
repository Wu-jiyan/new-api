package controller

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetDeepSeekBalanceUSD(t *testing.T) {
	tests := []struct {
		name            string
		responseJSON    string
		usdExchangeRate float64
		want            float64
		wantErrContains string
	}{
		{
			name:            "prefers USD when USD precedes CNY",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"12.50"},{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			want:            12.5,
		},
		{
			name:            "prefers USD when CNY precedes USD",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"},{"currency":"USD","total_balance":"12.50"}]}`,
			usdExchangeRate: 7.3,
			want:            12.5,
		},
		{
			name:            "converts CNY when USD is absent",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			want:            10,
		},
		{
			name:            "converts CNY when USD balance is zero",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"0.00"},{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			want:            10,
		},
		{
			name:            "converts CNY when zero USD follows CNY",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"},{"currency":"USD","total_balance":"0.00"}]}`,
			usdExchangeRate: 7.3,
			want:            10,
		},
		{
			name:            "returns zero when USD balance is zero and CNY is absent",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"0.00"}]}`,
			usdExchangeRate: 7.3,
			want:            0,
		},
		{
			name:            "returns error when USD and CNY are absent",
			responseJSON:    `{"balance_infos":[{"currency":"EUR","total_balance":"10.00"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "currency USD or CNY not found",
		},
		{
			name:            "returns USD parse error instead of falling back to CNY",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"invalid"},{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "invalid syntax",
		},
		{
			name:            "rejects NaN USD balance",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"NaN"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "USD balance must be finite",
		},
		{
			name:            "rejects negative USD balance",
			responseJSON:    `{"balance_infos":[{"currency":"USD","total_balance":"-1.00"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "USD balance must be non-negative",
		},
		{
			name:            "rejects positive infinity CNY balance",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"+Inf"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "CNY balance must be finite",
		},
		{
			name:            "rejects negative CNY balance",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"-7.30"}]}`,
			usdExchangeRate: 7.3,
			wantErrContains: "CNY balance must be non-negative",
		},
		{
			name:            "returns error for non-positive CNY exchange rate",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: 0,
			wantErrContains: "USD exchange rate must be greater than zero",
		},
		{
			name:            "rejects NaN CNY exchange rate",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: math.NaN(),
			wantErrContains: "USD exchange rate must be finite",
		},
		{
			name:            "rejects positive infinity CNY exchange rate",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"73.00"}]}`,
			usdExchangeRate: math.Inf(1),
			wantErrContains: "USD exchange rate must be finite",
		},
		{
			name:            "rejects CNY conversion overflow",
			responseJSON:    `{"balance_infos":[{"currency":"CNY","total_balance":"1.7976931348623157e+308"}]}`,
			usdExchangeRate: math.SmallestNonzeroFloat64,
			wantErrContains: "converted USD balance must be finite",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var response DeepSeekUsageResponse
			require.NoError(t, common.Unmarshal([]byte(test.responseJSON), &response))

			balance, err := getDeepSeekBalanceUSD(response, test.usdExchangeRate)
			if test.wantErrContains != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), test.wantErrContains)
				return
			}

			require.NoError(t, err)
			assert.InDelta(t, test.want, balance, 1e-12)
		})
	}
}

func TestBuildChannelCostPricingMapSkipsExpressionPricedModels(t *testing.T) {
	ratio := 37.5
	converted := buildChannelCostPricingMap([]channelCostPricingItem{
		// 表达式计价模型：model_ratio 只是自用兜底值，写进成本表会算出完全错误的成本。
		{
			ModelName:   "deepseek-v4.1-flash",
			QuotaType:   0,
			ModelRatio:  &ratio,
			BillingMode: "tiered_expr",
			BillingExpr: `tier("base", p * 1 + c * 4)`,
		},
		{
			ModelName:       "deepseek-v4-flash",
			QuotaType:       0,
			ModelRatio:      &ratio,
			CompletionRatio: &[]float64{3}[0],
		},
	})

	assert.NotContains(t, converted, "deepseek-v4.1-flash")
	assert.NotContains(t, valueMap(converted["model_ratio"]), "deepseek-v4.1-flash")
	assert.Contains(t, valueMap(converted["model_ratio"]), "deepseek-v4-flash")
	// The billing mode must survive: without it the extraction step cannot
	// tell "expression priced" apart from "upstream did not price it" and
	// reports the wrong reason.
	assert.Equal(
		t,
		map[string]string{"deepseek-v4.1-flash": "tiered_expr"},
		converted[billing_setting.BillingModeField],
	)
}

func TestExtractChannelCostPricesReportsType2ExpressionModelAsTiered(t *testing.T) {
	ratio := 37.5
	converted := buildChannelCostPricingMap([]channelCostPricingItem{
		{
			ModelName:   "deepseek-v4.1-flash",
			QuotaType:   0,
			ModelRatio:  &ratio,
			BillingMode: billing_setting.BillingModeTieredExpr,
			BillingExpr: `tier("base", p * 1 + c * 4)`,
		},
		{
			// Expression mode without an expression cannot be priced at all.
			ModelName:   "gpt-6-astra",
			QuotaType:   0,
			ModelRatio:  &ratio,
			BillingMode: billing_setting.BillingModeTieredExpr,
		},
	})

	prices, skipped := extractChannelCostPrices(
		converted,
		[]string{"deepseek-v4.1-flash", "gpt-6-astra"},
		nil,
	)

	// An expression-priced upstream must be synced like any other price, not
	// reported as unpriced and not replaced by the self-use fallback ratio.
	require.Contains(t, prices, "deepseek-v4.1-flash")
	assert.Equal(t, `tier("base", p * 1 + c * 4)`, prices["deepseek-v4.1-flash"].BillingExpr)
	assert.Zero(t, prices["deepseek-v4.1-flash"].ModelRatio)
	assert.Equal(t, map[string]string{"gpt-6-astra": "tiered_expr"}, skipped)
}

func TestExtractChannelCostPricesHonorsModelMapping(t *testing.T) {
	converted := map[string]any{
		"model_ratio":      map[string]any{"deepseek-flash": 1.5},
		"completion_ratio": map[string]any{"deepseek-flash": 3.0},
	}

	prices, skipped := extractChannelCostPrices(
		converted,
		[]string{"deepseek-webchat"},
		upstreamModelNames(`{"deepseek-webchat":"deepseek-flash"}`),
	)

	require.Empty(t, skipped)
	require.Contains(t, prices, "deepseek-webchat")
	assert.InDelta(t, 1.5, prices["deepseek-webchat"].ModelRatio, 1e-9)
	assert.InDelta(t, 3.0, prices["deepseek-webchat"].CompletionRatio, 1e-9)
}

func TestExtractChannelCostPricesKeepsFreeModelPriced(t *testing.T) {
	converted := map[string]any{
		"model_ratio": map[string]any{"space-bunny-free": 0},
		"model_price": map[string]any{"big-pickle": 0},
	}

	prices, skipped := extractChannelCostPrices(
		converted,
		[]string{"space-bunny-free", "big-pickle", "absent-model"},
		nil,
	)

	// A free entry is priced explicitly at 0 upstream, so it must survive
	// the save filter even though both numeric fields are zero.
	require.Contains(t, prices, "space-bunny-free")
	assert.True(t, prices["space-bunny-free"].Free)
	require.Contains(t, prices, "big-pickle")
	assert.True(t, prices["big-pickle"].Free)
	// Only genuinely missing models are skipped.
	assert.Equal(t, map[string]string{"absent-model": "no_upstream_price"}, skipped)
}

func TestExtractChannelCostPricesSkipsExpressionModelFromType1(t *testing.T) {
	converted := map[string]any{
		"model_ratio": map[string]any{"gpt-6-astra": 37.5},
		"billing_mode": map[string]any{
			"gpt-6-astra": "tiered_expr",
		},
	}

	prices, skipped := extractChannelCostPrices(converted, []string{"gpt-6-astra"}, nil)

	assert.Empty(t, prices)
	// The reason must survive: an expression-priced model falls back to
	// reverse-derivation at runtime, not to the global list price.
	assert.Equal(t, map[string]string{"gpt-6-astra": "tiered_expr"}, skipped)
}

func TestUpstreamModelNamesIgnoresInvalidMapping(t *testing.T) {
	assert.Empty(t, upstreamModelNames(""))
	assert.Empty(t, upstreamModelNames("not json"))
	assert.Equal(
		t,
		map[string]string{"deepseek-webchat": "deepseek-flash"},
		upstreamModelNames(`{"deepseek-webchat":"deepseek-flash","":"x","y":""}`),
	)
}

func TestExtractChannelCostPricesSkipsSelfUseFallbackRatio(t *testing.T) {
	converted := map[string]any{
		"model_ratio": map[string]any{
			// The upstream has no price for this model and publishes the
			// self-use fallback constant instead of a real list price.
			"unpriced-upstream": ratio_setting.SelfUseModelRatio,
			"priced-upstream":   1.5,
		},
		"completion_ratio": map[string]any{"unpriced-upstream": 3},
	}

	prices, skipped := extractChannelCostPrices(
		converted,
		[]string{"unpriced-upstream", "priced-upstream"},
		nil,
	)

	// Writing the fallback into the cost table would report a cost 75x the
	// real one, so the model must be reported as skipped instead.
	assert.NotContains(t, prices, "unpriced-upstream")
	assert.Contains(t, prices, "priced-upstream")
	assert.Equal(
		t,
		map[string]string{"unpriced-upstream": "no_upstream_price"},
		skipped,
	)
}

func TestUpdateChannelNewAPIBalanceUsesTheSmallerRemainingQuota(t *testing.T) {
	for _, tc := range []struct {
		name    string
		usage   string
		want    float64
		wantErr string
	}{
		{name: "user quota below the key quota", usage: `{"code":true,"data":{"total_available":2000000,"unlimited_quota":false,"user_quota":{"total_available":500000}}}`, want: 0.5},
		{name: "key quota below the user quota", usage: `{"code":true,"data":{"total_available":500000,"unlimited_quota":false,"user_quota":{"total_available":2000000}}}`, want: 0.5},
		{name: "unlimited key uses the user quota", usage: `{"code":true,"data":{"total_available":0,"unlimited_quota":true,"user_quota":{"total_available":3000000}}}`, want: 3},
		{name: "key quota alone without user quota", usage: `{"code":true,"data":{"total_available":1500000,"unlimited_quota":false}}`, want: 1.5},
		{name: "unlimited key without user quota", usage: `{"code":true,"data":{"total_available":0,"unlimited_quota":true}}`, wantErr: "Allow querying user quota"},
		{name: "upstream rejects the key", usage: `{"success":false,"message":"invalid token"}`, wantErr: "invalid token"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupSub2APIBalanceTest(t)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/usage/token/":
					assert.Equal(t, "Bearer sk-upstream", r.Header.Get("Authorization"))
					_, _ = w.Write([]byte(tc.usage))
				case "/api/status":
					assert.Empty(t, r.Header.Get("Authorization"), "the key is not sent to the public status endpoint")
					_, _ = w.Write([]byte(`{"success":true,"data":{"quota_per_unit":1000000}}`))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			baseURL := server.URL + "/"
			channel := &model.Channel{Type: constant.ChannelTypeNewAPI, BaseURL: &baseURL, Key: "sk-upstream", Name: "new-api-upstream"}
			require.NoError(t, model.DB.Create(channel).Error)

			result, err := updateChannelBalance(channel)
			if tc.wantErr != "" {
				require.ErrorContains(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.InDelta(t, tc.want, result.Balance, 1e-9)
			assert.InDelta(t, tc.want, channel.Balance, 1e-9)
		})
	}
}
