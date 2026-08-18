package model

import "testing"

func TestComputePoolExpectedValueNoPity(t *testing.T) {
	pool := &GachaPool{Price: 100}
	entries := []GachaCardEntry{
		{Id: 1, Weight: 50, Quota: 100},
		{Id: 2, Weight: 50, Quota: 200},
	}
	ev, err := ComputePoolExpectedValue(pool, entries, 0)
	if err != nil {
		t.Fatal(err)
	}
	if ev != 150 { // 0.5*100 + 0.5*200
		t.Fatalf("ev = %d, want 150", ev)
	}
}

func TestComputePoolExpectedValueEmpty(t *testing.T) {
	ev, err := ComputePoolExpectedValue(&GachaPool{}, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if ev != 0 {
		t.Fatalf("ev = %d, want 0", ev)
	}
}

func TestApproximatePityEV(t *testing.T) {
	pool := &GachaPool{PityEnabled: true, PityMax: 10, PityRarity: "SSR"}
	entries := []GachaCardEntry{
		{Id: 1, Weight: 90, Quota: 10},  // N
		{Id: 2, Weight: 8, Quota: 100},  // SR
		{Id: 3, Weight: 2, Quota: 1000}, // SSR
	}
	ratings := map[int]string{1: "N", 2: "SR", 3: "SSR"}
	totalWeight := 100
	ev := approximatePityEV(pool, entries, totalWeight, ratings)
	base := 0.9*10 + 0.08*100 + 0.02*1000 // 无保底 = 37
	if ev < base {
		t.Fatalf("ev = %v, want >= %v (pity must raise expected value)", ev, base)
	}
}

func TestComputeEconomicsFromUnits(t *testing.T) {
	pool := &GachaPool{Price: 100}
	entries := []GachaCardEntry{
		{Id: 1, Weight: 50, Quota: 100},
		{Id: 2, Weight: 50, Quota: 200},
	}
	units := map[int]float64{1: 0.5, 2: 0.25}
	econ := computeEconomicsFromUnits(pool, entries, units)
	if econ.ExpectedCost != 50 { // 0.5*100*0.5 + 0.5*200*0.25 = 25+25
		t.Fatalf("expected_cost = %v, want 50", econ.ExpectedCost)
	}
	if econ.RTP != 1.5 { // ev=150 / price=100
		t.Fatalf("rtp = %v, want 1.5", econ.RTP)
	}
	if econ.ProfitEst != 50 {
		t.Fatalf("profit_est = %v, want 50", econ.ProfitEst)
	}
	if econ.Warn {
		t.Fatal("expected no warning when cost < price")
	}
}
