package model

import (
	"fmt"
	"slices"

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
//
// AA 三组阈值按 Artificial Analysis 免费档榜单的真实分布标定（2026-10
// 抽样，分别有 689 / 258 / 166 个模型带分），目标是 UR 约占 5-9%、
// N 约占 43-49%。凭直觉设的初版阈值是错的：Intelligence 全榜最高分
// 只有 57.6，UR 却设在 60，于是没有任何模型能达到 UR；Coding 的 UR 设在
// 45，则有一半模型落在 UR。AA 分布会随榜单漂移，管理端可随时调整。
var ratingThresholdsDefault = map[RatingDimension]RatingThresholds{
	RatingDimensionDeepSwe:        {UR: 65, SSR: 55, SR: 45, R: 30},
	RatingDimensionAAIntelligence: {UR: 45, SSR: 37, SR: 24, R: 12},
	RatingDimensionAACoding:       {UR: 76, SSR: 70, SR: 58, R: 42},
	RatingDimensionAAAgentic:      {UR: 52, SSR: 45, SR: 32, R: 18},
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

// ModelSquareSortKeys 模型广场可选的排序方式，取值与前端 SORT_OPTIONS 一致。
var ModelSquareSortKeys = []string{"name", "price-low", "price-high", "score-high"}

// ModelSquareDefaults 模型广场的默认展示方式。这是运营侧的站点配置，
// 匿名访客也能读取，因此只影响未指定 URL 参数时的初始状态，用户在页面上
// 切换维度或排序仍会写入 URL 并优先生效。
type ModelSquareDefaults struct {
	Sort      string          `json:"sort"`
	Dimension RatingDimension `json:"dimension"`
}

// DefaultModelSquareDefaults 默认按名称排序、DeepSWE 维度。选 DeepSWE 是因为
// AA 的 Coding / Agentic 维度在榜单上覆盖很稀疏（抽样中分别只有 258 / 166 个
// 模型有分，Contrast Intelligence 的 689），默认维度用满覆盖的那个更合适。
var DefaultModelSquareDefaults = ModelSquareDefaults{Sort: "name", Dimension: RatingDimensionDeepSwe}

var modelSquareDefaults = DefaultModelSquareDefaults

// GetModelSquareDefaults 返回当前生效的模型广场默认展示方式。
func GetModelSquareDefaults() ModelSquareDefaults {
	return modelSquareDefaults
}

// SetModelSquareDefaults 校验并保存模型广场默认展示方式。非法取值被忽略并返回错误。
func SetModelSquareDefaults(next ModelSquareDefaults) error {
	if !slices.Contains(ModelSquareSortKeys, next.Sort) {
		return fmt.Errorf("unknown sort option %q", next.Sort)
	}
	if !slices.Contains(RatingDimensions, next.Dimension) {
		return fmt.Errorf("unknown rating dimension %q", next.Dimension)
	}
	encoded, err := common.Marshal(next)
	if err != nil {
		return err
	}
	if err := UpdateOption(common.OptionKeyModelSquareDefaults, string(encoded)); err != nil {
		return err
	}
	modelSquareDefaults = next
	return nil
}

// ReloadModelSquareDefaults 从选项表重新加载模型广场默认展示方式。
func ReloadModelSquareDefaults() {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[common.OptionKeyModelSquareDefaults]
	common.OptionMapRWMutex.RUnlock()

	loaded := DefaultModelSquareDefaults
	if raw != "" {
		var stored ModelSquareDefaults
		if err := common.Unmarshal([]byte(raw), &stored); err == nil &&
			slices.Contains(ModelSquareSortKeys, stored.Sort) &&
			slices.Contains(RatingDimensions, stored.Dimension) {
			loaded = stored
		}
	}
	modelSquareDefaults = loaded
}

// ModelSquareFilter 模型广场筛选侧栏的折叠显示配置。与 ModelSquareDefaults 一样
// 是运营侧的站点配置，匿名访客也能读，只影响初始呈现，不改变筛选语义。
//
// VisibleOptions 统计的是「可见筛选项个数」而不是视觉行数：侧栏是 flex-wrap 的
// chip 列表，一行能放几个随标签宽度变化，行数无法在 CSS 里稳定计数。
type ModelSquareFilter struct {
	Collapsible    bool `json:"collapsible"`
	VisibleOptions int  `json:"visible_options"`
}

const (
	// 默认每个筛选组先显示 8 个选项。这是运营侧可调的展示默认值，不是从外部
	// 数据派生的阈值；上下界只保证它既能真的收起，也不会退化成一次显示一个。
	defaultModelSquareFilterVisibleOptions = 8
	minModelSquareFilterVisibleOptions     = 1
	maxModelSquareFilterVisibleOptions     = 50
)

// DefaultModelSquareFilter 默认开启折叠，每个筛选组先显示 8 个选项。
var DefaultModelSquareFilter = ModelSquareFilter{
	Collapsible:    true,
	VisibleOptions: defaultModelSquareFilterVisibleOptions,
}

var modelSquareFilter = DefaultModelSquareFilter

// GetModelSquareFilter 返回当前生效的筛选侧栏折叠配置。
func GetModelSquareFilter() ModelSquareFilter {
	return modelSquareFilter
}

// SetModelSquareFilter 校验并保存筛选侧栏折叠配置。选项个数越界时返回错误。
func SetModelSquareFilter(next ModelSquareFilter) error {
	if next.VisibleOptions < minModelSquareFilterVisibleOptions || next.VisibleOptions > maxModelSquareFilterVisibleOptions {
		return fmt.Errorf("visible options must be between %d and %d", minModelSquareFilterVisibleOptions, maxModelSquareFilterVisibleOptions)
	}
	encoded, err := common.Marshal(next)
	if err != nil {
		return err
	}
	if err := UpdateOption(common.OptionKeyModelSquareFilter, string(encoded)); err != nil {
		return err
	}
	modelSquareFilter = next
	return nil
}

// ReloadModelSquareFilter 从选项表重新加载筛选侧栏折叠配置。缺失或越界时回落到默认。
func ReloadModelSquareFilter() {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[common.OptionKeyModelSquareFilter]
	common.OptionMapRWMutex.RUnlock()

	loaded := DefaultModelSquareFilter
	if raw != "" {
		var stored ModelSquareFilter
		if err := common.Unmarshal([]byte(raw), &stored); err == nil &&
			stored.VisibleOptions >= minModelSquareFilterVisibleOptions &&
			stored.VisibleOptions <= maxModelSquareFilterVisibleOptions {
			loaded = stored
		}
	}
	modelSquareFilter = loaded
}
