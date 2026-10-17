package setting

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// maxRateLimitDurationSeconds is the largest window the count cap is computed
// against (24h). Token-bucket capacity is count*duration; this keeps that
// product inside int64 when the window is at most a day.
const maxRateLimitDurationSeconds = 24 * 60 * 60

// maxModelRequestRateLimitCount is math.MaxInt64 / maxRateLimitDurationSeconds.
// It is the largest count that cannot overflow int64(count)*duration for a
// window of at most 24 hours.
const maxModelRequestRateLimitCount int64 = math.MaxInt64 / maxRateLimitDurationSeconds

// maxModelRequestConcurrencyLimit bounds the per-user in-flight request cap so a
// mistyped value cannot turn the limiter into a permanent ban.
const maxModelRequestConcurrencyLimit = 100000

var ModelRequestRateLimitEnabled = false
var ModelRequestRateLimitDurationMinutes = 1
var ModelRequestRateLimitCount = 0
var ModelRequestRateLimitSuccessCount = 1000
var ModelRequestRateLimitGroup = map[string][2]int{}
var ModelRequestRateLimitMutex sync.RWMutex

// ModelRequestConcurrencyLimitEnabled turns the per-user in-flight request cap
// on; ModelRequestConcurrencyLimit is the cap applied to every user unless a
// group below overrides it. 0 means unlimited.
var ModelRequestConcurrencyLimitEnabled = false
var ModelRequestConcurrencyLimit = 0
var ModelRequestConcurrencyLimitGroup = map[string]int{}
var ModelRequestConcurrencyLimitMutex sync.RWMutex

func ModelRequestRateLimitGroup2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitGroup)
	if err != nil {
		common.SysLog(common.LogText("error marshalling model ratio: %s", err.Error()))
	}
	return string(jsonBytes)
}

func UpdateModelRequestRateLimitGroupByJSONString(jsonStr string) error {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	ModelRequestRateLimitGroup = make(map[string][2]int)
	return common.Unmarshal([]byte(jsonStr), &ModelRequestRateLimitGroup)
}

func GetGroupRateLimit(group string) (totalCount, successCount int, found bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	if ModelRequestRateLimitGroup == nil {
		return 0, 0, false
	}

	limits, found := ModelRequestRateLimitGroup[group]
	if !found {
		return 0, 0, false
	}
	return limits[0], limits[1], true
}

func CheckModelRequestRateLimitGroup(jsonStr string) error {
	checkModelRequestRateLimitGroup := make(map[string][2]int)
	err := common.Unmarshal([]byte(jsonStr), &checkModelRequestRateLimitGroup)
	if err != nil {
		return err
	}
	for group, limits := range checkModelRequestRateLimitGroup {
		if limits[0] < 0 || limits[1] < 1 {
			return fmt.Errorf("group %s has negative rate limit values: [%d, %d]", group, limits[0], limits[1])
		}
		if int64(limits[0]) > maxModelRequestRateLimitCount || int64(limits[1]) > maxModelRequestRateLimitCount {
			return fmt.Errorf("group %s [%d, %d] exceeds max rate limit %d", group, limits[0], limits[1], maxModelRequestRateLimitCount)
		}
	}

	return nil
}

func ModelRequestConcurrencyLimitGroup2JSONString() string {
	ModelRequestConcurrencyLimitMutex.RLock()
	defer ModelRequestConcurrencyLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestConcurrencyLimitGroup)
	if err != nil {
		common.SysLog(common.LogText("error marshalling model request concurrency limit group: %s", err.Error()))
	}
	return string(jsonBytes)
}

func UpdateModelRequestConcurrencyLimitGroupByJSONString(jsonStr string) error {
	limits := make(map[string]int)
	if strings.TrimSpace(jsonStr) != "" {
		if err := common.Unmarshal([]byte(jsonStr), &limits); err != nil {
			return err
		}
	}

	ModelRequestConcurrencyLimitMutex.Lock()
	defer ModelRequestConcurrencyLimitMutex.Unlock()
	ModelRequestConcurrencyLimitGroup = limits
	return nil
}

func GetGroupConcurrencyLimit(group string) (limit int, found bool) {
	ModelRequestConcurrencyLimitMutex.RLock()
	defer ModelRequestConcurrencyLimitMutex.RUnlock()

	limit, found = ModelRequestConcurrencyLimitGroup[group]
	return limit, found
}

func CheckModelRequestConcurrencyLimitGroup(jsonStr string) error {
	if strings.TrimSpace(jsonStr) == "" {
		return nil
	}
	limits := make(map[string]int)
	if err := common.Unmarshal([]byte(jsonStr), &limits); err != nil {
		return err
	}
	for group, limit := range limits {
		if limit < 0 || limit > maxModelRequestConcurrencyLimit {
			return fmt.Errorf("group %s concurrency limit must be between 0 and %d", group, maxModelRequestConcurrencyLimit)
		}
	}

	return nil
}

func ValidateModelRequestConcurrencyLimit(value string) error {
	limit, err := strconv.Atoi(value)
	if err != nil || limit < 0 || limit > maxModelRequestConcurrencyLimit {
		return fmt.Errorf("model request concurrency limit must be between 0 and %d", maxModelRequestConcurrencyLimit)
	}
	return nil
}
