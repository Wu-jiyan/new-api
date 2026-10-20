package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// AA 名字带推理档位后缀，必须剥掉后与系统模型名匹配；同名多档取最高分；
// null 表示未测量，不能当成 0 分。
func TestParseAAPages(t *testing.T) {
	page1 := []byte(`{
	  "pagination": {"page": 1, "has_more": true},
	  "data": [
	    {"name": "gpt-5-6-sol (high)", "slug": "gpt-5-6-sol",
	     "evaluations": {"artificial_analysis_intelligence_index": 55.1,
	                     "artificial_analysis_coding_index": 41.0,
	                     "artificial_analysis_agentic_index": null}}
	  ]
	}`)
	page2 := []byte(`{
	  "pagination": {"page": 2, "has_more": false},
	  "data": [
	    {"name": "gpt-5-6-sol (low)", "slug": "gpt-5-6-sol",
	     "evaluations": {"artificial_analysis_intelligence_index": 50.0,
	                     "artificial_analysis_coding_index": 39.0}},
	    {"name": "deepseek v4 pro", "slug": "deepseek-v4-pro",
	     "evaluations": {"artificial_analysis_intelligence_index": 48.0}}
	  ]
	}`)

	scores, err := ParseAAPages([][]byte{page1, page2})
	require.NoError(t, err)

	// 同模型多档取最高
	require.Equal(t, 55.1, scores.Intelligence["gpt-5-6-sol"])
	require.Equal(t, 41.0, scores.Coding["gpt-5-6-sol"])
	// 第一页 agentic 为 null，第二页没有该字段：不应产生任何 agentic 条目
	require.NotContains(t, scores.Agentic, "gpt-5-6-sol")
	// 归一化后 system 模型名可命中 AA 的 slug
	require.Equal(t, 48.0, scores.Intelligence["deepseek-v4-pro"])
}

// AA 的检查点 slug 带日期后缀时（deepseek-v4-1-flash-1017），系统里不带日期的
// 模型名（deepseek-v4.1-flash）必须命中它，而不是只拿到旧检查点的基础分；
// 不带日期后缀的型号名（-non-reasoning）不能被当成检查点别名。
func TestAAPagesMatchCheckpointDate(t *testing.T) {
	page := []byte(`{
	  "pagination": {"page": 1, "has_more": false},
	  "data": [
	    {"name": "DeepSeek V4.1 Flash 1017 (Max)", "slug": "deepseek-v4-1-flash-1017",
	     "evaluations": {"artificial_analysis_intelligence_index": 45.1}},
	    {"name": "DeepSeek V4.1 Flash (Max)", "slug": "deepseek-v4-1-flash",
	     "evaluations": {"artificial_analysis_intelligence_index": 39.5}},
	    {"name": "DeepSeek V4.1 Flash (Non-reasoning)", "slug": "deepseek-v4-1-flash-non-reasoning",
	     "evaluations": {"artificial_analysis_intelligence_index": 24.7}}
	  ]
	}`)

	scores, err := ParseAAPages([][]byte{page})
	require.NoError(t, err)

	// 不带日期的系统模型名命中最新检查点（1017），而不是旧检查点的 39.5
	score, ok := matchDeepSweScore("deepseek-v4.1-flash", scores.Intelligence)
	require.True(t, ok)
	require.Equal(t, 45.1, score)

	// 带日期的完整名仍然精确命中自己的分
	score, ok = matchDeepSweScore("deepseek-v4-1-flash-1017", scores.Intelligence)
	require.True(t, ok)
	require.Equal(t, 45.1, score)

	// 推理档位不是日期后缀，不能被剥成别名
	require.Equal(t, 24.7, scores.Intelligence["deepseek-v4-1-flash-non-reasoning"])
	require.NotContains(t, scores.Intelligence, "deepseek-v4-1-flash-non")
}

// 各维度量纲不同（DeepSWE 是 pass@1 百分比，AA 是指数），阈值必须相互独立：
// 同一个分数在不同维度落到的档位应该不同，否则说明阈值被错误地共用了。
func TestMapScoreToRatingPerDimension(t *testing.T) {
	// 30 分：DeepSWE -> R，AA 综合 -> SR，AA 编码 -> N，AA Agentic -> R
	require.Equal(t, "R", MapScoreToRatingWith(30, ratingThresholdsDefault[RatingDimensionDeepSwe]))
	require.Equal(t, "SR", MapScoreToRatingWith(30, ratingThresholdsDefault[RatingDimensionAAIntelligence]))
	require.Equal(t, "N", MapScoreToRatingWith(30, ratingThresholdsDefault[RatingDimensionAACoding]))
	require.Equal(t, "R", MapScoreToRatingWith(30, ratingThresholdsDefault[RatingDimensionAAAgentic]))
	// 50 分：DeepSWE -> SR，AA 综合 -> UR，AA 编码 -> R，AA Agentic -> SR
	require.Equal(t, "SR", MapScoreToRatingWith(50, ratingThresholdsDefault[RatingDimensionDeepSwe]))
	require.Equal(t, "UR", MapScoreToRatingWith(50, ratingThresholdsDefault[RatingDimensionAAIntelligence]))
	require.Equal(t, "R", MapScoreToRatingWith(50, ratingThresholdsDefault[RatingDimensionAACoding]))
}

// 默认阈值必须落在 AA 榜单的真实取值范围内，否则最强者永远拿不到 UR、
// 或半数模型挤进 UR。这组数字由榜单抽样标定，改动前应重新核对分布。
func TestDefaultThresholdsCoverMeasuredAARange(t *testing.T) {
	// 2026-10 实测 Artificial Analysis 免费档全榜最高分
	measuredMax := map[RatingDimension]float64{
		RatingDimensionAAIntelligence: 57.6,
		RatingDimensionAACoding:       81.6,
		RatingDimensionAAAgentic:      57.9,
	}
	for dim, max := range measuredMax {
		th := ratingThresholdsDefault[dim]
		require.Less(t, th.UR, max, "%s: UR 阈值必须低于榜单最高分，否则没有模型能到 UR", dim)
		require.Greater(t, th.UR, th.SSR, "%s: 阈值必须 UR>SSR>SR>R>=0", dim)
		require.Greater(t, th.SSR, th.SR, "%s: 阈值必须 UR>SSR>SR>R>=0", dim)
		require.Greater(t, th.SR, th.R, "%s: 阈值必须 UR>SSR>SR>R>=0", dim)
		require.GreaterOrEqual(t, th.R, 0.0, "%s: R 阈值不能为负", dim)
	}
}

// 阈值写入后按维度生效，且非法阈值被拒绝。
func TestSetModelRatingThresholds(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Option{}))
	original := modelRatingThresholds
	t.Cleanup(func() { modelRatingThresholds = original })

	prev := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = prev })

	next := RatingThresholds{UR: 90, SSR: 80, SR: 70, R: 60}
	require.NoError(t, SetModelRatingThresholds(map[RatingDimension]RatingThresholds{
		RatingDimensionAAIntelligence: next,
	}))
	require.Equal(t, next, RatingThresholdsFor(RatingDimensionAAIntelligence))
	// 未指定维度保持原值
	require.Equal(t, ratingThresholdsDefault[RatingDimensionAACoding], RatingThresholdsFor(RatingDimensionAACoding))

	// UR<=SSR 非法，应被忽略而不是写入
	invalid := RatingThresholds{UR: 10, SSR: 80, SR: 70, R: 60}
	require.NoError(t, SetModelRatingThresholds(map[RatingDimension]RatingThresholds{
		RatingDimensionAAIntelligence: invalid,
	}))
	require.Equal(t, next, RatingThresholdsFor(RatingDimensionAAIntelligence))

	// 重新加载后能读回已保存的维度
	ReloadModelRatingThresholds()
	require.Equal(t, next, RatingThresholdsFor(RatingDimensionAAIntelligence))
}

// 新键缺失时，旧 GachaRatingThresholds 作为 DeepSWE 维度初值读取一次。
func TestReloadModelRatingThresholdsLegacyFallback(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Option{}))
	original := modelRatingThresholds
	t.Cleanup(func() { modelRatingThresholds = original })

	prev := common.OptionMap
	common.OptionMap = map[string]string{
		common.OptionKeyGachaRatingThresholds: `{"ur":70,"ssr":60,"sr":50,"r":40}`,
	}
	t.Cleanup(func() { common.OptionMap = prev })

	ReloadModelRatingThresholds()
	require.Equal(t, RatingThresholds{UR: 70, SSR: 60, SR: 50, R: 40},
		RatingThresholdsFor(RatingDimensionDeepSwe))
	// AA 维度不受旧键影响
	require.Equal(t, ratingThresholdsDefault[RatingDimensionAACoding], RatingThresholdsFor(RatingDimensionAACoding))
}

// AA 同步写入三个维度；手动填写过的模型整体跳过；重复同步幂等。
func TestApplyAAScores(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Model{}, &Option{}))
	// 后缀模型名靠最长前缀匹配命中榜单基础名；unknown-model 没有任何前缀可命中。
	names := []string{"gpt-5.6-sol-aa", "deepseek-v4-pro-aa", "claude-opus-4-6-aa", "unknown-model-aa"}
	for _, name := range names {
		require.NoError(t, DB.Where("model_name = ?", name).Unscoped().Delete(&Model{}).Error)
		require.NoError(t, DB.Create(&Model{ModelName: name, Status: 1}).Error)
		t.Cleanup(func() { require.NoError(t, DB.Where("model_name = ?", name).Unscoped().Delete(&Model{}).Error) })
	}
	// 人工填写过 AA 分数的模型不应被同步覆盖
	require.NoError(t, DB.Model(&Model{}).Where("model_name = ?", "claude-opus-4-6-aa").
		Updates(map[string]any{"aa_coding_score": 12.0, "aa_source": "manual"}).Error)

	scores := &AAScores{
		Intelligence: map[string]float64{"gpt-5-6-sol": 55.1, "deepseek-v4-pro": 48.0, "claude-opus-4-6": 61.0},
		Coding:       map[string]float64{"gpt-5-6-sol": 41.0, "deepseek-v4-pro": 33.0, "claude-opus-4-6": 44.0},
		Agentic:      map[string]float64{"gpt-5-6-sol": 52.0, "deepseek-v4-pro": 30.0, "claude-opus-4-6": 50.0},
	}
	res, err := ApplyAAScores(scores)
	require.NoError(t, err)
	require.Equal(t, 2, res.Updated)
	require.Equal(t, 1, res.SkippedManual)
	require.Equal(t, 1, res.Unmatched)
	// 手动模型在匹配前就被跳过，因此不计入各维度命中数
	require.Equal(t, 2, res.MatchedCount[string(RatingDimensionAAIntelligence)])
	require.Equal(t, 2, res.MatchedCount[string(RatingDimensionAACoding)])
	require.Equal(t, 2, res.MatchedCount[string(RatingDimensionAAAgentic)])

	var got Model
	require.NoError(t, DB.Where("model_name = ?", "gpt-5.6-sol-aa").First(&got).Error)
	require.Equal(t, 55.1, got.AAIntelligenceScore)
	require.Equal(t, 41.0, got.AACodingScore)
	require.Equal(t, 52.0, got.AAAgenticScore)
	require.Equal(t, aaSourceRating, got.AASource)

	// DeepSWE 维度不受 AA 同步影响
	require.Empty(t, got.Rating)
	require.Zero(t, got.RatingScore)

	var manual Model
	require.NoError(t, DB.Where("model_name = ?", "claude-opus-4-6-aa").First(&manual).Error)
	require.Equal(t, 12.0, manual.AACodingScore)
	require.Equal(t, "manual", manual.AASource)

	// 幂等：再次同步全部无变化
	res, err = ApplyAAScores(scores)
	require.NoError(t, err)
	require.Equal(t, 0, res.Updated)
	require.Equal(t, 2, res.Unchanged)

	// 清空后可被同步重新覆盖
	var ids []int
	require.NoError(t, DB.Model(&Model{}).
		Where("model_name IN ?", []string{"gpt-5.6-sol-aa", "deepseek-v4-pro-aa"}).
		Pluck("id", &ids).Error)
	n, err := ResetModelAAScores(ids)
	require.NoError(t, err)
	require.Equal(t, int64(2), n)
	require.NoError(t, DB.Where("model_name = ?", "gpt-5.6-sol-aa").First(&got).Error)
	require.Zero(t, got.AAIntelligenceScore)
	require.Empty(t, got.AASource)

	res, err = ApplyAAScores(scores)
	require.NoError(t, err)
	require.Equal(t, 2, res.Updated)
}

func TestModelSquareDefaultsValidation(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Option{}))
	original := modelSquareDefaults
	t.Cleanup(func() { modelSquareDefaults = original })
	prev := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = prev })

	next := ModelSquareDefaults{Sort: "score-high", Dimension: RatingDimensionAACoding}
	require.NoError(t, SetModelSquareDefaults(next))
	require.Equal(t, next, GetModelSquareDefaults())

	// 非法排序与未知维度必须被拒绝，不能写进配置后靠前端静默回退
	require.Error(t, SetModelSquareDefaults(ModelSquareDefaults{
		Sort: "not-a-sort", Dimension: RatingDimensionDeepSwe,
	}))
	require.Error(t, SetModelSquareDefaults(ModelSquareDefaults{
		Sort: "name", Dimension: RatingDimension("nope"),
	}))
	// 被拒绝的写入不应改变已生效的值
	require.Equal(t, next, GetModelSquareDefaults())

	ReloadModelSquareDefaults()
	require.Equal(t, next, GetModelSquareDefaults())
}

func TestReloadModelSquareDefaultsIgnoresCorruptOption(t *testing.T) {
	original := modelSquareDefaults
	t.Cleanup(func() { modelSquareDefaults = original })
	prev := common.OptionMap
	t.Cleanup(func() { common.OptionMap = prev })

	// 旧配置里存过的无效排序不能让广场拿到非法值
	common.OptionMap = map[string]string{
		common.OptionKeyModelSquareDefaults: `{"sort":"legacy-sort","dimension":"deepswe"}`,
	}
	ReloadModelSquareDefaults()
	require.Equal(t, DefaultModelSquareDefaults, GetModelSquareDefaults())
}

func TestModelSquareFilterValidation(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Option{}))
	original := modelSquareFilter
	t.Cleanup(func() { modelSquareFilter = original })
	prev := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = prev })

	next := ModelSquareFilter{Collapsible: false, VisibleOptions: 12}
	require.NoError(t, SetModelSquareFilter(next))
	require.Equal(t, next, GetModelSquareFilter())

	// 越界数量必须被拒绝，不能写进配置后靠前端静默回退
	require.Error(t, SetModelSquareFilter(ModelSquareFilter{Collapsible: true, VisibleOptions: 0}))
	require.Error(t, SetModelSquareFilter(ModelSquareFilter{
		Collapsible: true, VisibleOptions: maxModelSquareFilterVisibleOptions + 1,
	}))
	// 被拒绝的写入不应改变已生效的值
	require.Equal(t, next, GetModelSquareFilter())

	ReloadModelSquareFilter()
	require.Equal(t, next, GetModelSquareFilter())
}

func TestReloadModelSquareFilterFallsBackOnCorruptOption(t *testing.T) {
	original := modelSquareFilter
	t.Cleanup(func() { modelSquareFilter = original })
	prev := common.OptionMap
	t.Cleanup(func() { common.OptionMap = prev })

	// 缺失、乱码与越界都不能让广场拿到非法配置
	for _, raw := range []string{
		"",
		"not json",
		`{"collapsible":true,"visible_options":0}`,
		`{"collapsible":true,"visible_options":999}`,
	} {
		common.OptionMap = map[string]string{
			common.OptionKeyModelSquareFilter: raw,
		}
		ReloadModelSquareFilter()
		require.Equal(t, DefaultModelSquareFilter, GetModelSquareFilter(), "raw=%q", raw)
	}
}

// 模型分级列表只应列出能上模型广场的模型：光有元信息、没有启用渠道的模型
// 不该出现在评分列表里——给不会上架的模型打分没有意义。
func TestFilterSquareVisibleModels(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Model{}, &Channel{}, &Ability{}))

	enabled := Channel{Type: 1, Key: "sk-sq-on", Status: common.ChannelStatusEnabled,
		Name: "sq-enabled", Models: "sq-visible,sq-meta-disabled", Group: "default"}
	off := Channel{Type: 1, Key: "sk-sq-off", Status: common.ChannelStatusManuallyDisabled,
		Name: "sq-disabled", Models: "sq-channel-disabled", Group: "default"}
	require.NoError(t, DB.Create(&enabled).Error)
	require.NoError(t, DB.Create(&off).Error)
	t.Cleanup(func() {
		DB.Where("channel_id IN ?", []int{enabled.Id, off.Id}).Delete(&Ability{})
		DB.Unscoped().Delete(&enabled)
		DB.Unscoped().Delete(&off)
	})
	for _, ch := range []Channel{enabled, off} {
		for _, name := range strings.Split(ch.Models, ",") {
			require.NoError(t, DB.Create(&Ability{Group: "default", Model: name, ChannelId: ch.Id, Enabled: true}).Error)
		}
	}

	rows := []*Model{
		{ModelName: "sq-visible", Status: 1},          // 启用渠道提供，元信息启用
		{ModelName: "sq-meta-only", Status: 1},        // 只有元信息，没有任何渠道
		{ModelName: "sq-meta-disabled", Status: 0},    // 渠道启用，但元信息把它禁用了
		{ModelName: "sq-channel-disabled", Status: 1}, // 只有被手动停用的渠道
	}
	for _, row := range rows {
		require.NoError(t, DB.Create(row).Error)
	}
	t.Cleanup(func() { DB.Unscoped().Where("model_name LIKE 'sq-%'").Delete(&Model{}) })
	// models.status 带 gorm:"default:1"，零值会在插入时被默认值顶掉，
	// 因此「元信息禁用」这一档必须显式写回 0，否则测的其实是启用状态。
	require.NoError(t, DB.Model(&Model{}).Where("model_name = ?", "sq-meta-disabled").
		Update("status", 0).Error)

	visible, err := FilterSquareVisibleModels(rows)
	require.NoError(t, err)

	names := make([]string, 0, len(visible))
	for _, row := range visible {
		names = append(names, row.ModelName)
	}
	require.Equal(t, []string{"sq-visible"}, names)
}
