package controller

import (
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// ratingThresholdsResponse 四个维度各自的档位阈值。
func ratingThresholdsResponse() map[model.RatingDimension]model.RatingThresholds {
	out := make(map[model.RatingDimension]model.RatingThresholds, len(model.RatingDimensions))
	for _, dim := range model.RatingDimensions {
		out[dim] = model.RatingThresholdsFor(dim)
	}
	return out
}

// AdminListModelRatings 模型分级列表（keyword 可搜模型名，rating 可筛选 DeepSWE 档位）。
func AdminListModelRatings(c *gin.Context) {
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
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
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
	aaLastSync, aaSyncCount, aaKeyConfigured, aaLastError := service.AARatingSyncStatus()
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"data":       models,
		"total":      total,
		"thresholds": ratingThresholdsResponse(),
		"deepswe": gin.H{
			"last_sync_at":  lastSync,
			"last_sync_num": syncCount,
		},
		"aa": gin.H{
			"last_sync_at":  aaLastSync,
			"last_sync_num": aaSyncCount,
			"api_key_set":   aaKeyConfigured,
			"last_error":    aaLastError,
		},
	})
}

// AdminSetModelRating 手动设置 DeepSWE 维度分数。档位由分数按当前阈值自动推导，
// 不可直接编辑。rating_score > 0：档位 = 分数映射结果，来源记为 manual，
// DeepSWE 同步跳过；rating_score <= 0：清空分级，后续可被同步重新覆盖。
func AdminSetModelRating(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req struct {
		RatingScore float64 `json:"rating_score"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if req.RatingScore < 0 || req.RatingScore > 100 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "分数必须在 0-100 之间"})
		return
	}
	if req.RatingScore <= 0 {
		if _, err := model.ResetGachaRatings([]int{id}); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
		model.RefreshPricing()
		c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
			"id": id, "rating": "", "rating_score": float64(0), "rating_source": "",
		}})
		return
	}
	rating := model.MapScoreToRating(req.RatingScore)
	if err := model.UpdateModelRating(id, rating, req.RatingScore, "manual"); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"id": id, "rating": rating, "rating_score": req.RatingScore, "rating_source": "manual",
	}})
}

// AdminSetModelAAScores 手动设置 AA 三个维度的分数。三个维度全为 0 表示清空该模型的
// AA 评分（清空后可被同步重新覆盖），否则来源记为 manual，后续同步不再覆盖。
func AdminSetModelAAScores(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req struct {
		AAIntelligenceScore float64 `json:"aa_intelligence_score"`
		AACodingScore       float64 `json:"aa_coding_score"`
		AAAgenticScore      float64 `json:"aa_agentic_score"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	for name, score := range map[string]float64{
		"aa_intelligence_score": req.AAIntelligenceScore,
		"aa_coding_score":       req.AACodingScore,
		"aa_agentic_score":      req.AAAgenticScore,
	} {
		if score < 0 || score > 100 {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": name + " 必须在 0-100 之间"})
			return
		}
	}
	cleared := req.AAIntelligenceScore == 0 && req.AACodingScore == 0 && req.AAAgenticScore == 0
	if cleared {
		_, err = model.ResetModelAAScores([]int{id})
	} else {
		err = model.UpdateModelAAScores(id, req.AAIntelligenceScore, req.AACodingScore, req.AAAgenticScore)
	}
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	source := "manual"
	if cleared {
		source = ""
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"id":                    id,
		"aa_intelligence_score": req.AAIntelligenceScore,
		"aa_coding_score":       req.AACodingScore,
		"aa_agentic_score":      req.AAAgenticScore,
		"aa_source":             source,
	}})
}

// AdminBatchResetModelRatings 批量清空模型分级（DeepSWE 与 AA 两个维度一起清空）。
func AdminBatchResetModelRatings(c *gin.Context) {
	var req struct {
		Ids []int `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	n, err := model.ResetGachaRatings(req.Ids)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	aa, err := model.ResetModelAAScores(req.Ids)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"deepswe": n, "aa": aa}})
}

// AdminSyncModelRatings 手动触发 DeepSWE 同步，返回同步详情。
func AdminSyncModelRatings(c *gin.Context) {
	res, err := service.SyncDeepSweRatingsNow()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    res,
		"message": "同步完成，更新 " + strconv.Itoa(res.Updated) + " 个模型",
	})
}

// AdminSyncAARatings 手动触发 Artificial Analysis 同步，返回同步详情。
func AdminSyncAARatings(c *gin.Context) {
	res, err := service.SyncAARatingsNow()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	model.RefreshPricing()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    res,
		"message": "同步完成，更新 " + strconv.Itoa(res.Updated) + " 个模型",
	})
}

// AdminUpdateModelRatingThresholds 更新单个维度的档位阈值。DeepSWE 维度变化后按新阈值
// 重算已存分数的模型档位（抽卡依赖该列）；AA 档位不入库，阈值改动即时生效。
func AdminUpdateModelRatingThresholds(c *gin.Context) {
	var req struct {
		Dimension model.RatingDimension `json:"dimension" binding:"required"`
		UR        float64               `json:"ur"`
		SSR       float64               `json:"ssr"`
		SR        float64               `json:"sr"`
		R         float64               `json:"r"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if !slices.Contains(model.RatingDimensions, req.Dimension) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "未知评分维度"})
		return
	}
	next := model.RatingThresholds{UR: req.UR, SSR: req.SSR, SR: req.SR, R: req.R}
	if !next.Valid() {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "阈值必须满足 UR>SSR>SR>R>=0"})
		return
	}
	if err := model.SetModelRatingThresholds(map[model.RatingDimension]model.RatingThresholds{req.Dimension: next}); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	var retiered int64
	if req.Dimension == model.RatingDimensionDeepSwe {
		n, err := model.RetierGachaRatingsByScore()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
		retiered = n
	}
	model.RefreshPricing()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"retiered": retiered}})
}

// AdminUpdateAASettings 保存 Artificial Analysis API Key。key 只保存在服务端，
// 不回传给前端（仅返回是否已配置）；传空字符串表示清除配置。
func AdminUpdateAASettings(c *gin.Context) {
	var req struct {
		APIKey string `json:"api_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	key := strings.TrimSpace(req.APIKey)
	if err := model.UpdateOption(common.OptionKeyAAApiKey, key); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"api_key_set": key != ""}})
}
