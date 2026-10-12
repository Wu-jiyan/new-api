package model

import (
	"github.com/QuantumNous/new-api/common"
)

// RatingDimension 模型评分维度。DeepSWE 是编码维度的独立榜单，AA 的三个维度
// 来自 Artificial Analysis 的 Intelligence / Coding / Agentic 指数。
type RatingDimension string

const (
	RatingDimensionDeepSwe        RatingDimension = "deepswe"
	RatingDimensionAAIntelligence RatingDimension = "aa_intelligence"
	RatingDimensionAACoding       RatingDimension = "aa_coding"
	RatingDimensionAAAgentic      RatingDimension = "aa_agentic"
)

// RatingDimensions 全部评分维度，顺序即前端选择器顺序。
var RatingDimensions = []RatingDimension{
	RatingDimensionDeepSwe,
	RatingDimensionAAIntelligence,
	RatingDimensionAACoding,
	RatingDimensionAAAgentic,
}

// RatingThresholds 单个维度的档位阈值。
// >= UR 为 UR，[SSR, UR) 为 SSR，[SR, SSR) 为 SR，[R, SR) 为 R，< R 为 N。
type RatingThresholds struct {
	UR  float64 `json:"ur"`
	SSR float64 `json:"ssr"`
	SR  float64 `json:"sr"`
	R   float64 `json:"r"`
}

// Valid 阈值必须满足 UR>SSR>SR>R>=0。
func (t RatingThresholds) Valid() bool {
	return t.UR > t.SSR && t.SSR > t.SR && t.SR > t.R && t.R >= 0
}

// ratingThresholdsDefault 各维度默认阈值。DeepSWE 与 AA 的量纲不同
// （前者是 pass@1 百分比，后者是 0-100 的指数），因此不能共用一套。
var ratingThresholdsDefault = map[RatingDimension]RatingThresholds{
	RatingDimensionDeepSwe:        {UR: 65, SSR: 55, SR: 45, R: 30},
	RatingDimensionAAIntelligence: {UR: 60, SSR: 50, SR: 40, R: 30},
	RatingDimensionAACoding:       {UR: 45, SSR: 35, SR: 25, R: 18},
	RatingDimensionAAAgentic:      {UR: 50, SSR: 42, SR: 34, R: 26},
}

// modelRatingThresholds 当前各维度阈值，由 ReloadModelRatingThresholds 加载。
var modelRatingThresholds = cloneRatingThresholds(ratingThresholdsDefault)

func cloneRatingThresholds(src map[RatingDimension]RatingThresholds) map[RatingDimension]RatingThresholds {
	out := make(map[RatingDimension]RatingThresholds, len(src))
	for dim, t := range src {
		out[dim] = t
	}
	return out
}

// RatingThresholdsFor 返回指定维度的当前阈值；未知维度回落到 DeepSWE 默认值。
func RatingThresholdsFor(dim RatingDimension) RatingThresholds {
	if t, ok := modelRatingThresholds[dim]; ok {
		return t
	}
	return ratingThresholdsDefault[RatingDimensionDeepSwe]
}

// MapScoreToRatingWith 按给定阈值把分数映射为稀有度档位。
func MapScoreToRatingWith(score float64, t RatingThresholds) string {
	switch {
	case score >= t.UR:
		return "UR"
	case score >= t.SSR:
		return "SSR"
	case score >= t.SR:
		return "SR"
	case score >= t.R:
		return "R"
	default:
		return "N"
	}
}

// MapScoreToRating 将 DeepSWE Pass@1 分数映射为稀有度档位（分数为百分比数值，如 70 表示 70%）。
func MapScoreToRating(score float64) string {
	return MapScoreToRatingWith(score, RatingThresholdsFor(RatingDimensionDeepSwe))
}

// SetModelRatingThresholds 覆盖全部维度的阈值并落库。非法阈值被忽略。
func SetModelRatingThresholds(next map[RatingDimension]RatingThresholds) error {
	merged := cloneRatingThresholds(modelRatingThresholds)
	for dim, t := range next {
		if !t.Valid() {
			continue
		}
		merged[dim] = t
	}
	encoded, err := common.Marshal(map[RatingDimension]RatingThresholds(merged))
	if err != nil {
		return err
	}
	if err := UpdateOption(common.OptionKeyModelRatingThresholds, string(encoded)); err != nil {
		return err
	}
	modelRatingThresholds = merged
	return nil
}

// ReloadModelRatingThresholds 从选项表重新加载全部维度的阈值。
// 新键缺失时回退到默认值，并把旧的 GachaRatingThresholds 作为 DeepSWE 维度的
// 初值读取一次，之后只认新键，避免两个数据源长期并存。
func ReloadModelRatingThresholds() {
	common.OptionMapRWMutex.RLock()
	raw, hasNew := common.OptionMap[common.OptionKeyModelRatingThresholds]
	legacy, hasLegacy := common.OptionMap[common.OptionKeyGachaRatingThresholds]
	common.OptionMapRWMutex.RUnlock()

	loaded := cloneRatingThresholds(ratingThresholdsDefault)
	if hasNew && raw != "" {
		var stored map[RatingDimension]RatingThresholds
		if err := common.Unmarshal([]byte(raw), &stored); err == nil {
			for dim, t := range stored {
				if _, known := loaded[dim]; known && t.Valid() {
					loaded[dim] = t
				}
			}
			modelRatingThresholds = loaded
			return
		}
	}
	if !hasNew && hasLegacy && legacy != "" {
		var t RatingThresholds
		if err := common.Unmarshal([]byte(legacy), &t); err == nil && t.Valid() {
			loaded[RatingDimensionDeepSwe] = t
		}
	}
	modelRatingThresholds = loaded
}
