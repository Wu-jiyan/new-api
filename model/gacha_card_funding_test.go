package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestConsumeAndRefundGachaCardQuota(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&UserGachaCard{}, &GachaCardRefund{}))
	card := UserGachaCard{
		UserId:      910001,
		ModelName:   "test-model",
		Group:       "default",
		TotalQuota:  100,
		RemainQuota: 100,
		Status:      0,
		ExpiredTime: -1,
		CreatedTime: common.GetTimestamp(),
		UpdatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(&card).Error)
	t.Cleanup(func() { DB.Unscoped().Delete(&card); DB.Where("card_id = ?", card.Id).Delete(&GachaCardRefund{}) })

	require.NoError(t, ConsumeGachaCardQuota(card.Id, 100))
	var used UserGachaCard
	require.NoError(t, DB.First(&used, card.Id).Error)
	require.Equal(t, int64(0), used.RemainQuota)
	require.Equal(t, 1, used.Status)

	require.NoError(t, RefundGachaCardPreConsume("test-request-910001", card.Id, 40))
	require.NoError(t, RefundGachaCardPreConsume("test-request-910001", card.Id, 40))
	require.NoError(t, DB.First(&used, card.Id).Error)
	require.Equal(t, int64(40), used.RemainQuota)
	require.Equal(t, 0, used.Status)
}
