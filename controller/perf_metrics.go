package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/service"
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

// usablePerfMetricGroups lists the groups the caller is allowed to see. A
// non-nil empty list restricts the metrics query to zero groups, so a private
// group never leaks into a public response.
func usablePerfMetricGroups(c *gin.Context) []string {
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	usableGroups := service.GetUserUsableGroups(userGroup)
	groups := make([]string, 0, len(usableGroups))
	for group := range usableGroups {
		if group == "auto" || ratio_setting.ContainsGroupRatio(group) {
			groups = append(groups, group)
		}
	}
	return groups
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

// GetPerfMetricsSummary serves the model square: the summaries are scoped to
// groups the caller can use, and to the group asked for (or the Auto Group
// Chain) inside that set.
func GetPerfMetricsSummary(c *gin.Context) {
	usableGroups := usablePerfMetricGroups(c)
	groups := resolvePerfSummaryGroups(c.Query("group"))
	if groups == nil {
		groups = usableGroups
	} else {
		usableSet := lo.SliceToMap(usableGroups, func(group string) (string, struct{}) {
			return group, struct{}{}
		})
		groups = lo.Filter(groups, func(group string, _ int) bool {
			_, ok := usableSet[group]
			return ok
		})
	}
	getPerfMetricsSummary(c, groups)
}

// GetDashboardPerfMetricsSummary serves the admin dashboard, which is not
// scoped by the caller's groups and counts every configured group.
func GetDashboardPerfMetricsSummary(c *gin.Context) {
	getPerfMetricsSummary(c, configuredPerfGroups())
}

func getPerfMetricsSummary(c *gin.Context, groups []string) {
	recentModels := c.QueryArray("recent_model")
	if len(recentModels) > perfmetrics.MaxRecentModels {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}

	result, err := perfmetrics.QuerySummaryAll(requestPerfHours(c), groups, recentModels...)
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
// usable group, which is what lets the details view show a scoped overall figure
// next to each group's own success rate.
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
		Group:         c.Query("group"),
		Hours:         requestPerfHours(c),
		AllowedGroups: usablePerfMetricGroups(c),
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
