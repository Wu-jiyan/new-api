package model

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const DeepSweLeaderboardURL = "https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json"

// GachaRatingThresholds 档位阈值（百分比分数）。
// >= UR 为 UR，[SSR, UR) 为 SSR，[SR, SSR) 为 SR，[R, SR) 为 R，< R 为 N。
type GachaRatingThresholds struct {
	UR  float64 `json:"ur"`
	SSR float64 `json:"ssr"`
	SR  float64 `json:"sr"`
	R   float64 `json:"r"`
}

// gachaRatingThresholdsDefault 默认档位阈值。
var gachaRatingThresholdsDefault = GachaRatingThresholds{UR: 65, SSR: 55, SR: 45, R: 30}

// DeepSweRatingThresholds 当前阈值（可变，从选项加载）。
var DeepSweRatingThresholds = GachaRatingThresholds{UR: 65, SSR: 55, SR: 45, R: 30}

// MapScoreToRating 将 DeepSWE Pass@1 分数映射为稀有度档位（分数为百分比数值，如 70 表示 70%）。
func MapScoreToRating(score float64) string {
	t := DeepSweRatingThresholds
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

// deepSweLeaderboardRow DeepSWE leaderboard JSON 行结构（只关心需要的字段）。
type deepSweLeaderboardRow struct {
	Model   string  `json:"model"`
	PassAt1 float64 `json:"pass_at_1"`
	Effort  string  `json:"effort"`
}

// ParseDeepSweLeaderboard 解析 DeepSWE leaderboard JSON，返回 模型名 -> 最高 Pass@1（百分比）。
func ParseDeepSweLeaderboard(data []byte) (map[string]float64, error) {
	var raw struct {
		Models []deepSweLeaderboardRow `json:"models"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	scores := make(map[string]float64, len(raw.Models))
	for _, m := range raw.Models {
		score := m.PassAt1 * 100 // 0.73 -> 73
		if m.PassAt1 > 1 {       // 已经是百分比数值
			score = m.PassAt1
		}
		if old, ok := scores[m.Model]; !ok || score > old {
			scores[m.Model] = score
		}
	}
	return scores, nil
}

// FetchDeepSweLeaderboard 拉取 DeepSWE 榜单并解析（带超时与大小限制）。
func FetchDeepSweLeaderboard() (map[string]float64, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(DeepSweLeaderboardURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("deepswe leaderboard http status %d", resp.StatusCode)
	}
	body := make([]byte, 0, 1<<20)
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		body = append(body, buf[:n]...)
		if len(body) > 4<<20 {
			return nil, fmt.Errorf("deepswe leaderboard response too large")
		}
		if err != nil {
			break
		}
	}
	return ParseDeepSweLeaderboard(body)
}

// ApplyDeepSweScores 将 DeepSWE 分数写入模型分级。
// 仅覆盖 RatingSource 为空或 "deepswe" 的模型；"manual" 不覆盖。
// 返回更新行数。
func ApplyDeepSweScores(scores map[string]float64) (int, error) {
	var models []*Model
	if err := DB.Where("deleted_at IS NULL").Find(&models).Error; err != nil {
		return 0, err
	}
	updated := 0
	for _, m := range models {
		if m.RatingSource == "manual" {
			continue
		}
		score, ok := matchDeepSweScore(m.ModelName, scores)
		if !ok {
			continue
		}
		rating := MapScoreToRating(score)
		if m.Rating == rating && m.RatingScore == score && m.RatingSource == "deepswe" {
			continue
		}
		if err := DB.Model(&Model{}).Where("id = ?", m.Id).
			Updates(map[string]interface{}{
				"rating":        rating,
				"rating_score":  score,
				"rating_source": "deepswe",
			}).Error; err != nil {
			return updated, err
		}
		updated++
	}
	return updated, nil
}

// matchDeepSweScore 按模型名匹配榜单分数：精确 -> 前缀（长度短的榜单名匹配模型名前缀）-> 包含。
func matchDeepSweScore(modelName string, scores map[string]float64) (float64, bool) {
	if s, ok := scores[modelName]; ok {
		return s, true
	}
	best := 0.0
	found := false
	for name, s := range scores {
		if name == "" {
			continue
		}
		if len(name) <= len(modelName) && modelName[:len(name)] == name {
			if !found || s > best {
				best, found = s, true
			}
			continue
		}
		if contains(modelName, name) {
			if !found || s > best {
				best, found = s, true
			}
		}
	}
	return best, found
}

func contains(s, sub string) bool {
	if sub == "" {
		return true
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

// UpdateModelRating 更新指定模型的档位与分数。
func UpdateModelRating(id int, rating string, score float64, source string) error {
	return DB.Model(&Model{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"rating":        rating,
			"rating_score":  score,
			"rating_source": source,
		}).Error
}

// ReloadGachaRatingThresholds 从选项表重新加载阈值。
func ReloadGachaRatingThresholds() {
	common.OptionMapRWMutex.RLock()
	str, ok := common.OptionMap[common.OptionKeyGachaRatingThresholds]
	common.OptionMapRWMutex.RUnlock()
	if !ok || str == "" {
		DeepSweRatingThresholds = gachaRatingThresholdsDefault
		return
	}
	t := gachaRatingThresholdsDefault
	if err := json.Unmarshal([]byte(str), &t); err == nil && t.UR > t.SSR && t.SSR > t.SR && t.SR > t.R && t.R >= 0 {
		DeepSweRatingThresholds = t
	}
}
