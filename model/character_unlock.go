package model

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
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

// ClearCharacterUsageCache 清空解锁统计内存缓存（测试用，避免跨用例脏缓存）。
func ClearCharacterUsageCache() {
	usageCacheLock.Lock()
	usageCache = make(map[usageCacheKey]usageCacheItem)
	usageCacheLock.Unlock()
}

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
// 从未调用（calls<1）时强制回写 -1（未解锁），以修复历史脏数据（旧版本曾把未解锁误记为 0）。
func RefreshUserCharacterProgress(userId int, modelName string, tokens int64, calls int64, stages CharacterStages) (int, error) {
	maxStage := -1
	if calls >= 1 {
		for i := range stages.Stages {
			st := stages.Stages[i]
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
	}

	var p UserCharacterProgress
	err := DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&p).Error
	if err != nil {
		p = UserCharacterProgress{UserID: userId, ModelName: modelName}
	}
	if calls < 1 {
		// 从未调用：必定未解锁，强制回写（清理历史误解锁数据）
		p.MaxStage = -1
		p.LastUnlockAt = 0
	} else if maxStage > p.MaxStage {
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

// GainAffinity 增加用户对该角色的好感，封顶 100、下限 0。
// 占位框架：当前无调用方，待剧情选择/聊天互动玩法接入后启用。
func GainAffinity(userId int, modelName string, delta int) error {
	var p UserCharacterProgress
	err := DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("user character progress not found: %s", modelName)
	}
	if err != nil {
		return err
	}
	affinity := p.Affinity + delta
	if affinity > 100 {
		affinity = 100
	}
	if affinity < 0 {
		affinity = 0
	}
	return DB.Model(&UserCharacterProgress{}).Where("id = ?", p.Id).
		Updates(map[string]interface{}{"affinity": affinity, "updated_at": common.GetTimestamp()}).Error
}
