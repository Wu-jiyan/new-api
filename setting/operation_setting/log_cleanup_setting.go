package operation_setting

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// 日志自动清理的保留上限，与 perf_metrics_setting.retention_days 同一语义：
// 0 表示不自动清理。
const (
	LogCleanupMaxRetentionDays  = 10 * 365
	LogCleanupMaxRetentionHours = LogCleanupMaxRetentionDays * 24
)

// LogCleanupSetting 控制使用日志的定时自动清理。管理员在系统设置中开启后，
// 主节点的 system task 调度器会按 IntervalLogCleanup 周期创建清理任务，
// 删除早于「当前时间 - RetentionDays」的日志行；关闭时仍可在系统设置中手动清理。
//
// 审计日志（AuditLog）是独立表，不受该保留策略影响。
type LogCleanupSetting struct {
	Enabled       bool `json:"enabled"`
	RetentionDays int  `json:"retention_days"`
}

var logCleanupSetting = LogCleanupSetting{
	Enabled:       false,
	RetentionDays: 0,
}

func init() {
	config.GlobalConfig.Register("log_cleanup_setting", &logCleanupSetting)
}

func GetLogCleanupSetting() *LogCleanupSetting {
	return &logCleanupSetting
}

// ValidateLogCleanupRetentionDays 约束保留天数：0 表示不自动清理，
// 上限 10 年，避免误填导致日志被一次性清空。
func ValidateLogCleanupRetentionDays(value string) error {
	days, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return errors.New("日志保留天数必须为整数")
	}
	if days < 0 || days > LogCleanupMaxRetentionDays {
		return errors.New("日志保留天数超出范围（0-" + strconv.Itoa(LogCleanupMaxRetentionDays) + " 天）")
	}
	return nil
}
