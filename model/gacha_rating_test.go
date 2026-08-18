package model

import "testing"

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

func TestParseDeepSweLeaderboard(t *testing.T) {
	jsonData := []byte(`{
	  "models": [
	    {"model": "gpt-5.6-sol", "pass_at_1": 0.73, "effort": "max"},
	    {"model": "gpt-5.6-sol", "pass_at_1": 0.60, "effort": "medium"},
	    {"model": "deepseek-v4-pro", "pass_at_1": 0.63, "effort": "max"}
	  ]
	}`)
	scores, err := ParseDeepSweLeaderboard(jsonData)
	if err != nil {
		t.Fatal(err)
	}
	if scores["gpt-5.6-sol"] != 73 { // 同模型取最高分（百分比）
		t.Fatalf("gpt-5.6-sol = %v, want 73", scores["gpt-5.6-sol"])
	}
	if scores["deepseek-v4-pro"] != 63 {
		t.Fatalf("deepseek-v4-pro = %v, want 63", scores["deepseek-v4-pro"])
	}
}
