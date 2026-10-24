package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/original_price_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

// 原价展示需要一条「美元标价 → 人民币标价」的市场汇率：海外模型按美元报价、
// 国内模型按人民币报价，只有换算到同一币种，折扣才可比。汇率来自
// ExchangeRate-API（open.er-api.com，Cloudflare 托管，可换成国内镜像），
// 默认每小时刷新一次，间隔与地址都可在系统设置里改。
const (
	originalPriceRateFetchTimeout = 20 * time.Second
	// 汇率响应体很小；给 1 MiB 上限只是防止源站异常时把内存吃满。
	originalPriceRateMaxResponseBytes = 1 << 20

	originalPriceRateValueKey     = "original_price_rate.usd_cny_rate"
	originalPriceRateUpdatedAtKey = "original_price_rate.updated_at"
	originalPriceRateSourceKey    = "original_price_rate.source"
	originalPriceRateErrorKey     = "original_price_rate.last_error"
)

var (
	originalPriceRateSyncOnce sync.Once
	// originalPriceRateSyncMu 让定时任务与「立即同步」不会同时打源站。
	originalPriceRateSyncMu sync.Mutex
)

// exchangeRateAPIResponse 只取用得到的字段。result 在成功时为 "success"，
// 部分镜像会省略该字段，因此空值也按成功处理。
type exchangeRateAPIResponse struct {
	Result   string             `json:"result"`
	BaseCode string             `json:"base_code"`
	Rates    map[string]float64 `json:"rates"`
}

// StartOriginalPriceRateSync 启动按配置间隔拉取 USD→CNY 汇率的后台任务。
// 与其它周期性任务一致：只有主节点执行，避免多实例重复写同一个选项。
func StartOriginalPriceRateSync() {
	originalPriceRateSyncOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ctx := context.Background()
			logger.LogInfo(ctx, common.LogText("original price rate sync task started"))
			runOriginalPriceRateSyncOnce(ctx)
			for {
				// 每轮重新读间隔，管理员改了配置下一轮就生效，不必重启。
				timer := time.NewTimer(time.Duration(original_price_setting.SyncInterval()) * time.Hour)
				<-timer.C
				runOriginalPriceRateSyncOnce(ctx)
			}
		})
	})
}

// SyncOriginalPriceRateNow 立即拉取一次汇率，供管理端「立即同步」按钮使用。
// 即使自动同步被关闭，手动触发也会执行。
func SyncOriginalPriceRateNow(ctx context.Context) (original_price_setting.RateState, error) {
	return syncOriginalPriceRate(ctx, true)
}

func runOriginalPriceRateSyncOnce(ctx context.Context) {
	if _, err := syncOriginalPriceRate(ctx, false); err != nil {
		logger.LogWarn(ctx, common.LogText("original price rate sync failed: %v", err))
	}
}

func syncOriginalPriceRate(ctx context.Context, manual bool) (original_price_setting.RateState, error) {
	setting := original_price_setting.GetSetting()
	if !manual && !setting.SyncEnabled {
		return original_price_setting.GetRateState(), nil
	}

	originalPriceRateSyncMu.Lock()
	defer originalPriceRateSyncMu.Unlock()

	endpoint, err := original_price_setting.LatestRatesURL(setting.SyncBaseURL)
	if err != nil {
		recordOriginalPriceRateError(endpoint, err)
		return original_price_setting.GetRateState(), err
	}
	rate, err := fetchUSDCNYRate(ctx, endpoint)
	if err != nil {
		recordOriginalPriceRateError(endpoint, err)
		return original_price_setting.GetRateState(), err
	}
	values := map[string]string{
		originalPriceRateValueKey:     strconv.FormatFloat(rate, 'f', -1, 64),
		originalPriceRateUpdatedAtKey: strconv.FormatInt(common.GetTimestamp(), 10),
		originalPriceRateSourceKey:    endpoint,
		originalPriceRateErrorKey:     "",
	}
	if err := model.UpdateOptionsBulk(values); err != nil {
		return original_price_setting.GetRateState(), err
	}
	logger.LogInfo(ctx, common.LogText("original price rate synced: 1 USD = %g CNY from %s", rate, endpoint))
	return original_price_setting.GetRateState(), nil
}

// recordOriginalPriceRateError 把失败原因写回选项，让管理端能看到最后一次失败，
// 而不是只有服务器日志。写入失败只上日志，不再掩盖原始错误。
func recordOriginalPriceRateError(endpoint string, syncErr error) {
	message := syncErr.Error()
	if len(message) > 300 {
		message = message[:300]
	}
	values := map[string]string{originalPriceRateErrorKey: message}
	if endpoint != "" {
		values[originalPriceRateSourceKey] = endpoint
	}
	if err := model.UpdateOptionsBulk(values); err != nil {
		common.SysError(common.LogText("failed to record original price rate sync error: %v", err))
	}
}

func fetchUSDCNYRate(ctx context.Context, endpoint string) (float64, error) {
	reqCtx, cancel := context.WithTimeout(ctx, originalPriceRateFetchTimeout)
	defer cancel()

	request, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := GetHttpClient().Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("exchange rate endpoint returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, originalPriceRateMaxResponseBytes))
	if err != nil {
		return 0, err
	}
	return parseUSDCNYRate(body)
}

// parseUSDCNYRate 解析 ExchangeRate-API 的 v6 响应：
// {"result":"success","base_code":"USD","rates":{"CNY":6.68,...}}
func parseUSDCNYRate(body []byte) (float64, error) {
	var payload exchangeRateAPIResponse
	if err := common.Unmarshal(body, &payload); err != nil {
		return 0, fmt.Errorf("invalid exchange rate payload: %w", err)
	}
	if payload.Result != "" && payload.Result != "success" {
		return 0, fmt.Errorf("exchange rate endpoint reported %q", payload.Result)
	}
	if payload.BaseCode != "" && payload.BaseCode != "USD" {
		return 0, fmt.Errorf("exchange rate endpoint returned base currency %q", payload.BaseCode)
	}
	rate, ok := payload.Rates["CNY"]
	if !ok {
		return 0, errors.New("exchange rate payload has no CNY rate")
	}
	if err := original_price_setting.ValidateUSDCNYRate(rate); err != nil {
		return 0, err
	}
	return rate, nil
}
