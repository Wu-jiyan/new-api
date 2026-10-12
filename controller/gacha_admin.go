package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

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
	if len(model.EntryModelList(entry)) == 0 || model.EntryGroup(entry) == "" || entry.Weight <= 0 || entry.Quota <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "模型/分组/权重/额度必填且为正"})
		return
	}
	if reason := model.ValidateGachaEntryReason(&entry); reason != "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": reason})
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

// AdminGenerateGachaEntriesPreview 批量生成条目预览（不落库）：按档位自动权重/额度并建议售价。
func AdminGenerateGachaEntriesPreview(c *gin.Context) {
	poolId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req model.GenerateGachaEntryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	preview, err := model.GenerateGachaEntries(poolId, &req, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": preview})
}

// AdminGenerateGachaEntries 批量生成条目并落库（可选替换该分组条目 + 自动定价）。
func AdminGenerateGachaEntries(c *gin.Context) {
	poolId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req model.GenerateGachaEntryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	preview, err := model.GenerateGachaEntries(poolId, &req, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": preview})
}
