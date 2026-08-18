package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEntryDrawQuota(t *testing.T) {
	// 固定额度
	fixed := GachaCardEntry{Quota: 500}
	for i := 0; i < 50; i++ {
		assert.Equal(t, int64(500), EntryDrawQuota(fixed))
	}
	// 区间随机：必须落在 [min, max] 且存在差异
	random := GachaCardEntry{Quota: 0, QuotaMin: 100, QuotaMax: 110}
	seen := map[int64]bool{}
	for i := 0; i < 200; i++ {
		v := EntryDrawQuota(random)
		assert.GreaterOrEqual(t, v, int64(100))
		assert.LessOrEqual(t, v, int64(110))
		seen[v] = true
	}
	assert.Greater(t, len(seen), 1, "额度应在区间内随机分布")
}

func TestPullGachaCardsMerge(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&GachaPool{}, &GachaCardEntry{}, &UserGachaCard{}, &GachaPullRecord{}, &Model{}, &User{}))

	require.NoError(t, DB.Create(&Model{ModelName: "merge-model", Status: 1, Rating: "SR"}).Error)
	t.Cleanup(func() { DB.Unscoped().Where("model_name = ?", "merge-model").Delete(&Model{}) })

	pool := GachaPool{Name: "merge-pool", Price: 100, Enabled: true}
	require.NoError(t, DB.Create(&pool).Error)
	t.Cleanup(func() {
		DB.Where("pool_id = ?", pool.Id).Delete(&GachaCardEntry{})
		DB.Unscoped().Delete(&pool)
	})

	entry := GachaCardEntry{PoolId: pool.Id, ModelName: "merge-model", Group: "default", Weight: 1, Quota: 100, QuotaMin: 90, QuotaMax: 110, ExpireDays: 30}
	require.NoError(t, DB.Create(&entry).Error)

	user := User{Username: "merge-user", Quota: 100000, Status: 1, Role: 1}
	require.NoError(t, DB.Create(&user).Error)
	t.Cleanup(func() {
		DB.Unscoped().Delete(&user)
		DB.Where("user_id = ?", user.Id).Delete(&UserGachaCard{})
		DB.Where("user_id = ?", user.Id).Delete(&GachaPullRecord{})
		DB.Where("user_id = ?", user.Id).Delete(&Log{})
	})

	entries := []GachaCardEntry{entry}
	res1, err := PullGachaCards(user.Id, &pool, entries, 1, 100, "merge-pull-1")
	require.NoError(t, err)
	require.Equal(t, 1, res1.Cards[0].MergeCount)

	res2, err := PullGachaCards(user.Id, &pool, entries, 1, 100, "merge-pull-2")
	require.NoError(t, err)
	require.Equal(t, 2, res2.Cards[0].MergeCount)
	require.Equal(t, res1.Cards[0].CardId, res2.Cards[0].CardId, "重复卡应合并到同一张")

	var cards []UserGachaCard
	require.NoError(t, DB.Where("user_id = ?", user.Id).Find(&cards).Error)
	require.Len(t, cards, 1, "同模型应只有一张卡")
	require.Equal(t, 2, cards[0].MergeCount)
	require.GreaterOrEqual(t, cards[0].TotalQuota, int64(180))
	require.LessOrEqual(t, cards[0].TotalQuota, int64(220))
}

func TestGenerateGachaEntriesPreview(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&GachaPool{}, &GachaCardEntry{}, &Model{}, &Channel{}, &Ability{}))

	// 配置分组倍率与渠道，使 ValidateGachaEntry 通过
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	ch := Channel{Type: 1, Key: "sk-test", Status: common.ChannelStatusEnabled, Name: "gen-ch", Models: "g-model-sr,g-model-ur", Group: "default"}
	require.NoError(t, DB.Create(&ch).Error)
	t.Cleanup(func() { DB.Unscoped().Delete(&ch) })
	for _, m := range []string{"g-model-sr", "g-model-ur"} {
		require.NoError(t, DB.Create(&Ability{Group: "default", Model: m, ChannelId: ch.Id, Enabled: true}).Error)
		t.Cleanup(func() { DB.Where("channel_id = ?", ch.Id).Delete(&Ability{}) })
	}

	require.NoError(t, DB.Create(&Model{ModelName: "g-model-sr", Status: 1, Rating: "SR"}).Error)
	require.NoError(t, DB.Create(&Model{ModelName: "g-model-ur", Status: 1, Rating: "UR"}).Error)
	t.Cleanup(func() {
		DB.Unscoped().Where("model_name IN ?", []string{"g-model-sr", "g-model-ur"}).Delete(&Model{})
	})

	pool := GachaPool{Name: "gen-pool", Price: 100, Enabled: true}
	require.NoError(t, DB.Create(&pool).Error)
	t.Cleanup(func() {
		DB.Where("pool_id = ?", pool.Id).Delete(&GachaCardEntry{})
		DB.Unscoped().Delete(&pool)
	})

	req := &GenerateGachaEntryReq{
		Group:     "default",
		Models:    []string{"g-model-sr", "g-model-ur"},
		ExpireDays: 30,
	}
	preview, err := GenerateGachaEntries(pool.Id, req, false)
	require.NoError(t, err)
	require.Len(t, preview.Entries, 2)
	// 档位默认权重：SR=15，UR=1，总权重 16
	total := 0
	for _, v := range preview.Entries {
		switch v.Rating {
		case "SR":
			assert.Equal(t, 15, v.Entry.Weight)
		case "UR":
			assert.Equal(t, 1, v.Entry.Weight)
		}
		total += v.Entry.Weight
		// 额度区间已按默认模板填充
		assert.Greater(t, v.Entry.QuotaMax, v.Entry.QuotaMin)
	}
	assert.Equal(t, 16, total)
	assert.Greater(t, preview.SuggestedPrice, int64(0), "应按期望价值建议售价")
	// 期望价值 = (15/16)*avg(SR) + (1/16)*avg(UR)，建议价 = EV / 0.7
	ev := (15.0/16)*float64(1500+3000)/2 + (1.0/16)*float64(8000+20000)/2
	assert.Equal(t, int64(ev/0.7), preview.SuggestedPrice)
	assert.True(t, preview.Warn, "无成本数据时应提示")

	// apply=true 应写入条目
	preview2, err := GenerateGachaEntries(pool.Id, req, true)
	require.NoError(t, err)
	require.Len(t, preview2.Entries, 2)
	var entries []GachaCardEntry
	require.NoError(t, DB.Where("pool_id = ?", pool.Id).Find(&entries).Error)
	require.Len(t, entries, 2)

	// replace=true 再次生成不应残留旧条目
	req2 := &GenerateGachaEntryReq{Group: "default", Models: []string{"g-model-ur"}, Replace: true, ExpireDays: 0}
	_, err = GenerateGachaEntries(pool.Id, req2, true)
	require.NoError(t, err)
	var entries2 []GachaCardEntry
	require.NoError(t, DB.Where("pool_id = ?", pool.Id).Find(&entries2).Error)
	require.Len(t, entries2, 1)

	// 时间戳辅助
	_ = common.GetTimestamp
}
