package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// ValidateGachaEntry 校验条目：模型存在、分组有倍率、模型在该分组有启用渠道。
func ValidateGachaEntry(entry *GachaCardEntry) bool {
	if entry == nil {
		return false
	}
	var m Model
	if err := DB.Where("model_name = ? AND deleted_at IS NULL", entry.ModelName).First(&m).Error; err != nil {
		return false
	}
	if !ratio_setting.ContainsGroupRatio(entry.Group) {
		return false
	}
	owners, err := GetPreferredModelOwnerChannelTypes([]string{entry.ModelName}, []string{entry.Group})
	if err != nil || len(owners) == 0 {
		return false
	}
	return true
}

// ComputePoolExpectedValue 计算卡池期望价值（quota）。
// 期望价值 = Σ(条目概率 × 条目额度)。未启用保底时即为纯权重期望；
// 启用保底时按保守近似：保底档及以上有效权重放大到至少 1/PityMax，其余按原比例。
// userId 预留（后续可按用户分组折扣细化展示）。
func ComputePoolExpectedValue(pool *GachaPool, entries []GachaCardEntry, userId int) (int64, error) {
	if len(entries) == 0 {
		return 0, nil
	}
	totalWeight := 0
	for _, e := range entries {
		totalWeight += e.Weight
	}
	if totalWeight <= 0 {
		return 0, nil
	}
	ev := 0.0
	if pool.PityEnabled && pool.PityMax > 0 && pool.PityRarity != "" {
		ratings, err := GetEntryRatings(entries)
		if err != nil {
			return 0, err
		}
		ev = approximatePityEV(pool, entries, totalWeight, ratings)
	} else {
		for _, e := range entries {
			p := float64(e.Weight) / float64(totalWeight)
			ev += p * float64(e.Quota)
		}
	}
	return int64(ev), nil
}

// approximatePityEV 保底期望近似：按档位聚合权重，把高档权重放大到至少 totalWeight/PityMax。
func approximatePityEV(pool *GachaPool, entries []GachaCardEntry, totalWeight int, ratings map[int]string) float64 {
	type bucket struct {
		weight int
		quota  float64 // 该档加权额度总和
	}
	buckets := map[string]*bucket{}
	for _, e := range entries {
		r := ratings[e.Id]
		if r == "" {
			r = "N"
		}
		b := buckets[r]
		if b == nil {
			b = &bucket{}
			buckets[r] = b
		}
		b.weight += e.Weight
		b.quota += float64(e.Weight) * float64(e.Quota)
	}
	// 高档（>= PityRarity）总权重
	highWeight := 0
	for r, b := range buckets {
		if EntryRatingPriority[r] >= EntryRatingPriority[pool.PityRarity] {
			highWeight += b.weight
		}
	}
	guaranteedMin := float64(totalWeight) / float64(pool.PityMax)
	scale := 1.0
	if highWeight > 0 && float64(highWeight) < guaranteedMin {
		scale = guaranteedMin / float64(highWeight)
	}
	ev := 0.0
	for r, b := range buckets {
		fw := float64(b.weight)
		if EntryRatingPriority[r] >= EntryRatingPriority[pool.PityRarity] {
			fw *= scale
		}
		avg := b.quota / float64(b.weight)
		ev += (fw / float64(totalWeight)) * avg
	}
	return ev
}

// PoolEconomics 卡池经济测算结果。
type PoolEconomics struct {
	RTP               float64 `json:"rtp"`
	ExpectedCost      float64 `json:"expected_cost"`
	ProfitEst         float64 `json:"profit_est"`
	Warn              bool    `json:"warn"`
	WarnReason        string  `json:"warn_reason"`
	UnknownCostWeight float64 `json:"unknown_cost_weight"`
}

// ComputePoolEconomics 计算卡池经济指标：期望成本 = Σ(p_i × quota_i × unit_cost_i)。
// unit_cost 来自启用成本核算的渠道对该模型的单位成本估算；无成本数据的条目记录权重占比。
func ComputePoolEconomics(pool *GachaPool, entries []GachaCardEntry) (*PoolEconomics, error) {
	units := make(map[int]float64, len(entries))
	unknown := 0
	totalWeight := 0
	for _, e := range entries {
		totalWeight += e.Weight
		unit, known := EstimateModelUnitCost(e.ModelName, e.Group, e.Quota)
		units[e.Id] = unit
		if !known {
			unknown += e.Weight
		}
	}
	econ := computeEconomicsFromUnits(pool, entries, units)
	econ.UnknownCostWeight = 0
	if totalWeight > 0 {
		econ.UnknownCostWeight = float64(unknown) / float64(totalWeight)
	}
	if unknown > 0 {
		econ.Warn = true
		econ.WarnReason = "存在成本未知的条目，盈利测算不完整"
	}
	return econ, nil
}

func computeEconomicsFromUnits(pool *GachaPool, entries []GachaCardEntry, units map[int]float64) *PoolEconomics {
	econ := &PoolEconomics{}
	if len(entries) == 0 {
		econ.Warn = true
		econ.WarnReason = "卡池没有条目"
		return econ
	}
	totalWeight := 0
	for _, e := range entries {
		totalWeight += e.Weight
	}
	if totalWeight <= 0 {
		econ.Warn = true
		econ.WarnReason = "卡池条目权重无效"
		return econ
	}
	ev, _ := ComputePoolExpectedValue(pool, entries, 0)
	expectedCost := 0.0
	unknown := 0
	for _, e := range entries {
		unit, ok := units[e.Id]
		p := float64(e.Weight) / float64(totalWeight)
		if ok && unit > 0 {
			expectedCost += p * float64(e.Quota) * unit
		} else {
			unknown += e.Weight
		}
	}
	price := float64(pool.Price)
	if price > 0 {
		econ.RTP = float64(ev) / price
		econ.ProfitEst = price - expectedCost
	}
	econ.ExpectedCost = expectedCost
	if unknown > 0 {
		econ.Warn = true
		econ.WarnReason = "存在成本未知的条目，盈利测算不完整"
		econ.UnknownCostWeight = float64(unknown) / float64(totalWeight)
	} else if expectedCost >= price {
		econ.Warn = true
		econ.WarnReason = "期望成本 ≥ 价格，该卡池可能亏损"
	}
	return econ
}

// EstimateModelUnitCost 估算模型单位成本：每 1 quota 卡额度对应的渠道成本比率。
// 取该模型在该分组启用成本核算渠道中的最低单位成本；无成本数据时返回 known=false。
// 固定模式：每次调用固定成本按条目额度摊薄；折扣模式：成本 = quota ÷ 分组倍率 × 折扣。
func EstimateModelUnitCost(modelName, group string, cardQuota int64) (unitCost float64, known bool) {
	if modelName == "" {
		return 0, false
	}
	var channelIds []int
	if err := DB.Table("abilities").
		Where("model = ? AND enabled = ?", modelName, true).
		Where(commonGroupCol+" = ?", group).
		Distinct().Pluck("channel_id", &channelIds).Error; err != nil || len(channelIds) == 0 {
		return 0, false
	}
	best := -1.0
	for _, cid := range channelIds {
		var ch Channel
		if err := DB.First(&ch, cid).Error; err != nil || ch.Status != common.ChannelStatusEnabled {
			continue
		}
		settings := ch.GetCostSettings()
		if !settings.Enabled {
			continue
		}
		unit := 0.0
		switch settings.Mode {
		case dto.ChannelCostModeFixed:
			if settings.FixedPrice <= 0 {
				continue
			}
			if cardQuota <= 0 {
				cardQuota = 1
			}
			unit = settings.FixedPrice * common.QuotaPerUnit / float64(cardQuota)
		case dto.ChannelCostModeDiscount:
			if settings.Discount <= 0 {
				continue
			}
			ratio := ratio_setting.GetGroupRatio(group)
			if ratio <= 0 {
				ratio = 1
			}
			unit = settings.Discount / ratio
		default:
			continue
		}
		if unit > 0 && (best < 0 || unit < best) {
			best = unit
		}
	}
	if best < 0 {
		return 0, false
	}
	return best, true
}
