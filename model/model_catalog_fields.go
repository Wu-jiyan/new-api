package model

import (
	"errors"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// CatalogModalities 是展示用模态的闭集，与前端 `PricingModel` 的 `Modality`
// 联合类型（text/image/audio/video/file）必须保持一致：前端对未知值走
// `MODALITY_LABEL_KEYS[item] ?? item` 兜底，会把原始字符串直接渲染出来，
// 所以这里宁可拒绝写入，也不要放行闭集之外的值。
var CatalogModalities = []string{"text", "image", "audio", "video", "file"}

// tokenLimitCeiling 防御上限。真实模型的窗口远小于此值；限制它是为了让
// `context_length = 2147483647` 这类误填在保存时就被拒绝，而不是流到 UI 上
// 变成一个没人相信的数字。取值依据：目前公开的最大窗口在 10M 量级。
const tokenLimitCeiling = 100_000_000

func isCatalogModality(value string) bool {
	for _, known := range CatalogModalities {
		if value == known {
			return true
		}
	}
	return false
}

// ParseModelModalities 解析存储用的 JSON 数组文本。
// 解析失败一律返回 nil 而不是报错：读取路径要能容忍历史脏数据，
// 校验发生在写入路径（ValidateModelModalities），不该把读路径一起拖垮。
func ParseModelModalities(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var values []string
	if err := common.UnmarshalJsonStr(raw, &values); err != nil {
		return nil
	}
	return values
}

// ValidateModelModalities 校验模态字段：必须是 JSON 字符串数组，且每项都在闭集内。
// 与 ValidateModelEndpoints 同样的思路——只接受已知形状，绝不放行任意 JSON 标量。
func ValidateModelModalities(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var values []string
	if err := common.UnmarshalJsonStr(raw, &values); err != nil {
		return errors.New("modalities must be a JSON array of strings")
	}
	for _, value := range values {
		if !isCatalogModality(value) {
			return errors.New("unsupported modality: " + value)
		}
	}
	return nil
}

// ValidateCatalogFields 校验展示用目录字段。
// 挂在 Model 的 Insert/Update 上而不是各 controller 里，这样任何写入方
// （管理端 CRUD、未来可能的批量导入）都绕不过去。
func (mi *Model) ValidateCatalogFields() error {
	if err := validateTokenLimit("context_length", mi.ContextLength); err != nil {
		return err
	}
	if err := validateTokenLimit("max_input_tokens", mi.MaxInputTokens); err != nil {
		return err
	}
	if err := validateTokenLimit("max_output_tokens", mi.MaxOutputTokens); err != nil {
		return err
	}
	if err := ValidateModelModalities(mi.InputModalities); err != nil {
		return err
	}
	if err := ValidateModelModalities(mi.OutputModalities); err != nil {
		return err
	}
	return mi.ValidateOriginalPrice()
}

// 原价币种的闭集。空字符串表示「未配置原价」，此时所有金额字段必须为 0。
const (
	OriginalPriceCurrencyUSD = "USD"
	OriginalPriceCurrencyCNY = "CNY"
)

// originalPriceCeiling 是单个原价金额的防御上限（每 100 万 token / 每次请求）。
// 真实最贵的模型也在每百万 token 三位数美元量级，这里留足四个数量级，
// 只用来挡住 1e308 这类会让前端算折扣时溢出成 Infinity 的误填。
const originalPriceCeiling = 1_000_000

// ValidateOriginalPrice 校验原价展示字段，并把币种统一成大写。
// 规则：币种只能空/USD/CNY；填了金额就必须选币种；金额不可为负、不可非有限、
// 不可超过防御上限。0 表示「该计价项未配置」，是合法状态。
func (mi *Model) ValidateOriginalPrice() error {
	currency := strings.ToUpper(strings.TrimSpace(mi.OriginalPriceCurrency))
	switch currency {
	case "", OriginalPriceCurrencyUSD, OriginalPriceCurrencyCNY:
	default:
		return errors.New("original price currency must be USD or CNY")
	}
	mi.OriginalPriceCurrency = currency

	amounts := []struct {
		name  string
		value float64
	}{
		{"original_price_input", mi.OriginalPriceInput},
		{"original_price_output", mi.OriginalPriceOutput},
		{"original_price_cache", mi.OriginalPriceCache},
		{"original_price_cache_write", mi.OriginalPriceCacheWrite},
		{"original_price_request", mi.OriginalPriceRequest},
	}
	configured := false
	for _, amount := range amounts {
		if math.IsNaN(amount.value) || math.IsInf(amount.value, 0) {
			return errors.New(amount.name + " must be a finite number")
		}
		if amount.value < 0 {
			return errors.New(amount.name + " cannot be negative")
		}
		if amount.value > originalPriceCeiling {
			return errors.New(amount.name + " is implausibly large")
		}
		if amount.value > 0 {
			configured = true
		}
	}
	if configured && currency == "" {
		return errors.New("original price currency is required when an original price is set")
	}
	return nil
}

// validateTokenLimit 校验一个 token 限额字段。0 表示「未配置」，是合法状态，
// 不能用 `x || fallback` 之类的写法把它吞掉。
func validateTokenLimit(name string, value int) error {
	if value < 0 {
		return errors.New(name + " cannot be negative")
	}
	if value > tokenLimitCeiling {
		return errors.New(name + " is implausibly large")
	}
	return nil
}
