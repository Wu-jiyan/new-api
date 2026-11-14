package operation_setting

import (
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const (
	RankingDisplayMultiplierEnabledOptionKey = "ranking_display_setting.multiplier_enabled"
	RankingDisplayMultiplierOptionKey        = "ranking_display_setting.multiplier"

	// maxRankingDisplayMultiplier bounds the factor so a scaled volume cannot
	// run away from the int64 it is stored in.
	maxRankingDisplayMultiplier = 1000
)

// RankingDisplaySetting inflates the token volumes the rankings page publishes.
// It is display only: consume logs, quota, model stats and every other figure
// keep the real value.
type RankingDisplaySetting struct {
	// MultiplierEnabled turns the factor on; off publishes the real volume.
	MultiplierEnabled bool `json:"multiplier_enabled"`
	// Multiplier is what the published token volumes are multiplied by.
	Multiplier float64 `json:"multiplier"`
}

var rankingDisplaySetting = RankingDisplaySetting{
	MultiplierEnabled: false,
	Multiplier:        1,
}

func init() {
	config.GlobalConfig.Register("ranking_display_setting", &rankingDisplaySetting)
}

func GetRankingDisplaySetting() *RankingDisplaySetting {
	return &rankingDisplaySetting
}

// RankingDisplayMultiplier is the factor the rankings page applies to the token
// volumes it publishes. It is 1 whenever the factor is off or unusable, so a
// bad value can only ever show the real figures.
func RankingDisplayMultiplier() float64 {
	if !rankingDisplaySetting.MultiplierEnabled {
		return 1
	}
	multiplier := rankingDisplaySetting.Multiplier
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier <= 0 {
		return 1
	}
	return math.Min(multiplier, maxRankingDisplayMultiplier)
}

// ValidateRankingDisplayMultiplier rejects a factor that would show nothing
// (zero, negative) or a nonsensical scale.
func ValidateRankingDisplayMultiplier(value string) error {
	multiplier, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return common.NewMessage("Ranking display multiplier must be a number")
	}
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier <= 0 || multiplier > maxRankingDisplayMultiplier {
		return common.NewMessage("Ranking display multiplier must be greater than 0 and at most 1000")
	}
	return nil
}
