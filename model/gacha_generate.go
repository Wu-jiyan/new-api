package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// 卡池条目批量生成：按档位自动分配权重与额度区间，并按目标回本率建议售价。

// GenerateGachaEntryReq 批量生成条目请求。
type GenerateGachaEntryReq struct {
	Group      string           `json:"group"`                 // 分组
	Models     []string         `json:"models"`                // 选中的模型名
	ExpireDays int              `json:"expire_days"`           // 卡过期天数，0 永久
	Weights    map[string]int   `json:"weights"`               // 档位 -> 权重（空用默认）
	QuotaMin   map[string]int64 `json:"quota_min"`             // 档位 -> 额度下限
	QuotaMax   map[string]int64 `json:"quota_max"`             // 档位 -> 额度上限
	TargetRTP  float64          `json:"target_rtp"`            // 客户视角期望回本率（期望价值/售价），默认 0.7
	AutoPrice  bool             `json:"auto_price"`            // 自动设置单抽/十连价格
	Replace    bool             `json:"replace"`               // 替换该分组现有条目
}

// gachaDefaultWeights 默认档位权重模板（数字越大越容易抽中）。
var gachaDefaultWeights = map[string]int{"N": 100, "R": 40, "SR": 15, "SSR": 5, "UR": 1}

// gachaDefaultQuotaMin/Max 默认档位额度区间（quota）。
var gachaDefaultQuotaMin = map[string]int64{"N": 500, "R": 800, "SR": 1500, "SSR": 3000, "UR": 8000}
var gachaDefaultQuotaMax = map[string]int64{"N": 800, "R": 1500, "SR": 3000, "SSR": 8000, "UR": 20000}

// GenerateGachaEntryView 生成预览中的单条。
type GenerateGachaEntryView struct {
	Entry       GachaCardEntry `json:"entry"`
	Rating      string         `json:"rating"`
	Probability float64        `json:"probability"`
	UnitCost    float64        `json:"unit_cost"`
	CostKnown   bool           `json:"cost_known"`
}

// GenerateGachaPreview 生成结果：条目 + 期望价值/成本 + 建议售价 + 警告。
type GenerateGachaPreview struct {
	Entries         []GenerateGachaEntryView `json:"entries"`
	ExpectedValue   int64                    `json:"expected_value"`
	ExpectedCost    float64                  `json:"expected_cost"`
	CostKnownWeight float64                  `json:"cost_known_weight"`
	SuggestedPrice  int64                    `json:"suggested_price"`
	SuggestedTen    int64                    `json:"suggested_ten"`
	Warn            bool                     `json:"warn"`
	WarnReason      string                   `json:"warn_reason"`
}

// defaultRTP 默认客户期望回本率。
const defaultGachaRTP = 0.7

// mapValue 读取 map 默认值。
func mapValueInt(m map[string]int, key string, def int) int {
	if m != nil {
		if v, ok := m[key]; ok && v > 0 {
			return v
		}
	}
	return def
}

func mapValueInt64(m map[string]int64, key string, def int64) int64 {
	if m != nil {
		if v, ok := m[key]; ok && v > 0 {
			return v
		}
	}
	return def
}

// GenerateGachaEntries 生成卡池条目：apply=false 仅预览；apply=true 写入（可选替换 + 自动定价）。
func GenerateGachaEntries(poolId int, req *GenerateGachaEntryReq, apply bool) (*GenerateGachaPreview, error) {
	if req == nil || req.Group == "" || len(req.Models) == 0 {
		return nil, errors.New("分组与模型不能为空")
	}
	if err := DB.Where("id = ?", poolId).First(&GachaPool{}).Error; err != nil {
		return nil, errors.New("卡池不存在")
	}
	// 批量查模型档位
	names := req.Models
	var ms []Model
	if err := DB.Where("model_name IN ?", names).Find(&ms).Error; err != nil {
		return nil, err
	}
	ratingByName := map[string]string{}
	for _, m := range ms {
		ratingByName[m.ModelName] = m.Rating
		if ratingByName[m.ModelName] == "" {
			ratingByName[m.ModelName] = "N"
		}
	}

	rtp := req.TargetRTP
	if rtp <= 0 || rtp >= 1 {
		rtp = defaultGachaRTP
	}

	entries := make([]GachaCardEntry, 0, len(names))
	views := make([]GenerateGachaEntryView, 0, len(names))
	avgQuota := make([]float64, 0, len(names))
	totalWeight := 0
	for _, name := range names {
		rating := ratingByName[name]
		if rating == "" {
			rating = "N"
		}
		weight := mapValueInt(req.Weights, rating, gachaDefaultWeights[rating])
		qMin := mapValueInt64(req.QuotaMin, rating, gachaDefaultQuotaMin[rating])
		qMax := mapValueInt64(req.QuotaMax, rating, gachaDefaultQuotaMax[rating])
		if qMax < qMin {
			qMin, qMax = qMax, qMin
		}
		entry := GachaCardEntry{
			ModelName:  name,
			Group:      req.Group,
			Weight:     weight,
			Quota:      qMin,
			QuotaMin:   qMin,
			QuotaMax:   qMax,
			ExpireDays: req.ExpireDays,
		}
		entries = append(entries, entry)
		totalWeight += weight
		avgQuota = append(avgQuota, float64(qMin+qMax)/2)
		unit, known := EstimateModelUnitCost(name, req.Group, (qMin+qMax)/2)
		views = append(views, GenerateGachaEntryView{Entry: entry, Rating: rating, UnitCost: unit, CostKnown: known})
	}

	// 期望价值（区间均值）、期望成本（已知成本条目）
	ev := 0.0
	cost := 0.0
	knownWeight := 0
	for i, v := range views {
		p := float64(v.Entry.Weight) / float64(totalWeight)
		views[i].Probability = p
		ev += p * avgQuota[i]
		if v.CostKnown && v.UnitCost > 0 {
			cost += p * avgQuota[i] * v.UnitCost
			knownWeight += v.Entry.Weight
		}
	}

	preview := &GenerateGachaPreview{
		Entries:         views,
		ExpectedValue:   int64(ev),
		ExpectedCost:    cost,
		CostKnownWeight: float64(knownWeight) / float64(totalWeight),
		SuggestedPrice:  int64(ev / rtp),
		SuggestedTen:    int64(ev/rtp) * 9,
	}
	if knownWeight == 0 {
		preview.Warn = true
		preview.WarnReason = "所选分组渠道未启用成本核算，期望成本未知，自动定价仅供参考"
	} else if preview.SuggestedPrice > 0 && float64(preview.SuggestedPrice) <= cost {
		preview.Warn = true
		preview.WarnReason = "建议售价低于期望成本，继续抽卡将亏损"
	}

	if !apply {
		return preview, nil
	}

	// 校验并写入条目
	if req.Replace {
		if err := DB.Where("pool_id = ? AND "+commonGroupCol+" = ?", poolId, req.Group).Delete(&GachaCardEntry{}).Error; err != nil {
			return nil, err
		}
	}
	for _, e := range entries {
		if !ValidateGachaEntry(&e) {
			return nil, errors.New("模型或分组无效：" + e.ModelName + "（模型须存在且该分组有启用渠道与分组倍率）")
		}
		e.PoolId = poolId
		if err := DB.Create(&e).Error; err != nil {
			return nil, err
		}
	}

	if req.AutoPrice {
		ten := preview.SuggestedTen
		if ten <= 0 {
			ten = preview.SuggestedPrice * 9
		}
		if err := DB.Model(&GachaPool{}).Where("id = ?", poolId).Updates(map[string]interface{}{
			"price":       preview.SuggestedPrice,
			"ten_price":   ten,
			"updated_time": common.GetTimestamp(),
		}).Error; err != nil {
			return nil, err
		}
	}
	return preview, nil
}
