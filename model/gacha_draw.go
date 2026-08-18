package model

import "math/rand"

// DrawEntryByWeight 按权重随机抽取一个条目。
func DrawEntryByWeight(entries []GachaCardEntry) GachaCardEntry {
	total := 0
	for _, e := range entries {
		total += e.Weight
	}
	if total <= 0 {
		return entries[0]
	}
	r := rand.Float64() * float64(total)
	for _, e := range entries {
		r -= float64(e.Weight)
		if r < 0 {
			return e
		}
	}
	return entries[len(entries)-1]
}

// EntryRatingPriority 档位优先级（数字越大越稀有）。
var EntryRatingPriority = map[string]int{"N": 0, "R": 1, "SR": 2, "SSR": 3, "UR": 4}

// entryWithRating 携带档位的条目（用于抽卡判定）。
type entryWithRating struct {
	Entry  GachaCardEntry
	Rating string
}

func ratingAtLeast(rating, threshold string) bool {
	return EntryRatingPriority[rating] >= EntryRatingPriority[threshold]
}

// drawOne 单抽。保底触发时（pity >= PityMax-1）强制从 >= PityRarity 档抽取，
// PityUprate 概率升级为从 UR 档抽取；否则按权重抽取。
// 返回条目与"本次是否为保底触发"。
func drawOne(entries []entryWithRating, pool *GachaPool, pity int) (entryWithRating, bool) {
	if pool != nil && pool.PityEnabled && pool.PityMax > 0 && pity >= pool.PityMax-1 {
		high := filterByRating(entries, pool.PityRarity)
		if len(high) == 0 {
			return drawByWeight(entries), false
		}
		if pool.PityUprate > 0 && rand.Float64() < pool.PityUprate {
			ur := filterByRating(entries, "UR")
			if len(ur) > 0 {
				return drawByWeight(ur), true
			}
		}
		return drawByWeight(high), true
	}
	return drawByWeight(entries), false
}

// drawByWeight 按条目权重抽取（保留 rating 信息）。
func drawByWeight(entries []entryWithRating) entryWithRating {
	total := 0
	for _, e := range entries {
		total += e.Entry.Weight
	}
	r := rand.Float64() * float64(total)
	for _, e := range entries {
		r -= float64(e.Entry.Weight)
		if r < 0 {
			return e
		}
	}
	return entries[len(entries)-1]
}

func filterByRating(entries []entryWithRating, minRating string) []entryWithRating {
	var out []entryWithRating
	for _, e := range entries {
		if ratingAtLeast(e.Rating, minRating) {
			out = append(out, e)
		}
	}
	return out
}

// DrawCards 抽取 count 张卡。返回 (抽到条目列表, 抽后保底计数)。
// tenGuarantee：十连软保底档位（全部低于该档时最后一张替换为 >= 该档条目）。
func DrawCards(entries []entryWithRating, pool *GachaPool, pity int, count int) ([]entryWithRating, int) {
	if len(entries) == 0 {
		return nil, pity
	}
	cards := make([]entryWithRating, 0, count)
	for i := 0; i < count; i++ {
		e, _ := drawOne(entries, pool, pity)
		cards = append(cards, e)
		if pool != nil && pool.PityEnabled && pool.PityMax > 0 {
			if ratingAtLeast(e.Rating, pool.PityRarity) {
				pity = 0
			} else {
				pity++
			}
		}
	}
	if count >= 10 && pool != nil && pool.TenGuarantee != "" {
		cards = applyTenGuarantee(cards, entries, pool)
	}
	return cards, pity
}

// applyTenGuarantee 十连软保底：全部低于 TenGuarantee 档时，最后一张替换为 >= 该档的随机条目。
func applyTenGuarantee(cards []entryWithRating, entries []entryWithRating, pool *GachaPool) []entryWithRating {
	allBelow := true
	for _, c := range cards {
		if ratingAtLeast(c.Rating, pool.TenGuarantee) {
			allBelow = false
			break
		}
	}
	if allBelow {
		guaranteed := filterByRating(entries, pool.TenGuarantee)
		if len(guaranteed) > 0 {
			cards[len(cards)-1] = guaranteed[rand.Intn(len(guaranteed))]
		}
	}
	return cards
}
