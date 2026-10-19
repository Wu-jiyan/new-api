package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// perfGroupFilterAll is the model square's "every group" sentinel. It is not a
// real group name, so it must never reach the statistics layer.
const perfGroupFilterAll = "all"

// configuredPerfGroups lists the groups that can have samples: every configured
// group ratio plus the legacy "auto" pseudo group.
func configuredPerfGroups() []string {
	return append(lo.Keys(ratio_setting.GetGroupRatioCopy()), "auto")
}

// resolvePerfSummaryGroups decides which groups feed the model-level summary.
//
//   - an explicit group: only that group, so the square shows the group's own rate
//   - no group: only the Auto Group Chain; groups outside it (free, promotional)
//     keep their own row but never drag the model's overall figure down
//   - no Auto Group Chain configured: nil, which keeps the pre-existing
//     "every group counts" behaviour
func resolvePerfSummaryGroups(group string) []string {
	if group != "" && group != perfGroupFilterAll {
		return []string{group}
	}
	if autoGroups := setting.GetAutoGroups(); len(autoGroups) > 0 {
		return autoGroups
	}
	return nil
}

func requestPerfHours(c *gin.Context) int {
	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}
	return hours
}

func GetPerfMetricsSummary(c *gin.Context) {
	hours := requestPerfHours(c)

	recentModels := c.QueryArray("recent_model")
	if len(recentModels) > perfmetrics.MaxRecentModels {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	groups := configuredPerfGroups()
	if scope := resolvePerfSummaryGroups(c.Query("group")); scope != nil {
		groups = scope
	}
	result, err := perfmetrics.QuerySummaryAll(hours, groups, recentModels...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// GetPerfMetrics returns one model's performance. The group query parameter
// scopes the model-level summary only: the per-group rows always list every
// group, which is what lets the details view show a scoped overall figure next
// to each group's own success rate.
func GetPerfMetrics(c *gin.Context) {
	modelName := c.Query("model")
	if modelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "model is required",
		})
		return
	}

	result, err := perfmetrics.Query(perfmetrics.QueryParams{
		Model:         modelName,
		Hours:         requestPerfHours(c),
		AllowedGroups: configuredPerfGroups(),
		SummaryGroups: resolvePerfSummaryGroups(c.Query("group")),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}
