package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/original_price_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func filterPricingByUsableGroups(pricing []model.Pricing, usableGroup map[string]string) []model.Pricing {
	if len(pricing) == 0 {
		return pricing
	}
	if len(usableGroup) == 0 {
		return []model.Pricing{}
	}

	filtered := make([]model.Pricing, 0, len(pricing))
	for _, item := range pricing {
		// The pricing cache is shared by all viewers.
		groups := make([]string, 0, len(item.EnableGroup))
		for _, group := range item.EnableGroup {
			if _, ok := usableGroup[group]; ok || group == "all" {
				groups = append(groups, group)
			}
		}
		if len(groups) > 0 {
			item.EnableGroup = groups
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func GetPricing(c *gin.Context) {
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	usableGroup := service.GetUserUsableGroups(userGroup)
	pricing := filterPricingByUsableGroups(model.GetPricing(), usableGroup)
	groupRatio := ratio_setting.GetGroupRatioCopy()
	for group := range groupRatio {
		if _, ok := usableGroup[group]; !ok {
			delete(groupRatio, group)
			continue
		}
		if userGroup != "" {
			if ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group); ok {
				groupRatio[group] = ratio
			}
		}
	}

	c.JSON(200, gin.H{
		"success":            true,
		"data":               pricing,
		"vendors":            model.GetVendors(),
		"group_ratio":        groupRatio,
		"group_forced_price": ratio_setting.GetGroupForcedPriceCopy(),
		"usable_group":       usableGroup,
		"supported_endpoint": model.GetSupportedEndpointMap(),
"auto_groups":        service.GetUserAutoGroup(userGroup),
		// Unfiltered chain: the model square scopes prices and the model-level
		// success rate to it, so a free/promotional group outside the chain no
		// longer makes every model look free.
		"auto_group_chain": setting.GetAutoGroups(),
		"defaults":         model.GetModelSquareDefaults(),
		"filter_defaults":  model.GetModelSquareFilter(),
		"pricing_version":  "gacha-rating-v1",
		// 原价展示开关与市场汇率快照。折扣由前端按「实付价 ÷ 官方原价」计算，
		// 后端只负责给出统一的开关与汇率口径。
		"original_price_settings": original_price_setting.GetPublicOptions(),
	})
}

func ResetModelRatio(c *gin.Context) {
	defaultStr := ratio_setting.DefaultModelRatio2JSONString()
	err := model.UpdateOption("ModelRatio", defaultStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	err = ratio_setting.UpdateModelRatioByJSONString(defaultStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Model ratios reset", nil)
}
