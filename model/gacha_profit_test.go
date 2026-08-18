package model

import "testing"

func insertGachaCardConsumeProfitLog(t *testing.T, createdAt int64, quota int, costQuota float64, channelID int, modelName string) {
	t.Helper()
	log := &Log{
		UserId:    1,
		Username:  "test",
		CreatedAt: createdAt,
		Type:      LogTypeConsume,
		ModelName: modelName,
		Quota:     quota,
		CostQuota: costQuota,
		ChannelId: channelID,
		Other:     `{"gacha_card_id":1,"channel_cost":{"cost":1}}`,
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		t.Fatalf("insert gacha card consume log: %v", err)
	}
}

func insertGachaRevenueProfitLog(t *testing.T, createdAt int64, quota int) {
	t.Helper()
	log := &Log{
		UserId:    1,
		Username:  "test",
		CreatedAt: createdAt,
		Type:      LogTypeGacha,
		Quota:     quota,
		Content:   "gacha pull",
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		t.Fatalf("insert gacha revenue log: %v", err)
	}
}

func TestSumChannelProfitGacha(t *testing.T) {
	setupLogDBForProfitTest(t)

	// 普通调用收入 + gacha 卡消费（只计成本）+ 抽卡收入（计入营收）
	insertCostSnapshotProfitLog(t, 1000, 100, 60, 10, "gpt-4o")
	insertGachaCardConsumeProfitLog(t, 1001, 500, 200, 10, "gpt-4o")
	insertGachaRevenueProfitLog(t, 1002, 1000)

	summary, _, _, _, err := SumChannelProfit(0, 0, 0, "", 0)
	if err != nil {
		t.Fatalf("SumChannelProfit: %v", err)
	}
	// Revenue = 100(普通) + 1000(抽卡收入)；Cost = 60(普通成本) + 200(卡消费成本)；Count = 1 + 1
	if summary.Revenue != 1100 || summary.Cost != 260 || summary.Count != 2 {
		t.Fatalf("summary = %+v, want revenue=1100 cost=260 count=2", summary)
	}
	if summary.GachaRevenue != 1000 {
		t.Fatalf("gacha_revenue = %v, want 1000", summary.GachaRevenue)
	}
	if summary.GachaConsumeCost != 200 {
		t.Fatalf("gacha_consume_cost = %v, want 200", summary.GachaConsumeCost)
	}
}
