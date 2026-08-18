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
	if s, ok := matchDeepSweScore("claude-opus-5-max", scores); !ok || s != 68 {
		t.Fatalf("prefix match claude-opus-5-max = %v/%v, want 68/true", s, ok)
	}
	if _, ok := matchDeepSweScore("unknown-model", scores); ok {
		t.Fatal("unknown model should not match")
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
