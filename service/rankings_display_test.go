package service

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

func TestRankingDisplayMultiplierResolution(t *testing.T) {
	setting := operation_setting.GetRankingDisplaySetting()
	previousEnabled, previousMultiplier := setting.MultiplierEnabled, setting.Multiplier
	t.Cleanup(func() {
		setting.MultiplierEnabled = previousEnabled
		setting.Multiplier = previousMultiplier
	})

	cases := []struct {
		name       string
		enabled    bool
		multiplier float64
		want       float64
	}{
		{name: "off publishes the real volume", enabled: false, multiplier: 9.8, want: 1},
		{name: "on applies the configured factor", enabled: true, multiplier: 9.8, want: 9.8},
		{name: "a factor of one keeps the real volume", enabled: true, multiplier: 1, want: 1},
		{name: "zero falls back to the real volume", enabled: true, multiplier: 0, want: 1},
		{name: "a negative factor falls back", enabled: true, multiplier: -3, want: 1},
		{name: "NaN falls back", enabled: true, multiplier: math.NaN(), want: 1},
		{name: "an oversized factor is capped", enabled: true, multiplier: 5000, want: 1000},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setting.MultiplierEnabled = tc.enabled
			setting.Multiplier = tc.multiplier
			assert.Equal(t, tc.want, operation_setting.RankingDisplayMultiplier())
		})
	}
}

func TestScaleRankingVolume(t *testing.T) {
	assert.Equal(t, int64(0), scaleRankingVolume(0, 9.8))
	assert.Equal(t, int64(1000), scaleRankingVolume(1000, 1))
	assert.Equal(t, int64(9800), scaleRankingVolume(1000, 9.8))
	// 1 * 9.8 rounds to 10, so a small volume still grows visibly.
	assert.Equal(t, int64(10), scaleRankingVolume(1, 9.8))
	assert.Equal(t, int64(math.MaxInt64), scaleRankingVolume(math.MaxInt64/2, 1000))
}

func TestApplyRankingDisplayMultiplierScalesOnlyPublishedVolumes(t *testing.T) {
	build := func() *RankingsResponse {
		return &RankingsResponse{
			Models: []RankedModel{{
				ModelName:   "gpt-test",
				TotalTokens: 1000,
				Share:       62.5,
				GrowthPct:   12.5,
			}},
			Vendors: []RankedVendor{{
				Vendor:      "openai",
				TotalTokens: 2000,
				Share:       100,
			}},
			ModelsHistory: ModelHistorySeries{
				Points: []ModelHistoryPoint{{Tokens: 300}},
				Models: []ModelHistoryModel{{Total: 400}},
			},
			VendorShareHistory: VendorShareSeries{
				Points:  []VendorSharePoint{{Tokens: 500, Share: 25}},
				Vendors: []VendorShareVendor{{Total: 600, Share: 25}},
			},
		}
	}

	scaled := build()
	applyRankingDisplayMultiplier(scaled, 9.8)

	assert.Equal(t, int64(9800), scaled.Models[0].TotalTokens)
	assert.Equal(t, int64(19600), scaled.Vendors[0].TotalTokens)
	assert.Equal(t, int64(2940), scaled.ModelsHistory.Points[0].Tokens)
	assert.Equal(t, int64(3920), scaled.ModelsHistory.Models[0].Total)
	assert.Equal(t, int64(4900), scaled.VendorShareHistory.Points[0].Tokens)
	assert.Equal(t, int64(5880), scaled.VendorShareHistory.Vendors[0].Total)
	// A uniform factor leaves ratios untouched, so they must not be rescaled.
	assert.Equal(t, 62.5, scaled.Models[0].Share)
	assert.Equal(t, 12.5, scaled.Models[0].GrowthPct)
	assert.Equal(t, 25.0, scaled.VendorShareHistory.Points[0].Share)

	unscaled := build()
	applyRankingDisplayMultiplier(unscaled, 1)
	assert.Equal(t, build(), unscaled)
}
