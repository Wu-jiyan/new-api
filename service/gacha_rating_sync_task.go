package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	modelRatingSyncInterval  = 24 * time.Hour
	gachaCardCleanupInterval = 10 * time.Minute
)

// errAAApiKeyMissing 表示尚未配置 Artificial Analysis API Key。
var errAAApiKeyMissing = errors.New("artificial analysis api key is not configured")

var (
	gachaTaskOnce    sync.Once
	gachaTaskRunning atomic.Bool
	gachaLastSyncAt  atomic.Int64
	gachaSyncCount   atomic.Int64

	aaLastSyncAt atomic.Int64
	aaSyncCount  atomic.Int64
	aaSyncError  atomic.Value
)

// StartGachaTasks 启动抽卡相关后台任务（模型评分同步）。
// 抽卡权益是订阅，过期清理沿用订阅的 ExpireDueSubscriptions 定时任务。
func StartGachaTasks() {
	gachaTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ctx := context.Background()
			logger.LogInfo(ctx, "gacha tasks started")
			syncTicker := time.NewTicker(modelRatingSyncInterval)
			defer syncTicker.Stop()
			runGachaRatingSyncOnce(ctx)
			runAARatingSyncOnce(ctx)
			for {
				select {
				case <-syncTicker.C:
					runGachaRatingSyncOnce(ctx)
					runAARatingSyncOnce(ctx)
				case <-ctx.Done():
					return
				}
			}
		})
	})
}

func runGachaRatingSyncOnce(ctx context.Context) {
	if !gachaTaskRunning.CompareAndSwap(false, true) {
		return
	}
	defer gachaTaskRunning.Store(false)
	scores, err := model.FetchDeepSweLeaderboard()
	if err != nil {
		logger.LogWarn(ctx, "deepswe sync failed: "+err.Error())
		return
	}
	n, err := model.ApplyDeepSweScores(scores)
	if err != nil {
		logger.LogWarn(ctx, "deepswe apply failed: "+err.Error())
		return
	}
	gachaLastSyncAt.Store(time.Now().Unix())
	gachaSyncCount.Store(int64(n))
	logger.LogInfo(ctx, "deepswe rating sync done")
}

// runAARatingSyncOnce 同步 Artificial Analysis 三个维度。未配置 API key 时
// 直接跳过，不作为故障处理；拉取或写入失败只记录，不影响 DeepSWE 与其他功能。
func runAARatingSyncOnce(ctx context.Context) {
	if strings.TrimSpace(AAApiKey()) == "" {
		logger.LogInfo(ctx, "aa rating sync skipped: api key not configured")
		return
	}
	scores, err := model.FetchAAScores(AAApiKey())
	if err != nil {
		aaSyncError.Store(err.Error())
		logger.LogWarn(ctx, "aa sync failed: "+err.Error())
		return
	}
	res, err := model.ApplyAAScores(scores)
	if err != nil {
		aaSyncError.Store(err.Error())
		logger.LogWarn(ctx, "aa apply failed: "+err.Error())
		return
	}
	aaSyncError.Store("")
	aaLastSyncAt.Store(time.Now().Unix())
	aaSyncCount.Store(int64(res.Updated))
	logger.LogInfo(ctx, "aa rating sync done")
}

// AAApiKey 读取配置中的 Artificial Analysis API Key。
func AAApiKey() string {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return strings.TrimSpace(common.OptionMap[common.OptionKeyAAApiKey])
}

// GetGachaRatingSyncStatus 返回同步状态（供管理端展示）。
func GetGachaRatingSyncStatus() (lastSync int64, count int64) {
	return gachaLastSyncAt.Load(), gachaSyncCount.Load()
}

// AARatingSyncStatus 返回 AA 同步状态（供管理端展示）。
// apiKeyConfigured=false 时前端应引导去配置，而不是显示为同步失败。
func AARatingSyncStatus() (lastSync int64, updated int64, apiKeyConfigured bool, lastError string) {
	// atomic.Value 在首次 Store 之前 Load 返回 nil，类型断言必须用两值形式。
	lastErr, _ := aaSyncError.Load().(string)
	return aaLastSyncAt.Load(), aaSyncCount.Load(), AAApiKey() != "", lastErr
}

// SyncDeepSweRatingsNow 手动触发一次同步（管理端按钮），返回同步详情。
func SyncDeepSweRatingsNow() (*model.GachaRatingSyncResult, error) {
	scores, err := model.FetchDeepSweLeaderboard()
	if err != nil {
		return nil, err
	}
	res, err := model.ApplyDeepSweScoresDetailed(scores)
	if err == nil {
		gachaLastSyncAt.Store(time.Now().Unix())
		gachaSyncCount.Store(int64(res.Updated))
	}
	return res, err
}

// SyncAARatingsNow 手动触发一次 AA 同步（管理端按钮），返回同步详情。
func SyncAARatingsNow() (*model.AASyncResult, error) {
	if AAApiKey() == "" {
		return nil, errAAApiKeyMissing
	}
	scores, err := model.FetchAAScores(AAApiKey())
	if err != nil {
		aaSyncError.Store(err.Error())
		return nil, err
	}
	res, err := model.ApplyAAScores(scores)
	if err != nil {
		aaSyncError.Store(err.Error())
		return nil, err
	}
	aaSyncError.Store("")
	aaLastSyncAt.Store(time.Now().Unix())
	aaSyncCount.Store(int64(res.Updated))
	return res, nil
}
