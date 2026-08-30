package model

import (
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// escapeLike 转义 LIKE 模式中的通配符，使 model_name 作为字面前缀匹配。
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// GetUserCharacterUsage 聚合用户对某模型的累计成功调用统计。
// 角色 model_name 为前缀（如 deepseek），统计其名下所有模型（deepseek-chat、deepseek-reasoner…）的调用。
// 统计源：logs 表（LOG_DB）中 LogTypeConsume 记录，token = prompt + completion。
func GetUserCharacterUsage(userId int, modelName string) (tokens int64, calls int64, err error) {
	var row struct {
		TotalTokens int64
		TotalCalls  int64
	}
	err = LOG_DB.Table("logs").
		Select("COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) as total_tokens, count(*) as total_calls").
		Where("user_id = ? AND model_name LIKE ? ESCAPE '\\' AND type = ?", userId, escapeLike(modelName)+"%", LogTypeConsume).
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
	maxStage := -1
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
		// 新记录：直接采用本次计算结果（-1 表示从未调用、未解锁）
		p.MaxStage = maxStage
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
