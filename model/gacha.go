package model

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

// GachaCardEntry 卡池条目（模型 + 分组 + 权重 + 额度 + 过期天数）。
type GachaCardEntry struct {
	Id         int    `json:"id" gorm:"primaryKey"`
	PoolId     int    `json:"pool_id" gorm:"index;not null"`
	ModelName  string `json:"model_name" gorm:"size:128;not null"`
	Group      string `json:"group" gorm:"size:64;not null"`
	Weight     int    `json:"weight" gorm:"not null"`
	Quota      int64  `json:"quota" gorm:"not null"`
	ExpireDays int    `json:"expire_days" gorm:"default:0"`
}

// UserGachaCard 用户卡库。Status: 0 可用 / 1 已用完 / 2 已过期 / 3 已禁用。
type UserGachaCard struct {
	Id           int    `json:"id" gorm:"primaryKey"`
	UserId       int    `json:"user_id" gorm:"index;not null"`
	PoolId       int    `json:"pool_id" gorm:"index"`
	PullRecordId int    `json:"pull_record_id" gorm:"index"`
	ModelName    string `json:"model_name" gorm:"size:128;not null;index"`
	Group        string `json:"group" gorm:"size:64;not null"`
	TotalQuota   int64  `json:"total_quota" gorm:"not null"`
	RemainQuota  int64  `json:"remain_quota" gorm:"not null"`
	Status       int    `json:"status" gorm:"default:0"`
	ExpiredTime  int64  `json:"expired_time" gorm:"bigint"` // -1 永久
	CreatedTime  int64  `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64  `json:"updated_time" gorm:"bigint"`
}

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

// GachaCardRefund 卡预扣退款幂等记录。
type GachaCardRefund struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	RequestId   string `json:"request_id" gorm:"size:64;uniqueIndex;not null"`
	CardId      int    `json:"card_id" gorm:"index;not null"`
	Amount      int64  `json:"amount" gorm:"not null"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
}

// PullCardResult 抽卡结果单卡（用于接口返回与流水快照）。
type PullCardResult struct {
	CardId     int    `json:"card_id"`
	ModelName  string `json:"model_name"`
	Group      string `json:"group"`
	Rarity     string `json:"rarity"`
	Quota      int64  `json:"quota"`
	ExpireDays int    `json:"expire_days"`
	ExpiredAt  int64  `json:"expired_at"`
}

// ErrInsufficientGachaBalance 钱包余额不足。
var ErrInsufficientGachaBalance = errors.New("gacha balance insufficient")

// ErrInsufficientGachaCardQuota 卡额度不足。
var ErrInsufficientGachaCardQuota = errors.New("gacha card quota insufficient")

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

// GetEntryRatings 批量查询条目模型的 rating 档位。
func GetEntryRatings(entries []GachaCardEntry) (map[int]string, error) {
	out := make(map[int]string, len(entries))
	names := make([]string, 0, len(entries))
	seen := map[string]bool{}
	for _, e := range entries {
		out[e.Id] = ""
		if !seen[e.ModelName] {
			seen[e.ModelName] = true
			names = append(names, e.ModelName)
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
		out[e.Id] = ratingByName[e.ModelName]
	}
	return out, nil
}

// GetGachaCardByUser 获取用户的卡（校验归属）。
func GetGachaCardByUser(cardId, userId int) (*UserGachaCard, error) {
	var card UserGachaCard
	err := DB.Where("id = ? AND user_id = ?", cardId, userId).First(&card).Error
	if err != nil {
		return nil, err
	}
	return &card, nil
}

// LockGachaCardForUpdate 锁卡行并返回（供预扣用）。
func LockGachaCardForUpdate(cardId int) (*UserGachaCard, error) {
	var card UserGachaCard
	if err := DB.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", cardId).First(&card).Error; err != nil {
		return nil, err
	}
	return &card, nil
}

// ---------------------------------------------------------------------------
// 卡额度扣减 / 退还 / 过期
// ---------------------------------------------------------------------------

// ConsumeGachaCardQuota 扣减卡额度，额度耗尽置为已用完。
func ConsumeGachaCardQuota(cardId int, amount int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var card UserGachaCard
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", cardId).First(&card).Error; err != nil {
			return err
		}
		if card.Status == 3 {
			return errors.New("gacha card disabled")
		}
		if card.ExpiredTime > 0 && card.ExpiredTime < common.GetTimestamp() {
			return errors.New("gacha card expired")
		}
		if card.RemainQuota < amount {
			return ErrInsufficientGachaCardQuota
		}
		remain := card.RemainQuota - amount
		status := card.Status
		if remain <= 0 {
			remain = 0
			status = 1
		}
		return tx.Model(&UserGachaCard{}).Where("id = ?", cardId).
			Updates(map[string]interface{}{
				"remain_quota": remain,
				"status":       status,
				"updated_time": common.GetTimestamp(),
			}).Error
	})
}

// RefundGachaCardQuota 退还卡额度（已用完的卡恢复为可用）。
func RefundGachaCardQuota(cardId int, amount int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		return refundGachaCardQuotaTx(tx, cardId, amount)
	})
}

func refundGachaCardQuotaTx(tx *gorm.DB, cardId int, amount int64) error {
	var card UserGachaCard
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", cardId).First(&card).Error; err != nil {
		return err
	}
	if card.Status == 3 {
		return errors.New("gacha card disabled")
	}
	remain := card.RemainQuota + amount
	if remain > card.TotalQuota {
		remain = card.TotalQuota
	}
	status := card.Status
	if status == 1 && remain > 0 {
		status = 0
	}
	return tx.Model(&UserGachaCard{}).Where("id = ?", cardId).
		Updates(map[string]interface{}{
			"remain_quota": remain,
			"status":       status,
			"updated_time": common.GetTimestamp(),
		}).Error
}

// RefundGachaCardPreConsume 按 requestId 幂等退还卡预扣额度。
func RefundGachaCardPreConsume(requestId string, cardId int, amount int64) error {
	if requestId == "" || cardId <= 0 || amount <= 0 {
		return nil
	}
	var existing GachaCardRefund
	if err := DB.Where("request_id = ?", requestId).First(&existing).Error; err == nil {
		return nil
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		record := GachaCardRefund{
			RequestId:   requestId,
			CardId:      cardId,
			Amount:      amount,
			CreatedTime: common.GetTimestamp(),
		}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		return refundGachaCardQuotaTx(tx, cardId, amount)
	})
	if err == nil {
		return nil
	}
	if queryErr := DB.Where("request_id = ?", requestId).First(&existing).Error; queryErr == nil {
		return nil
	}
	return err
}

// ExpireDueGachaCards 将已过期且仍可用的卡置为过期（Status=2），返回更新行数。
func ExpireDueGachaCards(limit int) (int, error) {
	now := common.GetTimestamp()
	res := DB.Model(&UserGachaCard{}).
		Where("status = 0 AND expired_time > 0 AND expired_time < ?", now).
		Limit(limit).
		Updates(map[string]interface{}{"status": 2, "updated_time": now})
	if res.Error != nil {
		return 0, res.Error
	}
	return int(res.RowsAffected), nil
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
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userId).First(&user).Error; err != nil {
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
		var pullCards []PullCardResult
		for _, c := range cards {
			expiredAt := int64(-1)
			if c.Entry.ExpireDays > 0 {
				expiredAt = now + int64(c.Entry.ExpireDays)*86400
			}
			card := UserGachaCard{
				UserId:      userId,
				PoolId:      pool.Id,
				ModelName:   c.Entry.ModelName,
				Group:       c.Entry.Group,
				TotalQuota:  c.Entry.Quota,
				RemainQuota: c.Entry.Quota,
				Status:      0,
				ExpiredTime: expiredAt,
				CreatedTime: now,
				UpdatedTime: now,
			}
			if err := tx.Create(&card).Error; err != nil {
				return err
			}
			pullCards = append(pullCards, PullCardResult{
				CardId:     card.Id,
				ModelName:  card.ModelName,
				Group:      card.Group,
				Rarity:     c.Rating,
				Quota:      card.TotalQuota,
				ExpireDays: c.Entry.ExpireDays,
				ExpiredAt:  expiredAt,
			})
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

		// 写流水
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
