package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// AdminListGachaRatings 模型分级列表（keyword 可搜模型名，rating 可筛选档位）。
func AdminListGachaRatings(c *gin.Context) {
	keyword := c.Query("keyword")
	rating := c.Query("rating")
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
	models, total, err := model.SearchModels(keyword, "", "", "", (page-1)*pageSize, pageSize)
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if rating != "" {
		filtered := models[:0]
		for _, m := range models {
			if m.Rating == rating {
				filtered = append(filtered, m)
			}
		}
		models = filtered
	}
	lastSync, syncCount := service.GetGachaRatingSyncStatus()
	c.JSON(200, gin.H{
		"success":       true,
		"data":          models,
		"total":         total,
		"last_sync_at":  lastSync,
		"last_sync_num": syncCount,
		"thresholds":    model.DeepSweRatingThresholds,
	})
}

// AdminSetGachaRating 手动设置模型分级（覆盖后 source=manual，同步任务跳过）。
func AdminSetGachaRating(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req struct {
		Rating      string  `json:"rating"`
		RatingScore float64 `json:"rating_score"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if !isValidRating(req.Rating) {
		c.JSON(200, gin.H{"success": false, "message": "rating must be N/R/SR/SSR/UR or empty"})
		return
	}
	if err := model.UpdateModelRating(id, req.Rating, req.RatingScore, "manual"); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	c.JSON(200, gin.H{"success": true})
}

// AdminSyncGachaRatings 手动触发 DeepSWE 同步。
func AdminSyncGachaRatings(c *gin.Context) {
	n, err := service.SyncDeepSweRatingsNow()
	if err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	c.JSON(200, gin.H{"success": true, "message": "同步完成，更新 " + strconv.Itoa(n) + " 个模型"})
}

// AdminUpdateGachaRatingThresholds 更新档位阈值。
func AdminUpdateGachaRatingThresholds(c *gin.Context) {
	var req struct {
		UR  float64 `json:"ur"`
		SSR float64 `json:"ssr"`
		SR  float64 `json:"sr"`
		R   float64 `json:"r"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	if !(req.UR > req.SSR && req.SSR > req.SR && req.SR > req.R && req.R >= 0) {
		c.JSON(200, gin.H{"success": false, "message": "阈值必须满足 UR>SSR>SR>R>=0"})
		return
	}
	jsonStr := `{"ur":` + strconv.FormatFloat(req.UR, 'f', -1, 64) + `,"ssr":` + strconv.FormatFloat(req.SSR, 'f', -1, 64) +
		`,"sr":` + strconv.FormatFloat(req.SR, 'f', -1, 64) + `,"r":` + strconv.FormatFloat(req.R, 'f', -1, 64) + `}`
	if err := model.UpdateOption(common.OptionKeyGachaRatingThresholds, jsonStr); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.ReloadGachaRatingThresholds()
	model.RefreshPricing()
	c.JSON(200, gin.H{"success": true})
}

func isValidRating(r string) bool {
	switch r {
	case "", "N", "R", "SR", "SSR", "UR":
		return true
	}
	return false
}

// ---------------------------------------------------------------------------
// 卡池管理
// ---------------------------------------------------------------------------

// AdminListGachaPools 卡池列表（含条目）。
func AdminListGachaPools(c *gin.Context) {
	var pools []model.GachaPool
	if err := model.DB.Order("sort_order ASC, id ASC").Find(&pools).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	type poolView struct {
		model.GachaPool
		Entries []model.GachaCardEntry `json:"entries"`
	}
	views := make([]poolView, 0, len(pools))
	for _, p := range pools {
		entries, err := model.ListGachaPoolEntries(p.Id)
		if err != nil {
			continue
		}
		views = append(views, poolView{GachaPool: p, Entries: entries})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": views})
}

// AdminCreateGachaPool 新建卡池。
func AdminCreateGachaPool(c *gin.Context) {
	var pool model.GachaPool
	if err := c.ShouldBindJSON(&pool); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if pool.Name == "" || pool.Price < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "名称与价格必填"})
		return
	}
	if pool.PityEnabled && (pool.PityMax <= 0 || pool.PityRarity == "") {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "启用保底需配置保底抽数与保底档位"})
		return
	}
	now := common.GetTimestamp()
	pool.CreatedTime = now
	pool.UpdatedTime = now
	if err := model.DB.Create(&pool).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": pool})
}

// AdminUpdateGachaPool 更新卡池。
func AdminUpdateGachaPool(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var pool model.GachaPool
	if err := model.DB.First(&pool, id).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "卡池不存在"})
		return
	}
	var req model.GachaPool
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	req.Id = id
	if req.Name == "" || req.Price < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "名称与价格必填"})
		return
	}
	if req.PityEnabled && (req.PityMax <= 0 || req.PityRarity == "") {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "启用保底需配置保底抽数与保底档位"})
		return
	}
	req.CreatedTime = pool.CreatedTime
	req.UpdatedTime = common.GetTimestamp()
	if err := model.DB.Model(&model.GachaPool{}).Where("id = ?", id).Updates(req).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminDeleteGachaPool 删除卡池（软删除池，硬删条目）。
func AdminDeleteGachaPool(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.DB.Delete(&model.GachaPool{}, id).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.DB.Where("pool_id = ?", id).Delete(&model.GachaCardEntry{}).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminPoolEconomics 经济测算（期望价值 / 回报率 / 期望成本 / 告警）。
func AdminPoolEconomics(c *gin.Context) {
	poolId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	pool, entries, err := model.GetGachaPoolWithEntries(poolId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	ev, _ := model.ComputePoolExpectedValue(pool, entries, 0)
	econ, err := model.ComputePoolEconomics(pool, entries)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"expected_value":      ev,
		"price":               pool.Price,
		"rtp":                 econ.RTP,
		"expected_cost":       econ.ExpectedCost,
		"profit_est":          econ.ProfitEst,
		"warn":                econ.Warn,
		"warn_reason":         econ.WarnReason,
		"unknown_cost_weight": econ.UnknownCostWeight,
		"entries":             entries,
	}})
}

// AdminUpsertGachaEntry 新增/更新条目（含合法性校验）。
func AdminUpsertGachaEntry(c *gin.Context) {
	poolId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid pool id"})
		return
	}
	var entry model.GachaCardEntry
	if err := c.ShouldBindJSON(&entry); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	entry.PoolId = poolId
	if entry.ModelName == "" || entry.Group == "" || entry.Weight <= 0 || entry.Quota <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "模型/分组/权重/额度必填且为正"})
		return
	}
	if !model.ValidateGachaEntry(&entry) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "模型或分组无效：模型须存在且该分组有启用渠道与分组倍率"})
		return
	}
	if entry.Id > 0 {
		if err := model.DB.Model(&model.GachaCardEntry{}).Where("id = ? AND pool_id = ?", entry.Id, entry.PoolId).Updates(&entry).Error; err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
	} else {
		if err := model.DB.Create(&entry).Error; err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": entry})
}

// AdminDeleteGachaEntry 删除条目。
func AdminDeleteGachaEntry(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.DB.Delete(&model.GachaCardEntry{}, id).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
