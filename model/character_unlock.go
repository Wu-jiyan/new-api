package model

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// GetUserCharacterUsage 聚合用户对某模型的累计成功调用统计。
// 统计源：logs 表（LOG_DB）中 LogTypeConsume 记录，token = prompt + completion。
func GetUserCharacterUsage(userId int, modelName string) (tokens int64, calls int64, err error) {
	var row struct {
		TotalTokens int64
		TotalCalls  int64
	}
	err = LOG_DB.Table("logs").
		Select("COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) as total_tokens, count(*) as total_calls").
		Where("user_id = ? AND model_name = ? AND type = ?", userId, modelName, LogTypeConsume).
		Scan(&row).Error
	if err != nil {
		return 0, 0, err
	}
	return row.TotalTokens, row.TotalCalls, nil
}

// usageCacheKey 解锁统计内存缓存键
type usageCacheKey struct {
	UserID    int
	ModelName string
}

type usageCacheItem struct {
	Tokens   int64
	Calls    int64
	ExpireAt time.Time
}

var (
	usageCache     = make(map[usageCacheKey]usageCacheItem)
	usageCacheLock = sync.Mutex{}
)

const usageCacheTTL = 3 * time.Minute

// getCachedUserUsage 带缓存的用量查询
func getCachedUserUsage(userId int, modelName string) (int64, int64, error) {
	key := usageCacheKey{UserID: userId, ModelName: modelName}
	now := time.Now()
	usageCacheLock.Lock()
	if it, ok := usageCache[key]; ok && it.ExpireAt.After(now) {
		usageCacheLock.Unlock()
		return it.Tokens, it.Calls, nil
	}
	usageCacheLock.Unlock()

	tokens, calls, err := GetUserCharacterUsage(userId, modelName)
	if err != nil {
		return 0, 0, err
	}
	usageCacheLock.Lock()
	usageCache[key] = usageCacheItem{Tokens: tokens, Calls: calls, ExpireAt: now.Add(usageCacheTTL)}
	usageCacheLock.Unlock()
	return tokens, calls, nil
}

// RefreshUserCharacterProgress 计算用户对某模型的最新解锁阶段并持久化，返回最新 MaxStage。
// 规则：阶段①（unlock_tokens=0）只要 calls>=1 即解锁；其余阶段 tokens >= unlock_tokens 且 calls>=1。
// 进度只升不降。
func RefreshUserCharacterProgress(userId int, modelName string, tokens int64, calls int64, stages CharacterStages) (int, error) {
	maxStage := 0
	for i := range stages.Stages {
		st := stages.Stages[i]
		if calls < 1 {
			break
		}
		if st.UnlockTokens <= 0 {
			maxStage = i
			continue
		}
		if tokens >= st.UnlockTokens {
			maxStage = i
			continue
		}
		break // 阈值递增，命中不了更高阶段
	}

	var p UserCharacterProgress
	err := DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&p).Error
	if err != nil {
		p = UserCharacterProgress{UserID: userId, ModelName: modelName}
	}
	if maxStage > p.MaxStage {
		p.MaxStage = maxStage
		p.LastUnlockAt = common.GetTimestamp()
	}
	p.TotalTokens = tokens
	p.TotalCalls = calls
	p.UpdatedAt = common.GetTimestamp()
	if p.Id == 0 {
		return p.MaxStage, DB.Create(&p).Error
	}
	return p.MaxStage, DB.Model(&UserCharacterProgress{}).Where("id = ?", p.Id).
		Updates(map[string]interface{}{
			"total_tokens": p.TotalTokens, "total_calls": p.TotalCalls,
			"max_stage": p.MaxStage, "last_unlock_at": p.LastUnlockAt, "updated_at": p.UpdatedAt,
		}).Error
}

// GetUserCharacterStage 用户视角的角色解锁阶段（带缓存聚合，惰性刷新）。
func GetUserCharacterStage(userId int, modelName string, stages CharacterStages) (int, int64, int64, error) {
	tokens, calls, err := getCachedUserUsage(userId, modelName)
	if err != nil {
		return 0, 0, 0, err
	}
	maxStage, err := RefreshUserCharacterProgress(userId, modelName, tokens, calls, stages)
	return maxStage, tokens, calls, err
}
