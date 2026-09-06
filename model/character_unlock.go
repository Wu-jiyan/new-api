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

// ClearCharacterUsageCacheEntry 清除单用户单前缀的用量缓存（计费后即时刷新统计）。
func ClearCharacterUsageCacheEntry(userId int, modelName string) {
	usageCacheLock.Lock()
	delete(usageCache, usageCacheKey{UserID: userId, ModelName: modelName})
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

// UserCharacterState 用户对某角色的解锁进度快照（达标判定输入）
type UserCharacterState struct {
	MaxStage int   // 已手动解锁最深阶段；未解锁为 -1
	Tokens   int64
	Calls    int64
	Affinity int
}

var (
	ErrUnlockStageNotFound = errors.New("character stage not found")
	ErrUnlockOutOfOrder    = errors.New("must unlock previous stage first")
	ErrUnlockNotEligible   = errors.New("character stage not eligible")
)

// GetUserCharacterState 聚合用户对某角色的进度并惰性刷新统计。
// 语义：MaxStage 仅由 UnlockUserCharacterStage 手动推进；从未调用（calls<1）强制回写 -1。
// 统计无变化时跳过写库（列表页高频调用，避免无谓 UPDATE）。
func GetUserCharacterState(userId int, ch *Character) (*UserCharacterState, error) {
	tokens, calls, err := getCachedUserUsage(userId, ch.ModelName)
	if err != nil {
		return nil, err
	}
	var p UserCharacterProgress
	err = DB.Where("user_id = ? AND model_name = ?", userId, ch.ModelName).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		p = UserCharacterProgress{UserID: userId, ModelName: ch.ModelName, MaxStage: -1}
		if err := DB.Create(&p).Error; err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	maxStage, lastUnlockAt := p.MaxStage, p.LastUnlockAt
	if calls < 1 {
		maxStage, lastUnlockAt = -1, 0
	}
	if p.TotalTokens == tokens && p.TotalCalls == calls &&
		p.MaxStage == maxStage && p.LastUnlockAt == lastUnlockAt {
		return &UserCharacterState{MaxStage: p.MaxStage, Tokens: tokens, Calls: calls, Affinity: p.Affinity}, nil
	}
	p.TotalTokens = tokens
	p.TotalCalls = calls
	p.MaxStage = maxStage
	p.LastUnlockAt = lastUnlockAt
	if err := DB.Model(&UserCharacterProgress{}).Where("id = ?", p.Id).
		Updates(map[string]interface{}{
			"total_tokens": p.TotalTokens, "total_calls": p.TotalCalls,
			"max_stage": p.MaxStage, "last_unlock_at": p.LastUnlockAt,
			"updated_at": common.GetTimestamp(),
		}).Error; err != nil {
		return nil, err
	}
	return &UserCharacterState{MaxStage: p.MaxStage, Tokens: tokens, Calls: calls, Affinity: p.Affinity}, nil
}

// IsStageEligible 判定单阶段是否达标（calls>=1 且 token/好感双门槛均满足，不含顺序约束）
func (s *UserCharacterState) IsStageEligible(st CharacterStage, characterAffinityRequired int) bool {
	if s.Calls < 1 {
		return false
	}
	if st.UnlockTokens > 0 && s.Tokens < st.UnlockTokens {
		return false
	}
	if s.Affinity < st.AffinityRequired || s.Affinity < characterAffinityRequired {
		return false
	}
	return true
}

// UnlockUserCharacterStage 顺序手动解锁：仅允许解锁 MaxStage+1 且达标的阶段，返回新 MaxStage。
func UnlockUserCharacterStage(userId int, modelName string, state *UserCharacterState,
	characterAffinityRequired int, stages CharacterStages, stageIdx int) (int, error) {
	if stageIdx < 0 || stageIdx >= len(stages.Stages) {
		return state.MaxStage, ErrUnlockStageNotFound
	}
	if stageIdx != state.MaxStage+1 {
		return state.MaxStage, ErrUnlockOutOfOrder
	}
	if !state.IsStageEligible(stages.Stages[stageIdx], characterAffinityRequired) {
		return state.MaxStage, ErrUnlockNotEligible
	}
	if err := DB.Model(&UserCharacterProgress{}).
		Where("user_id = ? AND model_name = ?", userId, modelName).
		Updates(map[string]interface{}{
			"max_stage": stageIdx, "last_unlock_at": common.GetTimestamp(),
			"updated_at": common.GetTimestamp(),
		}).Error; err != nil {
		return state.MaxStage, err
	}
	return stageIdx, nil
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
