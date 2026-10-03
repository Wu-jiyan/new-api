package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/billing_setting"

	"github.com/gin-gonic/gin"
)

// syncChannelCostPricesRequest 渠道成本价格同步请求。
type syncChannelCostPricesRequest struct {
	ChannelID int `json:"channel_id"`
}

// SyncChannelCostPrices 从渠道上游抓取定价，组装该渠道"已添加模型"的成本价格表。
// 返回数据格式与 dto.ChannelCostSettings.ModelPrices 一致，供前端预览/保存。
func SyncChannelCostPrices(c *gin.Context) {
	var req syncChannelCostPricesRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ChannelID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数格式错误"})
		return
	}

	channel, err := model.GetChannelById(req.ChannelID, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "查询渠道失败"})
		return
	}

	baseURL := strings.TrimRight(channel.GetBaseURL(), "/")
	if baseURL == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "渠道未配置 Base URL，无法获取上游定价"})
		return
	}

	isOpenRouter := channel.Type == constant.ChannelTypeOpenRouter
	endpoint := defaultEndpoint
	if isOpenRouter {
		endpoint = "/api/v1/models"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+endpoint, nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if isOpenRouter {
		key, _, apiErr := channel.GetNextEnabledKey()
		if apiErr != nil || strings.TrimSpace(key) == "" {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "OpenRouter 渠道需要有效 API Key"})
			return
		}
		httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(key))
	}

	transport := &http.Transport{
		MaxIdleConns:          20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	if common.TLSInsecureSkipVerify {
		transport.TLSClientConfig = common.InsecureTLSConfig
	}
	client := &http.Client{Transport: transport}

	resp, err := client.Do(httpReq)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": fmt.Sprintf("上游返回非 200：%s", resp.Status)})
		return
	}

	limited := io.LimitReader(resp.Body, maxRatioConfigBytes)
	bodyBytes, err := io.ReadAll(limited)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	var converted map[string]any
	if isOpenRouter {
		converted, err = convertOpenRouterToRatioData(bytes.NewReader(bodyBytes))
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "OpenRouter 定价解析失败: " + err.Error()})
			return
		}
	} else {
		var body struct {
			Success bool            `json:"success"`
			Data    json.RawMessage `json:"data"`
			Message string          `json:"message"`
		}
		if err := common.DecodeJson(bytes.NewReader(bodyBytes), &body); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "上游返回解析失败"})
			return
		}
		if !body.Success {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": body.Message})
			return
		}

		// type1: /api/ratio_config 风格（map 字段）
		var type1Data map[string]any
		if err := common.Unmarshal(body.Data, &type1Data); err == nil {
			isType1 := false
			for _, rt := range pricingSyncFields {
				if _, ok := type1Data[rt]; ok {
					isType1 = true
					break
				}
			}
			if isType1 {
				converted = type1Data
			}
		}

		// type2: /api/pricing 风格（[]Pricing 列表）
		if converted == nil {
			var pricingItems []channelCostPricingItem
			if err := common.Unmarshal(body.Data, &pricingItems); err != nil {
				c.JSON(http.StatusOK, gin.H{"success": false, "message": "无法解析上游返回数据"})
				return
			}
			converted = buildChannelCostPricingMap(pricingItems)
		}
	}

	modelPrices, skipped := extractChannelCostPrices(converted, channel.GetModels(), upstreamModelNames(channel.GetModelMapping()))
	if len(modelPrices) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "上游未返回该渠道已添加模型的价格信息"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"model_prices": modelPrices,
			// skipped 明确告知哪些模型上游没有定价，会回退全局标价乘折扣，
			// 避免管理员把"没同步到"误读成"同步完成"。
			"skipped": skipped,
		},
	})
}

// channelCostPricingItem 是上游 /api/pricing 返回的单条定价。
// 数值字段用指针，与 ratio_sync.go 的解析保持一致：上游省略字段时必须与"配了 0"区分开，
// 否则免费模型会被误当成无数据而丢弃。BillingMode/BillingExpr 用于识别表达式计价模型，
// 这类模型没有可用的 model_ratio，必须排除在按量成本表之外。
type channelCostPricingItem struct {
	ModelName            string   `json:"model_name"`
	QuotaType            int      `json:"quota_type"`
	ModelRatio           *float64 `json:"model_ratio"`
	ModelPrice           *float64 `json:"model_price"`
	CompletionRatio      *float64 `json:"completion_ratio"`
	CacheRatio           *float64 `json:"cache_ratio"`
	CreateCacheRatio     *float64 `json:"create_cache_ratio"`
	ImageRatio           *float64 `json:"image_ratio"`
	AudioRatio           *float64 `json:"audio_ratio"`
	AudioCompletionRatio *float64 `json:"audio_completion_ratio"`
	BillingMode          string   `json:"billing_mode"`
	BillingExpr          string   `json:"billing_expr"`
}

// buildChannelCostPricingMap 将 type2（[]Pricing）转换为与 type1 一致的 map 结构。
func buildChannelCostPricingMap(items []channelCostPricingItem) map[string]any {
	modelRatioMap := make(map[string]float64)
	modelPriceMap := make(map[string]float64)
	completionRatioMap := make(map[string]float64)
	cacheRatioMap := make(map[string]float64)
	createCacheRatioMap := make(map[string]float64)
	imageRatioMap := make(map[string]float64)
	audioRatioMap := make(map[string]float64)
	audioCompletionRatioMap := make(map[string]float64)
	billingModeMap := make(map[string]string)
	billingExprMap := make(map[string]string)

	for _, item := range items {
		if item.ModelName == "" {
			continue
		}
		// 表达式计价模型的价格在表达式里，model_ratio 只是自用兜底值，
		// 写进成本表会算出完全错误的成本，因此不产出任何按量字段。
		// 但必须带上计费模式与表达式本身：前者让抽取阶段能正确归类，
		// 后者让成本计算能按上游真实公式重算，而不是退化成按用户实付反推。
		if item.BillingMode == billing_setting.BillingModeTieredExpr {
			billingModeMap[item.ModelName] = billing_setting.BillingModeTieredExpr
			if expr := strings.TrimSpace(item.BillingExpr); expr != "" {
				billingExprMap[item.ModelName] = expr
			}
			continue
		}
		if item.QuotaType == 1 {
			if item.ModelPrice != nil {
				modelPriceMap[item.ModelName] = *item.ModelPrice
			}
		} else {
			if item.ModelRatio != nil {
				modelRatioMap[item.ModelName] = *item.ModelRatio
			}
			if item.CompletionRatio != nil {
				completionRatioMap[item.ModelName] = *item.CompletionRatio
			}
		}
		if item.CacheRatio != nil {
			cacheRatioMap[item.ModelName] = *item.CacheRatio
		}
		if item.CreateCacheRatio != nil {
			createCacheRatioMap[item.ModelName] = *item.CreateCacheRatio
		}
		if item.ImageRatio != nil {
			imageRatioMap[item.ModelName] = *item.ImageRatio
		}
		if item.AudioRatio != nil {
			audioRatioMap[item.ModelName] = *item.AudioRatio
		}
		if item.AudioCompletionRatio != nil {
			audioCompletionRatioMap[item.ModelName] = *item.AudioCompletionRatio
		}
	}

	converted := make(map[string]any)
	if len(modelRatioMap) > 0 {
		converted["model_ratio"] = modelRatioMap
	}
	if len(modelPriceMap) > 0 {
		converted["model_price"] = modelPriceMap
	}
	if len(completionRatioMap) > 0 {
		converted["completion_ratio"] = completionRatioMap
	}
	if len(cacheRatioMap) > 0 {
		converted["cache_ratio"] = cacheRatioMap
	}
	if len(createCacheRatioMap) > 0 {
		converted["create_cache_ratio"] = createCacheRatioMap
	}
	if len(imageRatioMap) > 0 {
		converted["image_ratio"] = imageRatioMap
	}
	if len(audioRatioMap) > 0 {
		converted["audio_ratio"] = audioRatioMap
	}
	if len(audioCompletionRatioMap) > 0 {
		converted["audio_completion_ratio"] = audioCompletionRatioMap
	}
	if len(billingModeMap) > 0 {
		converted[billing_setting.BillingModeField] = billingModeMap
	}
	if len(billingExprMap) > 0 {
		converted[billing_setting.BillingExprField] = billingExprMap
	}
	return converted
}

// upstreamModelNames 返回"渠道模型名 -> 上游模型名"的映射。
// 渠道配置了模型重定向时，上游定价表里的键是重定向后的名字；没有重定向则同名。
// 未显式重定向的模型保持原样，让上游表里直接以渠道名索引的条目也能命中。
func upstreamModelNames(modelMapping string) map[string]string {
	names := make(map[string]string)
	if strings.TrimSpace(modelMapping) == "" {
		return names
	}
	mapping := make(map[string]string)
	if err := common.UnmarshalJsonStr(modelMapping, &mapping); err != nil {
		common.SysError("channel model mapping parse failed: " + err.Error())
		return names
	}
	// model_mapping 的键是渠道（对外）模型名，值是上游模型名，见 relay/helper/model_mapped.go。
	for channelModel, upstream := range mapping {
		channelModel = strings.TrimSpace(channelModel)
		upstream = strings.TrimSpace(upstream)
		if channelModel != "" && upstream != "" {
			names[channelModel] = upstream
		}
	}
	return names
}

// costPriceLookup 按上游模型名读取一个数值字段，返回值与"上游是否显式提供了该字段"。
func costPriceLookup(source map[string]any, upstream string) (float64, bool) {
	raw, ok := source[upstream]
	if !ok {
		return 0, false
	}
	value, ok := asFloat64(raw)
	if !ok || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}

// extractChannelCostPrices 从上游 converted map 提取该渠道已添加模型的成本价格表。
// 结果以渠道模型名为键，并通过 upstreamNames 解析模型重定向后再查上游定价表。
// skipped 说明未能定价的模型及原因，两者运行时回退方式不同，不能混为一谈：
//   - no_upstream_price：上游没给价，回退全局标价 × 渠道折扣
//   - tiered_expr：上游是表达式计价但没给出表达式，只能按用户实付反推
//
// 表达式计价且上游给出了表达式时，模型会带着 BillingExpr 进入成本表，
// 与其他定价方式一样参与精确成本计算。
func extractChannelCostPrices(converted map[string]any, models []string, upstreamNames map[string]string) (map[string]dto.ChannelModelCost, map[string]string) {
	modelRatioMap := valueMap(converted["model_ratio"])
	modelPriceMap := valueMap(converted["model_price"])
	completionRatioMap := valueMap(converted["completion_ratio"])
	cacheRatioMap := valueMap(converted["cache_ratio"])
	createCacheRatioMap := valueMap(converted["create_cache_ratio"])
	imageRatioMap := valueMap(converted["image_ratio"])
	audioRatioMap := valueMap(converted["audio_ratio"])
	audioCompletionRatioMap := valueMap(converted["audio_completion_ratio"])
	billingModeMap := valueMap(converted[billing_setting.BillingModeField])
	billingExprMap := valueMap(converted[billing_setting.BillingExprField])

	result := make(map[string]dto.ChannelModelCost)
	skipped := make(map[string]string)
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		upstream := model
		if mapped, ok := upstreamNames[model]; ok {
			upstream = mapped
		}

		// 表达式计价模型：价格就在表达式里，同步表达式本身即可按上游真实
		// 公式计算成本，不能退化成按用户实付反推。只有上游没给出表达式时
		// 才无法定价，此时才计入 skipped。
		if mode, ok := billingModeMap[upstream].(string); ok &&
			mode == billing_setting.BillingModeTieredExpr {
			expr, _ := billingExprMap[upstream].(string)
			if expr = strings.TrimSpace(expr); expr != "" {
				result[model] = dto.ChannelModelCost{BillingExpr: expr}
				continue
			}
			skipped[model] = "tiered_expr"
			continue
		}

		mc := dto.ChannelModelCost{}
		// 上游显式给出 model_price 即按次/按图计费，与 model_ratio 互斥。
		// 免费模型上游返回 0，必须与"未提供"区分：0 是有效定价，缺失才是无定价。
		if price, ok := costPriceLookup(modelPriceMap, upstream); ok {
			mc.ModelPrice = price
			mc.Free = price == 0
			mc.ModelRatio = 0
		} else if ratio, ok := costPriceLookup(modelRatioMap, upstream); ok &&
			upstreamRatioTrusted(upstream, modelRatioMap, billingModeMap) {
			mc.ModelRatio = ratio
			mc.Free = ratio == 0
		} else {
			skipped[model] = "no_upstream_price"
			continue
		}

		if v, ok := costPriceLookup(completionRatioMap, upstream); ok {
			mc.CompletionRatio = v
		}
		if v, ok := costPriceLookup(cacheRatioMap, upstream); ok {
			mc.CacheRatio = v
		}
		if v, ok := costPriceLookup(createCacheRatioMap, upstream); ok {
			mc.CreateCacheRatio = v
		}
		if v, ok := costPriceLookup(imageRatioMap, upstream); ok {
			mc.ImageRatio = v
		}
		if v, ok := costPriceLookup(audioRatioMap, upstream); ok {
			mc.AudioRatio = v
		}
		if v, ok := costPriceLookup(audioCompletionRatioMap, upstream); ok {
			mc.AudioCompletionRatio = v
		}
		result[model] = mc
	}
	return result, skipped
}
