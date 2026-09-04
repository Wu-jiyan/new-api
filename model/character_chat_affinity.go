package model

import "github.com/QuantumNous/new-api/common"

const (
	MaxAffinityDeltaPerMessage = 3  // 单次建议值 clamp 边界
	MaxAffinityDeltaPerHour    = 10 // 近 1 小时累计净变化护栏
)

// ClampAffinityDelta 将单次建议 delta 限幅到 [-3, 3]
func ClampAffinityDelta(delta int) int {
	if delta > MaxAffinityDeltaPerMessage {
		return MaxAffinityDeltaPerMessage
	}
	if delta < -MaxAffinityDeltaPerMessage {
		return -MaxAffinityDeltaPerMessage
	}
	return delta
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// ApplyCharacterAffinityDelta 应用好感变化：clamp → 小时护栏 → GainAffinity（0-100 封顶）。
// 返回实际应用的 delta（0 = 未应用：建议为 0 / 护栏丢弃 / 进度缺失）。
func ApplyCharacterAffinityDelta(sessionId int, userId int, modelName string, delta int, now int64) (int, error) {
	d := ClampAffinityDelta(delta)
	if d == 0 {
		return 0, nil
	}
	hourSum, err := HourlyAffinityDeltaSum(sessionId, now)
	if err != nil {
		return 0, err
	}
	if absInt(hourSum+d) > MaxAffinityDeltaPerHour {
		return 0, nil // 护栏：超限静默丢弃
	}
	if err := GainAffinity(userId, modelName, d); err != nil {
		return 0, err
	}
	return d, nil
}

var _ = common.GetTimestamp // 保留 common 引用（与 touchSession 使用对齐）
