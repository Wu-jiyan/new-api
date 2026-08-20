package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMapScoreToRating(t *testing.T) {
	cases := []struct {
		score float64
		want  string
	}{
		{70, "UR"}, {65, "UR"}, {64.9, "SSR"}, {55, "SSR"}, {54.9, "SR"},
		{45, "SR"}, {44.9, "R"}, {30, "R"}, {29.9, "N"}, {0, "N"},
	}
	for _, c := range cases {
		if got := MapScoreToRating(c.score); got != c.want {
			t.Fatalf("MapScoreToRating(%v) = %q, want %q", c.score, got, c.want)
		}
	}
}

// 与真实 leaderboard-live.json 结构一致的样本：顶层为 rows 数组。
func TestParseDeepSweLeaderboard(t *testing.T) {
	jsonData := []byte(`{
	  "scope": "test",
	  "rows": [
	    {"model": "gpt-5-6-sol", "harness": "mini-swe-agent", "reasoning_effort": "max", "pass_at_1": 0.73},
	    {"model": "gpt-5-6-sol", "harness": "mini-swe-agent", "reasoning_effort": "medium", "pass_at_1": 0.60},
	    {"model": "deepseek-v4-pro", "harness": "mini-swe-agent", "reasoning_effort": "max", "pass_at_1": 0.63}
	  ]
	}`)
	scores, err := ParseDeepSweLeaderboard(jsonData)
	if err != nil {
		t.Fatal(err)
	}
	if scores["gpt-5-6-sol"] != 73 { // 同模型取最高分（比例转百分比）
		t.Fatalf("gpt-5-6-sol = %v, want 73", scores["gpt-5-6-sol"])
	}
	if scores["deepseek-v4-pro"] != 63 {
		t.Fatalf("deepseek-v4-pro = %v, want 63", scores["deepseek-v4-pro"])
	}
}

func TestMatchDeepSweScoreNormalized(t *testing.T) {
	scores := map[string]float64{
		"gpt-5-6-sol": 73,
		"claude-opus": 68,
	}
	// 系统模型名使用点分隔，应能归一化匹配 DeepSWE 的连字符分隔
	if s, ok := matchDeepSweScore("gpt-5.6-sol", scores); !ok || s != 73 {
		t.Fatalf("normalized match gpt-5.6-sol = %v/%v, want 73/true", s, ok)
	}
	if _, ok := matchDeepSweScore("unknown-model", scores); ok {
		t.Fatal("unknown model should not match")
	}
}

func TestMatchDeepSweScorePreferLongestPrefix(t *testing.T) {
	// 榜单同时存在基础版与版本号：版本模型优先匹配自己（更长）的行，而非基础版
	scores := map[string]float64{
		"deepseek-v4-flash":      53,
		"deepseek-v4-flash-0731": 78,
	}
	if s, ok := matchDeepSweScore("deepseek-v4-flash-0731", scores); !ok || s != 78 {
		t.Fatalf("versioned model should prefer its own score, got %v/%v, want 78/true", s, ok)
	}
	if s, ok := matchDeepSweScore("deepseek-v4-flash", scores); !ok || s != 53 {
		t.Fatalf("base model = %v/%v, want 53/true", s, ok)
	}
	// 即使版本行分数更低，也应使用版本行（更长 = 更具体），而不是分数更高的基础行
	lower := map[string]float64{
		"deepseek-v4-flash":      53,
		"deepseek-v4-flash-0731": 40,
	}
	if s, ok := matchDeepSweScore("deepseek-v4-flash-0731", lower); !ok || s != 40 {
		t.Fatalf("versioned model should pick longest prefix regardless of score, got %v/%v, want 40/true", s, ok)
	}
	// 榜单只有基础版时，版本模型继承基础版分数（保证同步不再为 0）
	baseOnly := map[string]float64{"deepseek-v4-flash": 53}
	if s, ok := matchDeepSweScore("deepseek-v4-flash-0731", baseOnly); !ok || s != 53 {
		t.Fatalf("versioned model should inherit base score, got %v/%v, want 53/true", s, ok)
	}
}

// 端到端：真实榜单结构 + 归一化匹配 -> ApplyDeepSweScores 写入模型分级。
func TestApplyDeepSweScoresRealistic(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Model{}))
	require.NoError(t, DB.Where("model_name = ?", "gpt-5.6-sol").Unscoped().Delete(&Model{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Where("model_name = ?", "gpt-5.6-sol").Unscoped().Delete(&Model{}).Error)
	})
	m := &Model{ModelName: "gpt-5.6-sol", Status: 1}
	require.NoError(t, DB.Create(m).Error)

	n, err := ApplyDeepSweScores(map[string]float64{"gpt-5-6-sol": 73.6})
	require.NoError(t, err)
	require.Equal(t, 1, n)

	var got Model
	require.NoError(t, DB.First(&got, m.Id).Error)
	require.Equal(t, "UR", got.Rating)
	require.Equal(t, 73.6, got.RatingScore)
	require.Equal(t, "deepswe", got.RatingSource)

	// 重复同步应不再更新（幂等）
	n, err = ApplyDeepSweScores(map[string]float64{"gpt-5-6-sol": 73.6})
	require.NoError(t, err)
	require.Equal(t, 0, n)
}

func TestApplyDeepSweScoresDetailedAndReset(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Model{}))
	names := []string{"gpt-5-6-sol", "deepseek-v4-flash-0731", "claude-opus-9", "manual-model"}
	for _, name := range names {
		require.NoError(t, DB.Where("model_name = ?", name).Unscoped().Delete(&Model{}).Error)
		require.NoError(t, DB.Create(&Model{ModelName: name, Status: 1}).Error)
		t.Cleanup(func() { require.NoError(t, DB.Where("model_name = ?", name).Unscoped().Delete(&Model{}).Error) })
	}
	// manual 模型应被同步跳过
	require.NoError(t, DB.Model(&Model{}).Where("model_name = ?", "manual-model").
		Updates(map[string]interface{}{"rating": "UR", "rating_score": 90, "rating_source": "manual"}).Error)

	scores := map[string]float64{"gpt-5-6-sol": 73.6, "deepseek-v4-flash": 53}
	res, err := ApplyDeepSweScoresDetailed(scores)
	require.NoError(t, err)
	require.Equal(t, 2, res.Updated) // 精确匹配 + 版本模型继承基础分
	require.Equal(t, 0, res.Unchanged)
	require.Equal(t, 1, res.SkippedManual)
	require.Equal(t, 1, res.Unmatched) // claude-opus-9
	require.Len(t, res.UpdatedModels, 2)

	// 幂等：再次同步全部无变化
	res2, err := ApplyDeepSweScoresDetailed(scores)
	require.NoError(t, err)
	require.Equal(t, 0, res2.Updated)
	require.Equal(t, 2, res2.Unchanged)

	// 重置为空后评分/来源清空，可再次被同步覆盖
	var ids []int
	require.NoError(t, DB.Model(&Model{}).
		Where("model_name IN ?", []string{"gpt-5-6-sol", "deepseek-v4-flash-0731"}).Pluck("id", &ids).Error)
	n, err := ResetGachaRatings(ids)
	require.NoError(t, err)
	require.Equal(t, int64(2), n)
	var m Model
	require.NoError(t, DB.Where("model_name = ?", "gpt-5-6-sol").First(&m).Error)
	require.Empty(t, m.Rating)
	require.Empty(t, m.RatingSource)
	require.Zero(t, m.RatingScore)

	res3, err := ApplyDeepSweScoresDetailed(scores)
	require.NoError(t, err)
	require.Equal(t, 2, res3.Updated)
}
