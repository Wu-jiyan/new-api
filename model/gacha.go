package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Gacha 抽卡实体
// ---------------------------------------------------------------------------

// GachaPool 卡池。
type GachaPool struct {
	Id           int            `json:"id" gorm:"primaryKey"`
	Name         string         `json:"name" gorm:"size:64;not null"`
	Description  string         `json:"description" gorm:"type:text"`
	Price        int64          `json:"price" gorm:"not null"`
	TenPrice     int64          `json:"ten_price" gorm:"default:0"`
	Enabled      bool           `json:"enabled" gorm:"default:true"`
	SortOrder    int            `json:"sort_order" gorm:"default:0"`
	PityEnabled  bool           `json:"pity_enabled" gorm:"default:false"`
	PityMax      int            `json:"pity_max" gorm:"default:0"`
	PityRarity   string         `json:"pity_rarity" gorm:"size:16"`
	PityUprate   float64        `json:"pity_uprate" gorm:"default:0"`
	TenGuarantee string         `json:"ten_guarantee" gorm:"size:16"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`
}

// GachaCardEntry 卡池条目（模型范围 + 分组 + 权重 + 额度 + 有效期）。
// Models 为逗号分隔的模型列表，发放后成为订阅的模型范围；Quota 为基准额度，
// QuotaMax > QuotaMin 时抽卡额度在 [QuotaMin, QuotaMax] 内随机。
type GachaCardEntry struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	PoolId     int    `json:"pool_id" gorm:"index;not null"`
	Models     string `json:"models" gorm:"type:text"`
	Group      string `json:"group" gorm:"size:64;not null"`
	Weight     int    `json:"weight" gorm:"not null"`
	Quota      int64  `json:"quota" gorm:"not null"`
	QuotaMin   int64  `json:"quota_min" gorm:"default:0"`
	QuotaMax   int64  `json:"quota_max" gorm:"default:0"`
	ExpireDays int    `json:"expire_days" gorm:"default:0"`
}

// EntryModelList 返回条目声明的模型范围，已去空白与去重。
func EntryModelList(e GachaCardEntry) []string {
	seen := make(map[string]struct{}, 2)
	models := make([]string, 0, 2)
	for _, name := range strings.Split(e.Models, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		models = append(models, name)
	}
	return models
}

// EntryGroup 返回条目绑定的分组（空 = 不限制分组）。
func EntryGroup(e GachaCardEntry) string {
	return strings.TrimSpace(e.Group)
}

// EntryDrawQuota 抽中条目的订阅额度：QuotaMax > QuotaMin 时区间随机，否则固定 Quota。
func EntryDrawQuota(e GachaCardEntry) int64 {
	if e.QuotaMax > e.QuotaMin {
		return e.QuotaMin + rand.Int63n(e.QuotaMax-e.QuotaMin+1)
	}
	return e.Quota
}

// EntryEndTime 条目发放的到期时间戳，ExpireDays <= 0 表示永不过期。
func EntryEndTime(e GachaCardEntry, now int64) int64 {
	if e.ExpireDays <= 0 {
		return GachaSubscriptionNeverExpires
	}
	return now + int64(e.ExpireDays)*86400
}

// GachaSubscriptionNeverExpires marks a grant that never expires. Subscription
// queries filter on end_time > now, so this only has to stay above every
// realistic timestamp.
const GachaSubscriptionNeverExpires = int64(1) << 40

// GachaSubscriptionSource marks subscriptions granted by a gacha pull, so they
// stay separable from purchased plans in the entitlement list and the profit
// aggregation.
const GachaSubscriptionSource = "gacha"

// GachaConsumeLogMarker is the consume-log field written when quota was spent
// from a gacha grant. Profit aggregation matches this LIKE pattern to keep the
// grant out of revenue: the money was already taken when the card pack was sold.
const GachaConsumeLogMarker = "%\"gacha_source\"%"

// GachaPullRecord 抽卡流水（pull_id 唯一索引做幂等）。
type GachaPullRecord struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	PullId      string `json:"pull_id" gorm:"size:64;uniqueIndex;not null"`
	UserId      int    `json:"user_id" gorm:"index;not null"`
	PoolId      int    `json:"pool_id" gorm:"index;not null"`
	Count       int    `json:"count" gorm:"not null"`
	Cost        int64  `json:"cost" gorm:"not null"`
	Cards       string `json:"cards" gorm:"type:text"`
	PityBefore  int    `json:"pity_before" gorm:"default:0"`
	PityAfter   int    `json:"pity_after" gorm:"default:0"`
	Status      int    `json:"status" gorm:"default:0"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
}

// PullCardResult 抽中的一份权益（用于接口返回与流水快照）。
type PullCardResult struct {
	SubscriptionId int      `json:"subscription_id"`
	Models         []string `json:"models"`
	Group          string   `json:"group"`
	Rarity         string   `json:"rating"`
	Quota          int64    `json:"quota"`
	ExpireDays     int      `json:"expire_days"`
	ExpiredAt      int64    `json:"expired_at"`
	MergeCount     int      `json:"merge_count"`
	Merged         bool     `json:"merged"`
}

// ErrInsufficientGachaBalance 钱包余额不足。
var ErrInsufficientGachaBalance = errors.New("gacha balance insufficient")

// ---------------------------------------------------------------------------
// 卡池 / 条目 / 卡 查询
// ---------------------------------------------------------------------------

// GetGachaPoolWithEntries 加载卡池与有效条目。
func GetGachaPoolWithEntries(poolId int) (*GachaPool, []GachaCardEntry, error) {
	var pool GachaPool
	if err := DB.Where("id = ?", poolId).First(&pool).Error; err != nil {
		return nil, nil, err
	}
	var entries []GachaCardEntry
	if err := DB.Where("pool_id = ?", poolId).Order("id ASC").Find(&entries).Error; err != nil {
		return nil, nil, err
	}
	return &pool, entries, nil
}

// ListEnabledGachaPools 启用中的卡池（按排序）。
func ListEnabledGachaPools() ([]GachaPool, error) {
	var pools []GachaPool
	err := DB.Where("enabled = ?", true).Order("sort_order ASC, id ASC").Find(&pools).Error
	return pools, err
}

// ListGachaPoolEntries 卡池条目。
func ListGachaPoolEntries(poolId int) ([]GachaCardEntry, error) {
	var entries []GachaCardEntry
	err := DB.Where("pool_id = ?", poolId).Order("id ASC").Find(&entries).Error
	return entries, err
}

// GetEntryRatings 批量查询条目模型的 rating 档位。条目可以声明多个模型，
// 取其中最高档作为该条目的稀有度。
func GetEntryRatings(entries []GachaCardEntry) (map[int]string, error) {
	out := make(map[int]string, len(entries))
	names := make([]string, 0, len(entries))
	seen := map[string]bool{}
	for _, e := range entries {
		out[e.Id] = ""
		for _, name := range EntryModelList(e) {
			if !seen[name] {
				seen[name] = true
				names = append(names, name)
			}
		}
	}
	if len(names) == 0 {
		return out, nil
	}
	var models []Model
	if err := DB.Where("model_name IN ?", names).Find(&models).Error; err != nil {
		return nil, err
	}
	ratingByName := map[string]string{}
	for _, m := range models {
		ratingByName[m.ModelName] = m.Rating
	}
	for _, e := range entries {
		best := ""
		for _, name := range EntryModelList(e) {
			if r := ratingByName[name]; EntryRatingPriority[r] > EntryRatingPriority[best] {
				best = r
			}
		}
		out[e.Id] = best
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// 抽卡权益发放 / 叠加
// ---------------------------------------------------------------------------

// grantGachaSubscriptionTx 发放或叠加一份抽卡权益，返回叠加后的订阅快照。
//
// 相同模型范围 + 相同分组的权益叠加到同一张订阅：额度相加、到期取更晚、
// 合并次数累加（驱动 ⭐/🌙/☀️ 徽标）。已耗尽或已过期的订阅不再叠加，避免把
// 已经用完的额度复活。
func grantGachaSubscriptionTx(tx *gorm.DB, userId int, entry GachaCardEntry, now int64) (*PullCardResult, error) {
	models := EntryModelList(entry)
	if len(models) == 0 {
		return nil, fmt.Errorf("gacha entry %d declares no model", entry.Id)
	}
	groups := []string{}
	if group := EntryGroup(entry); group != "" {
		groups = []string{group}
	}
	quota := EntryDrawQuota(entry)
	endTime := EntryEndTime(entry, now)

	var candidates []UserSubscription
	if err := lockForUpdate(tx).
		Where("user_id = ? AND source = ? AND status = ? AND end_time > ?",
			userId, GachaSubscriptionSource, "active", now).
		Find(&candidates).Error; err != nil {
		return nil, err
	}
	// Ranges are stored sorted, so an equal slice means an equal entitlement.
	for i := range candidates {
		existing := candidates[i]
		if !slices.Equal(existing.UsableModels, models) || !slices.Equal(existing.UsableGroups, groups) {
			continue
		}
		if existing.AmountTotal > 0 && existing.AmountUsed >= existing.AmountTotal {
			continue
		}
		mergedEnd := existing.EndTime
		if endTime > mergedEnd {
			mergedEnd = endTime
		}
		mergeCount := existing.MergeCount + 1
		if err := tx.Model(&UserSubscription{}).Where("id = ?", existing.Id).Updates(map[string]interface{}{
			"amount_total": gorm.Expr("amount_total + ?", quota),
			"end_time":     mergedEnd,
			"merge_count":  mergeCount,
			"updated_at":   now,
		}).Error; err != nil {
			return nil, err
		}
		return &PullCardResult{
			SubscriptionId: existing.Id,
			Models:         models,
			Group:          EntryGroup(entry),
			Quota:          quota,
			ExpireDays:     entry.ExpireDays,
			ExpiredAt:      mergedEnd,
			MergeCount:     mergeCount,
			Merged:         true,
		}, nil
	}

	granted := &UserSubscription{
		UserId:              userId,
		PlanId:              0,
		AmountTotal:         quota,
		StartTime:           now,
		EndTime:             endTime,
		Status:              "active",
		Source:              GachaSubscriptionSource,
		UsableModels:        models,
		UsableGroups:        groups,
		MergeCount:          1,
		AllowWalletOverflow: true,
	}
	if err := tx.Create(granted).Error; err != nil {
		return nil, err
	}
	return &PullCardResult{
		SubscriptionId: granted.Id,
		Models:         models,
		Group:          EntryGroup(entry),
		Quota:          quota,
		ExpireDays:     entry.ExpireDays,
		ExpiredAt:      endTime,
		MergeCount:     1,
	}, nil
}

// ListUserGachaSubscriptions 列出用户的抽卡权益（叠加后的订阅）。
func ListUserGachaSubscriptions(userId int, status string, limit int) ([]UserSubscription, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	query := DB.Where("user_id = ? AND source = ?", userId, GachaSubscriptionSource)
	if strings.TrimSpace(status) != "" {
		query = query.Where("status = ?", status)
	}
	if limit <= 0 {
		limit = 100
	}
	var subs []UserSubscription
	if err := query.Order("end_time ASC, id ASC").Limit(limit).Find(&subs).Error; err != nil {
		return nil, err
	}
	return subs, nil
}

// ---------------------------------------------------------------------------
// 保底计数（users.gacha_pity JSON）
// ---------------------------------------------------------------------------

// GetUserGachaPity 读取用户在某池的保底计数。
func GetUserGachaPity(userId, poolId int) (int, error) {
	var user User
	if err := DB.Where("id = ?", userId).First(&user).Error; err != nil {
		return 0, err
	}
	if user.GachaPity == "" {
		return 0, nil
	}
	var m map[string]int
	if err := json.Unmarshal([]byte(user.GachaPity), &m); err != nil {
		return 0, nil
	}
	return m[strconv.Itoa(poolId)], nil
}

// ---------------------------------------------------------------------------
// 抽卡主事务
// ---------------------------------------------------------------------------

// GachaPullResult 一次抽卡的完整结果。
type GachaPullResult struct {
	PullRecordId int              `json:"pull_record_id"`
	Cards        []PullCardResult `json:"cards"`
	PityBefore   int              `json:"pity_before"`
	PityAfter    int              `json:"pity_after"`
}

// PullGachaCards 抽卡主流程：
// 1) 幂等检查（pull_id 已存在则直接返回历史结果，不重复扣费）
// 2) 主库事务：锁用户行 -> 校验余额 -> 抽卡 -> 发卡 -> 更新保底 -> 扣费 -> 写流水
// 3) 事务提交后写 LogTypeGacha 日志（日志库可能独立，失败不阻塞抽卡）
func PullGachaCards(userId int, pool *GachaPool, entries []GachaCardEntry, count int, cost int64, pullId string) (*GachaPullResult, error) {
	// 幂等：命中直接返回
	var existing GachaPullRecord
	if err := DB.Where("pull_id = ?", pullId).First(&existing).Error; err == nil {
		var cards []PullCardResult
		_ = json.Unmarshal([]byte(existing.Cards), &cards)
		return &GachaPullResult{
			PullRecordId: existing.Id,
			Cards:        cards,
			PityBefore:   existing.PityBefore,
			PityAfter:    existing.PityAfter,
		}, nil
	}

	ratings, err := GetEntryRatings(entries)
	if err != nil {
		return nil, err
	}
	ewr := make([]entryWithRating, 0, len(entries))
	for _, e := range entries {
		ewr = append(ewr, entryWithRating{Entry: e, Rating: ratings[e.Id]})
	}

	var result *GachaPullResult
	var username string
	err = DB.Transaction(func(tx *gorm.DB) error {
		// 锁用户行（保底计数 + 余额扣减串行化）
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		username = user.Username
		if int64(user.Quota) < cost {
			return ErrInsufficientGachaBalance
		}

		pity := 0
		if user.GachaPity != "" {
			var m map[string]int
			_ = json.Unmarshal([]byte(user.GachaPity), &m)
			pity = m[strconv.Itoa(pool.Id)]
		}

		cards, pityAfter := DrawCards(ewr, pool, pity, count)

		now := common.GetTimestamp()
		pullCards := make([]PullCardResult, 0, len(cards))
		for _, c := range cards {
			// 同模型范围 + 同分组的权益叠加到同一张订阅（额度相加、到期取更晚）
			granted, err := grantGachaSubscriptionTx(tx, userId, c.Entry, now)
			if err != nil {
				return err
			}
			granted.Rarity = c.Rating
			pullCards = append(pullCards, *granted)
		}

		// 更新保底计数
		pityMap := map[string]int{strconv.Itoa(pool.Id): pityAfter}
		if user.GachaPity != "" {
			var m map[string]int
			if err := json.Unmarshal([]byte(user.GachaPity), &m); err == nil {
				m[strconv.Itoa(pool.Id)] = pityAfter
				pityMap = m
			}
		}
		pityJSON, _ := json.Marshal(pityMap)
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("gacha_pity", string(pityJSON)).Error; err != nil {
			return err
		}

		// 扣费
		if err := tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota - ?", cost)).Error; err != nil {
			return err
		}

		cardsJSON, _ := json.Marshal(pullCards)
		record := GachaPullRecord{
			PullId:      pullId,
			UserId:      userId,
			PoolId:      pool.Id,
			Count:       count,
			Cost:        cost,
			Cards:       string(cardsJSON),
			PityBefore:  pity,
			PityAfter:   pityAfter,
			Status:      0,
			CreatedTime: now,
		}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}

		result = &GachaPullResult{
			PullRecordId: record.Id,
			Cards:        pullCards,
			PityBefore:   pity,
			PityAfter:    pityAfter,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 日志库可能独立于主库（如 ClickHouse），事务外写日志，失败仅记录不阻塞。
	content := "gacha pull: " + pool.Name
	other := `{"gacha_pull_id":"` + pullId + `","gacha_pool_id":` + strconv.Itoa(pool.Id) + `}`
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeGacha,
		Content:   content,
		Quota:     int(cost),
		Other:     other,
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record gacha log: " + err.Error())
	}
	return result, nil
}
