package model

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
