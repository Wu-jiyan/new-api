package service

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	gachaRatingSyncInterval  = 24 * time.Hour
	gachaCardCleanupInterval = 10 * time.Minute
)

var (
	gachaTaskOnce    sync.Once
	gachaTaskRunning atomic.Bool
	gachaLastSyncAt  atomic.Int64
	gachaSyncCount   atomic.Int64
)

// StartGachaTasks 启动抽卡相关后台任务（DeepSWE 分级同步）。
// 抽卡权益是订阅，过期清理沿用订阅的 ExpireDueSubscriptions 定时任务。
func StartGachaTasks() {
	gachaTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ctx := context.Background()
			logger.LogInfo(ctx, "gacha tasks started")
			syncTicker := time.NewTicker(gachaRatingSyncInterval)
			defer syncTicker.Stop()
			runGachaRatingSyncOnce(ctx)
			for {
				select {
				case <-syncTicker.C:
					runGachaRatingSyncOnce(ctx)
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

// GetGachaRatingSyncStatus 返回同步状态（供管理端展示）。
func GetGachaRatingSyncStatus() (lastSync int64, count int64) {
	return gachaLastSyncAt.Load(), gachaSyncCount.Load()
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
