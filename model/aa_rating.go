package model

import (
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	// AAModelsURL Artificial Analysis 免费档语言模型端点。该端点接受任意有效
	// key（Free/Pro/Commercial），返回形状始终是公开字段子集。
	AAModelsURL = "https://artificialanalysis.ai/api/v2/language/models/free"
	// aaSourceRating AA 维度评分的来源标记。
	aaSourceRating = "artificialanalysis"
	// aaMaxPages 分页上限，防御性边界：官方语言模型量级远小于该值。
	aaMaxPages = 20
)

// AAModelRow AA 免费端点的单行模型数据（只取匹配与评分需要的字段）。
type AAModelRow struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Evaluations struct {
		Intelligence *float64 `json:"artificial_analysis_intelligence_index"`
		Coding       *float64 `json:"artificial_analysis_coding_index"`
		Agentic      *float64 `json:"artificial_analysis_agentic_index"`
	} `json:"evaluations"`
}

// AAModelsPage AA 免费端点的单页响应。
type AAModelsPage struct {
	Pagination struct {
		HasMore bool `json:"has_more"`
	} `json:"pagination"`
	Data []AAModelRow `json:"data"`
}

// AAScores 三个 AA 维度各自的「模型名 -> 分数」。
type AAScores struct {
	Intelligence map[string]float64
	Coding       map[string]float64
	Agentic      map[string]float64
}

// aaCheckpointSuffix 匹配 AA 用来标记检查点日期的结尾后缀（-0420 / -1017 / -20241022）。
// AA 的 slug 命名并不统一：有的检查点带日期（deepseek-v4-1-flash-1017），
// 有的基础版反而占用裸名（deepseek-v4-flash），系统里的模型名通常不带日期。
var aaCheckpointSuffix = regexp.MustCompile(`-\d{4}$|-\d{8}$`)

// aaModelKeys 返回一行 AA 数据可用于匹配的名字，按可靠性排序：
// slug 最干净（gpt-oss-20b），name 带厂商前缀与推理档位（gpt-oss-20B (high)）。
// 括号里的推理档位后缀必须剥掉，否则带 (high) 的条目永远匹配不上系统模型名。
// 带检查点日期的行额外登记一个去掉日期的别名：系统模型名不带日期时
// （deepseek-v4.1-flash）只能命中裸名那条旧检查点，别名让它命中最新检查点。
// 同一分数登记到所有名字下，让精确匹配与归一化匹配都有机会命中。
func aaModelKeys(row AAModelRow) []string {
	var keys []string
	if slug := normalizeDeepSweName(row.Slug); slug != "" {
		keys = append(keys, slug)
	}
	name, _, _ := strings.Cut(row.Name, "(")
	if name = normalizeDeepSweName(strings.TrimSpace(name)); name != "" && !slices.Contains(keys, name) {
		keys = append(keys, name)
	}
	for _, key := range slices.Clone(keys) {
		base := aaCheckpointSuffix.ReplaceAllString(key, "")
		if base != key && base != "" && !slices.Contains(keys, base) {
			keys = append(keys, base)
		}
	}
	return keys
}

// ParseAAPages 解析若干页 AA 响应并合并为三维度分数表。同名模型取最高分，
// 因为同一模型可能按推理档位拆成多条目。
func ParseAAPages(pages [][]byte) (*AAScores, error) {
	out := &AAScores{
		Intelligence: map[string]float64{},
		Coding:       map[string]float64{},
		Agentic:      map[string]float64{},
	}
	for _, body := range pages {
		var page AAModelsPage
		if err := common.Unmarshal(body, &page); err != nil {
			return nil, err
		}
		for _, row := range page.Data {
			keys := aaModelKeys(row)
			if len(keys) == 0 {
				continue
			}
			for _, dim := range []struct {
				dst map[string]float64
				val *float64
			}{
				{out.Intelligence, row.Evaluations.Intelligence},
				{out.Coding, row.Evaluations.Coding},
				{out.Agentic, row.Evaluations.Agentic},
			} {
				// null 表示未测量，按数据源约定不能当成 0 分处理。
				if dim.val == nil {
					continue
				}
				for _, key := range keys {
					if old, ok := dim.dst[key]; !ok || *dim.val > old {
						dim.dst[key] = *dim.val
					}
				}
			}
		}
	}
	return out, nil
}

// FetchAAScores 拉取 AA 免费档全部分页并解析。apiKey 为空时返回明确错误，
// 调用方据此跳过同步而不视为故障。
func FetchAAScores(apiKey string) (*AAScores, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, fmt.Errorf("artificial analysis api key is not configured")
	}
	client := &http.Client{Timeout: 30 * time.Second}
	var pages [][]byte
	for page := 1; page <= aaMaxPages; page++ {
		url := AAModelsURL + "?page=" + strconv.Itoa(page)
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("x-api-key", apiKey)
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, readErr := readLimitedBody(resp, 4<<20)
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("artificial analysis http status %d", resp.StatusCode)
		}
		var decoded AAModelsPage
		if err := common.Unmarshal(body, &decoded); err != nil {
			return nil, err
		}
		pages = append(pages, body)
		if !decoded.Pagination.HasMore {
			break
		}
	}
	return ParseAAPages(pages)
}

// AASyncItem 单个模型的 AA 分数明细。
type AASyncItem struct {
	ModelName    string  `json:"model_name"`
	Intelligence float64 `json:"aa_intelligence_score"`
	Coding       float64 `json:"aa_coding_score"`
	Agentic      float64 `json:"aa_agentic_score"`
}

// AASyncResult AA 同步结果统计。
type AASyncResult struct {
	Updated       int            `json:"updated"`
	Unchanged     int            `json:"unchanged"`
	SkippedManual int            `json:"skipped_manual"`
	Unmatched     int            `json:"unmatched"`
	MatchedCount  map[string]int `json:"matched_count"`
	FetchedCount  map[string]int `json:"fetched_count"`
	UpdatedModels []AASyncItem   `json:"updated_models"`
}

// aaScoreColumns 各维度分数对应的数据库列，供统计与写入共用。
var aaScoreColumns = []struct {
	dimension RatingDimension
	column    string
}{
	{RatingDimensionAAIntelligence, "aa_intelligence_score"},
	{RatingDimensionAACoding, "aa_coding_score"},
	{RatingDimensionAAAgentic, "aa_agentic_score"},
}

// ApplyAAScores 将 AA 三维度分数写入模型。人工填写过（aa_source == manual）的模型
// 整体跳过，三个维度都不会被覆盖；某一维度未匹配到时该维度记 0，不影响其他维度。
func ApplyAAScores(scores *AAScores) (*AASyncResult, error) {
	var models []*Model
	if err := DB.Where("deleted_at IS NULL").Find(&models).Error; err != nil {
		return nil, err
	}
	res := &AASyncResult{
		UpdatedModels: []AASyncItem{},
		MatchedCount:  map[string]int{},
		FetchedCount: map[string]int{
			string(RatingDimensionAAIntelligence): len(scores.Intelligence),
			string(RatingDimensionAACoding):       len(scores.Coding),
			string(RatingDimensionAAAgentic):      len(scores.Agentic),
		},
	}
	perDimension := []map[string]float64{
		scores.Intelligence,
		scores.Coding,
		scores.Agentic,
	}
	for _, m := range models {
		if m.AASource == "manual" {
			res.SkippedManual++
			continue
		}
		values := make([]float64, len(perDimension))
		matchedAny := false
		for i, table := range perDimension {
			if score, ok := matchDeepSweScore(m.ModelName, table); ok {
				values[i] = score
				matchedAny = true
				res.MatchedCount[string(aaScoreColumns[i].dimension)]++
			}
		}
		if !matchedAny {
			res.Unmatched++
			continue
		}
		if m.AAIntelligenceScore == values[0] && m.AACodingScore == values[1] &&
			m.AAAgenticScore == values[2] && m.AASource == aaSourceRating {
			res.Unchanged++
			continue
		}
		updates := map[string]any{"aa_source": aaSourceRating}
		for i, col := range aaScoreColumns {
			updates[col.column] = values[i]
		}
		if err := DB.Model(&Model{}).Where("id = ?", m.Id).Updates(updates).Error; err != nil {
			return res, err
		}
		res.Updated++
		res.UpdatedModels = append(res.UpdatedModels, AASyncItem{
			ModelName:    m.ModelName,
			Intelligence: values[0],
			Coding:       values[1],
			Agentic:      values[2],
		})
	}
	return res, nil
}

// ResetModelAAScores 批量清空模型的 AA 三维度分数与来源。
func ResetModelAAScores(ids []int) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	updates := map[string]any{"aa_source": ""}
	for _, col := range aaScoreColumns {
		updates[col.column] = 0
	}
	res := DB.Model(&Model{}).Where("id IN ?", ids).Updates(updates)
	return res.RowsAffected, res.Error
}

// UpdateModelAAScores 手动写入 AA 三维度分数并标记来源为 manual。
func UpdateModelAAScores(id int, intelligence, coding, agentic float64) error {
	return DB.Model(&Model{}).Where("id = ?", id).Updates(map[string]any{
		"aa_intelligence_score": intelligence,
		"aa_coding_score":       coding,
		"aa_agentic_score":      agentic,
		"aa_source":             "manual",
	}).Error
}
