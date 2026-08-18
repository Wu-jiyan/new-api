package model

import "testing"

func TestDrawEntryByWeight(t *testing.T) {
	entries := []GachaCardEntry{
		{Id: 1, Weight: 70},
		{Id: 2, Weight: 25},
		{Id: 3, Weight: 5},
	}
	counts := map[int]int{}
	for i := 0; i < 100000; i++ {
		e := DrawEntryByWeight(entries)
		counts[e.Id]++
	}
	if counts[1] < 68000 || counts[1] > 72000 {
		t.Fatalf("id=1 freq = %d, want ~70000", counts[1])
	}
	if counts[3] < 4000 || counts[3] > 6000 {
		t.Fatalf("id=3 freq = %d, want ~5000", counts[3])
	}
}

func TestPityLogic(t *testing.T) {
	pool := &GachaPool{PityEnabled: true, PityMax: 3, PityRarity: "SSR", PityUprate: 0}
	entries := []entryWithRating{
		{Entry: GachaCardEntry{Id: 1, Weight: 1}, Rating: "N"},
		{Entry: GachaCardEntry{Id: 2, Weight: 1}, Rating: "SSR"},
	}
	// pity = PityMax-1 时强制高档次
	e, isPity := drawOne(entries, pool, 2)
	if !isPity || !ratingAtLeast(e.Rating, "SSR") {
		t.Fatalf("pity draw got rating=%s pity=%v, want SSR+", e.Rating, isPity)
	}
	// 连续单抽 3 次必触发保底（第 3 抽出 SSR 后计数清零，循环可继续）
	pity := 0
	seenGuaranteed := false
	for i := 0; i < 100; i++ {
		cards, p := DrawCards(entries, pool, pity, 1)
		pity = p
		if ratingAtLeast(cards[0].Rating, "SSR") && i%3 == 2 {
			seenGuaranteed = true
		}
	}
	if !seenGuaranteed {
		t.Fatal("expected guaranteed SSR on 3rd draw in each 3-cycle")
	}
}

func TestTenGuarantee(t *testing.T) {
	pool := &GachaPool{TenGuarantee: "SR"}
	entries := []entryWithRating{
		{Entry: GachaCardEntry{Id: 1, Weight: 1}, Rating: "N"},
		{Entry: GachaCardEntry{Id: 2, Weight: 1}, Rating: "SR"},
	}
	// 全 N 十连：最后一张应被替换为 SR+
	allN := make([]entryWithRating, 10)
	for i := range allN {
		allN[i] = entryWithRating{Entry: GachaCardEntry{Id: 1}, Rating: "N"}
	}
	cards := applyTenGuarantee(allN, entries, pool)
	if !ratingAtLeast(cards[len(cards)-1].Rating, "SR") {
		t.Fatalf("all-low ten-pull should replace last card with SR+, got %s", cards[len(cards)-1].Rating)
	}
	// 已含 SR 的十连：不做替换（最后一张保持原样）
	withSR := append(append([]entryWithRating{}, allN[:9]...), entryWithRating{Entry: GachaCardEntry{Id: 2}, Rating: "SR"})
	cards = applyTenGuarantee(withSR, entries, pool)
	if cards[len(cards)-1].Rating != "SR" {
		t.Fatalf("ten-pull containing SR must not replace last card, got %s", cards[len(cards)-1].Rating)
	}
}
