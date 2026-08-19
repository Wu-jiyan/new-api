package controller

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ListGachaPools 用户可见卡池列表（含条目与期望价值）。
func ListGachaPools(c *gin.Context) {
	userId := c.GetInt("id")
	pools, err := model.ListEnabledGachaPools()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	type poolView struct {
		model.GachaPool
		Entries []model.GachaCardEntry `json:"entries"`
		EvValue int64                  `json:"ev_value"`
	}
	views := make([]poolView, 0, len(pools))
	for _, p := range pools {
		entries, err := model.ListGachaPoolEntries(p.Id)
		if err != nil {
			continue
		}
		ev, _ := model.ComputePoolExpectedValue(&p, entries, userId)
		views = append(views, poolView{GachaPool: p, Entries: entries, EvValue: ev})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": views})
}

// PullGachaCards 抽卡（单抽/十连）。pull_id 由客户端生成用于幂等。
func PullGachaCards(c *gin.Context) {
	userId := c.GetInt("id")
	poolId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid pool id"})
		return
	}
	var req struct {
		Count  int    `json:"count"`
		PullId string `json:"pull_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if req.PullId == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "pull_id is required"})
		return
	}
	if req.Count != 1 && req.Count != 10 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "count must be 1 or 10"})
		return
	}
	pool, entries, err := model.GetGachaPoolWithEntries(poolId)
	if err != nil || !pool.Enabled || len(entries) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "卡池不存在或未启用"})
		return
	}
	if req.Count == 10 && pool.TenPrice <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该卡池不支持十连"})
		return
	}
	cost := pool.Price
	if req.Count == 10 {
		cost = pool.TenPrice
	}
	// 余额预检（快速失败，避免无谓事务）
	quota, err := model.GetUserQuota(userId, false)
	if err != nil || quota < int(cost) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "余额不足"})
		return
	}
	result, err := model.PullGachaCards(userId, pool, entries, req.Count, cost, req.PullId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}

// ListGachaCards 我的卡库（分页 + 状态筛选）。
func ListGachaCards(c *gin.Context) {
	userId := c.GetInt("id")
	statusStr := c.DefaultQuery("status", "")
	pageStr := c.DefaultQuery("page", "1")
	pageSizeStr := c.DefaultQuery("page_size", "20")
	page, _ := strconv.Atoi(pageStr)
	pageSize, _ := strconv.Atoi(pageSizeStr)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	tx := model.DB.Model(&model.UserGachaCard{}).Where("user_id = ?", userId)
	if statusStr != "" {
		if s, err := strconv.Atoi(statusStr); err == nil {
			tx = tx.Where("status = ?", s)
		}
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	var cards []model.UserGachaCard
	if err := tx.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&cards).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if len(cards) > 0 {
		ids := make([]int, 0, len(cards))
		byCardID := make(map[int]*model.UserGachaCard, len(cards))
		for i := range cards {
			ids = append(ids, cards[i].Id)
			byCardID[cards[i].Id] = &cards[i]
		}
		var tokens []model.GachaCardToken
		if err := model.DB.Where("card_id IN ? AND status = 0", ids).Find(&tokens).Error; err == nil {
			for _, token := range tokens {
				if card := byCardID[token.CardId]; card != nil {
					card.TokenMasked = token.KeyPrefix + "…"
					card.TokenStatus = token.Status
					card.TokenExists = true
				}
			}
		}
	}
	// 批量补模型档位（前端卡片分级展示）
	ratings := map[string]string{}
	names := make([]string, 0, len(cards))
	for _, card := range cards {
		if _, ok := ratings[card.ModelName]; ok {
			continue
		}
		names = append(names, card.ModelName)
		ratings[card.ModelName] = ""
	}
	if len(names) > 0 {
		var ms []model.Model
		if err := model.DB.Where("model_name IN ?", names).Find(&ms).Error; err == nil {
			for _, m := range ms {
				ratings[m.ModelName] = m.Rating
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": cards, "total": total, "ratings": ratings})
}

func ResetGachaCardToken(c *gin.Context) {
	cardId, err := strconv.Atoi(c.Param("id"))
	if err != nil || cardId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid card id"})
		return
	}
	token, plainKey, err := model.ResetGachaCardToken(c.GetInt("id"), cardId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"card_token": plainKey, "token_prefix": token.KeyPrefix}})
}

func RevokeGachaCardToken(c *gin.Context) {
	cardId, err := strconv.Atoi(c.Param("id"))
	if err != nil || cardId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid card id"})
		return
	}
	if err := model.RevokeGachaCardToken(c.GetInt("id"), cardId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetGachaStats 我的抽卡统计（含近 N 次抽卡回本率，基于真实数据，仅供参考）。
func GetGachaStats(c *gin.Context) {
	userId := c.GetInt("id")
	var records []model.GachaPullRecord
	if err := model.DB.Where("user_id = ?", userId).Find(&records).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	totalPulls := 0
	totalCost := int64(0)
	byRarity := map[string]int{}
	for _, r := range records {
		totalPulls += r.Count
		totalCost += r.Cost
		var cards []model.PullCardResult
		if err := json.Unmarshal([]byte(r.Cards), &cards); err == nil {
			for _, card := range cards {
				byRarity[card.Rarity]++
			}
		}
	}
	// 近 10 次抽卡：回本率 = 抽到卡额度价值 / 花费（真实数据统计，非概率）
	var recent []model.GachaPullRecord
	if err := model.DB.Where("user_id = ?", userId).Order("id DESC").Limit(10).Find(&recent).Error; err != nil {
		recent = nil
	}
	recentPulls := 0
	recentCost := int64(0)
	recentValue := int64(0)
	for _, r := range recent {
		recentPulls += r.Count
		recentCost += r.Cost
		var cards []model.PullCardResult
		if err := json.Unmarshal([]byte(r.Cards), &cards); err == nil {
			for _, card := range cards {
				recentValue += card.Quota
			}
		}
	}
	recentRtp := 0.0
	if recentCost > 0 {
		recentRtp = float64(recentValue) / float64(recentCost)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"total_pulls":  totalPulls,
			"total_cost":   totalCost,
			"by_rarity":    byRarity,
			"recent_rtp":   recentRtp,
			"recent_pulls": recentPulls,
			"recent_cost":  recentCost,
			"recent_value": recentValue,
		},
	})
}
