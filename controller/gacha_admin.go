package controller

import (
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
