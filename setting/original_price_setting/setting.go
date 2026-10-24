// Package original_price_setting 保存「模型原价」展示所需的配置：官方标价基准的
// 展示开关，以及按模型配置原价时用到的 USD→CNY 汇率同步参数与同步结果。
//
// 原价只是展示基准，绝不参与计费：模型广场用「站内实付价 ÷ 官方原价」算折扣，
// 与额度、预扣费、结算、日志计费字段没有任何关系。
package original_price_setting

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// DefaultSyncBaseURL 是 ExchangeRate-API 的免费端点（托管在 Cloudflare 上），
// 服务会自行拼上 /USD。国内镜像可改成 https://er-api.25y.cn/v6/latest 之类的地址。
const DefaultSyncBaseURL = "https://open.er-api.com/v6/latest"

const (
	// 同步间隔按小时配置。下限 1 小时：源站本身一天只更新一次，更密的轮询只是白
	// 打对方；上限一周，避免管理员误填一个几乎永不触发的值。
	MinSyncIntervalHours = 1
	MaxSyncIntervalHours = 24 * 7

	// USD→CNY 汇率的合理区间。写成宽区间只为了挡住坏响应（源站改格式返回 0、
	// 或返回某个币种的小数），不是为了预测行情：2026 年实测 6.68。
	minAcceptedUSDCNYRate = 0.5
	maxAcceptedUSDCNYRate = 100
)

// Setting 是管理员可编辑的配置项，键名前缀 original_price_setting。
type Setting struct {
	// Enabled 是总开关：关闭后模型广场既不展示原价也不展示折扣。
	Enabled bool `json:"enabled"`
	// ShowByDefault 决定访客开关的初始状态；访客仍可自行切换。
	ShowByDefault bool `json:"show_by_default"`
	// SyncEnabled 控制后台是否按间隔拉取汇率。
	SyncEnabled bool `json:"sync_enabled"`
	// SyncBaseURL 是汇率源的基础地址，服务实际请求 <SyncBaseURL>/USD。
	SyncBaseURL string `json:"sync_base_url"`
	// SyncIntervalHours 是同步间隔（小时）。
	SyncIntervalHours int `json:"sync_interval_hours"`
}

// RateState 是同步任务写回的状态，管理端只读，键名前缀 original_price_rate。
type RateState struct {
	// USDCNYRate 是最近一次成功同步的市场汇率；0 表示从未成功同步。
	USDCNYRate float64 `json:"usd_cny_rate"`
	// UpdatedAt 是最近一次成功同步的时间（unix 秒）。
	UpdatedAt int64 `json:"updated_at"`
	// Source 是最近一次成功同步实际请求的地址。
	Source string `json:"source"`
	// LastError 是最近一次失败的原因，成功后清空。
	LastError string `json:"last_error"`
}

// PublicOptions 是模型广场需要的展示开关与汇率快照。
type PublicOptions struct {
	Enabled       bool    `json:"enabled"`
	ShowByDefault bool    `json:"show_by_default"`
	USDCNYRate    float64 `json:"usd_cny_rate"`
	RateUpdatedAt int64   `json:"rate_updated_at,omitempty"`
	RateSource    string  `json:"rate_source,omitempty"`
}

var (
	setting = Setting{
		Enabled:           true,
		ShowByDefault:     true,
		SyncEnabled:       true,
		SyncBaseURL:       DefaultSyncBaseURL,
		SyncIntervalHours: 1,
	}
	rateState = RateState{}
)

func init() {
	config.GlobalConfig.Register("original_price_setting", &setting)
	config.GlobalConfig.Register("original_price_rate", &rateState)
}

func GetSetting() *Setting {
	return &setting
}

func GetRateState() RateState {
	return rateState
}

// USDCNYRate 返回可用的市场汇率；未同步或存量脏数据一律回 0，调用方据此降级。
func USDCNYRate() float64 {
	rate := rateState.USDCNYRate
	if err := ValidateUSDCNYRate(rate); err != nil {
		return 0
	}
	return rate
}

func GetPublicOptions() PublicOptions {
	state := GetRateState()
	return PublicOptions{
		Enabled:       setting.Enabled,
		ShowByDefault: setting.ShowByDefault,
		USDCNYRate:    USDCNYRate(),
		RateUpdatedAt: state.UpdatedAt,
		RateSource:    state.Source,
	}
}

// SyncInterval 返回实际生效的同步间隔；配置越界时退回默认值，让后台任务
// 不会因为一次误填就停摆。
func SyncInterval() (hours int) {
	hours = setting.SyncIntervalHours
	if ValidateSyncIntervalHours(hours) != nil {
		return 1
	}
	return hours
}

func ValidateSyncIntervalHours(hours int) error {
	if hours < MinSyncIntervalHours || hours > MaxSyncIntervalHours {
		return fmt.Errorf("sync interval must be between %d and %d hours", MinSyncIntervalHours, MaxSyncIntervalHours)
	}
	return nil
}

func ValidateUSDCNYRate(rate float64) error {
	if math.IsNaN(rate) || math.IsInf(rate, 0) {
		return errors.New("exchange rate must be a finite number")
	}
	if rate < minAcceptedUSDCNYRate || rate > maxAcceptedUSDCNYRate {
		return fmt.Errorf("exchange rate %v is outside the accepted range %v-%v", rate, minAcceptedUSDCNYRate, maxAcceptedUSDCNYRate)
	}
	return nil
}

// NormalizeBaseURL 只接受绝对 http(s) 地址。返回的地址不带结尾斜杠，
// 便于再拼 /USD。
func NormalizeBaseURL(raw string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return "", errors.New("exchange rate base URL is required")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("exchange rate base URL is invalid")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("exchange rate base URL must start with http:// or https://")
	}
	if parsed.Host == "" {
		return "", errors.New("exchange rate base URL must include a host")
	}
	return trimmed, nil
}

// LatestRatesURL 把基础地址补成取 USD 牌价的地址。管理员已经写成 .../USD 时
// 原样使用，避免拼出 .../USD/USD。
func LatestRatesURL(rawBaseURL string) (string, error) {
	base, err := NormalizeBaseURL(rawBaseURL)
	if err != nil {
		return "", err
	}
	if strings.HasSuffix(strings.ToUpper(base), "/USD") {
		return base, nil
	}
	return base + "/USD", nil
}

// ValidateOptionValue 供选项写入路径调用，拦住越界间隔与非法地址；
// original_price_rate.* 由同步任务自己写回，不接受管理端输入，因此只校验当前汇率。
func ValidateOptionValue(key, value string) error {
	switch key {
	case "original_price_setting.sync_interval_hours":
		hours, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return errors.New("sync interval must be an integer number of hours")
		}
		return ValidateSyncIntervalHours(hours)
	case "original_price_setting.sync_base_url":
		_, err := NormalizeBaseURL(value)
		return err
	case "original_price_rate.usd_cny_rate":
		rate, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil {
			return errors.New("exchange rate must be a number")
		}
		// 0 表示「尚未同步成功」，是合法状态，不能当成越界值拒掉。
		if rate == 0 {
			return nil
		}
		return ValidateUSDCNYRate(rate)
	default:
		return nil
	}
}
