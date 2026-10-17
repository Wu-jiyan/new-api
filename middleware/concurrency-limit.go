package middleware

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

const modelConcurrencyRedisNamespace = "concurrencyLimit:v1"

// modelConcurrencySlotTTL bounds how long a slot leaked by a crashed process can
// keep blocking a user. It must stay well above the longest relay timeout
// (STREAMING_TIMEOUT / proxy_read_timeout): a key that expires while its request
// is still running is re-created by the next acquisition, so the in-flight count
// can only drift below the configured cap, never wedge it shut.
const modelConcurrencySlotTTL = 30 * time.Minute

// The acquire script is atomic so two replicas cannot both take the last slot.
// The expiry is refreshed on every acquisition: the key only has to outlive a
// single request, not the whole burst of traffic using the user's quota.
const modelConcurrencyAcquireScript = `
local current = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`

// The release script clamps at zero so a slot whose key already expired cannot
// push the counter negative and hand the user extra slots.
const modelConcurrencyReleaseScript = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then
  redis.call('DEL', KEYS[1])
  return 0
end
return redis.call('DECR', KEYS[1])
`

// memoryConcurrencyLimiter counts in-flight requests per user for single-instance
// deployments without Redis. Entries are removed as soon as the count returns to
// zero, so an idle user costs no memory.
var memoryConcurrencyLimiter = struct {
	mu       sync.Mutex
	inFlight map[int]int
}{inFlight: make(map[int]int)}

func modelConcurrencyRedisKey(userID int) string {
	return fmt.Sprintf("%s:user:%d", modelConcurrencyRedisNamespace, userID)
}

// acquireUserConcurrencySlot reserves one in-flight slot for userID. release is
// nil when no slot was available; err reports an unusable limiter backend.
func acquireUserConcurrencySlot(ctx context.Context, userID int, limit int) (release func(), ok bool, err error) {
	if common.RedisEnabled && common.RDB != nil {
		return acquireRedisUserConcurrencySlot(ctx, userID, limit)
	}
	return acquireMemoryUserConcurrencySlot(userID, limit)
}

func acquireRedisUserConcurrencySlot(ctx context.Context, userID int, limit int) (func(), bool, error) {
	key := modelConcurrencyRedisKey(userID)
	allowed, err := common.RDB.Eval(
		ctx,
		modelConcurrencyAcquireScript,
		[]string{key},
		limit,
		modelConcurrencySlotTTL.Milliseconds(),
	).Int64()
	if err != nil {
		return nil, false, err
	}
	if allowed != 1 {
		return nil, false, nil
	}
	return func() {
		if err := common.RDB.Eval(context.Background(), modelConcurrencyReleaseScript, []string{key}).Err(); err != nil {
			logger.LogError(context.Background(), common.LogText("failed to release concurrency slot (key=%s): %v", key, err))
		}
	}, true, nil
}

func acquireMemoryUserConcurrencySlot(userID int, limit int) (func(), bool, error) {
	memoryConcurrencyLimiter.mu.Lock()
	defer memoryConcurrencyLimiter.mu.Unlock()

	if memoryConcurrencyLimiter.inFlight[userID] >= limit {
		return nil, false, nil
	}
	memoryConcurrencyLimiter.inFlight[userID]++
	return func() { releaseMemoryUserConcurrencySlot(userID) }, true, nil
}

func releaseMemoryUserConcurrencySlot(userID int) {
	memoryConcurrencyLimiter.mu.Lock()
	defer memoryConcurrencyLimiter.mu.Unlock()

	if memoryConcurrencyLimiter.inFlight[userID] <= 1 {
		delete(memoryConcurrencyLimiter.inFlight, userID)
		return
	}
	memoryConcurrencyLimiter.inFlight[userID]--
}

// groupConcurrencyLimit resolves the cap for the request's group: a group entry
// overrides the global per-user limit, and 0 means unlimited.
func groupConcurrencyLimit(c *gin.Context) int {
	group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
	if group == "" {
		group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	}
	if limit, found := setting.GetGroupConcurrencyLimit(group); found {
		return limit
	}
	return setting.ModelRequestConcurrencyLimit
}

// ModelRequestConcurrencyLimit bounds how many relay requests a single user may
// keep running upstream at the same time. ModelRequestRateLimit only counts
// requests per time window, so a client that fans out hundreds of generations at
// once stays under it while still exhausting the gateway's bandwidth; this
// limiter is what stops that, and it rejects with 429 so clients back off
// instead of retrying a 5xx.
func ModelRequestConcurrencyLimit() func(c *gin.Context) {
	return func(c *gin.Context) {
		if !setting.ModelRequestConcurrencyLimitEnabled {
			c.Next()
			return
		}
		limit := groupConcurrencyLimit(c)
		if limit <= 0 {
			c.Next()
			return
		}

		release, ok, err := acquireUserConcurrencySlot(c.Request.Context(), c.GetInt("id"), limit)
		if err != nil {
			// A limiter backend outage must not become a relay outage.
			logger.LogError(c.Request.Context(), common.LogText("concurrency limit check failed: %v", err))
			c.Next()
			return
		}
		if !ok {
			c.Header("Retry-After", "1")
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgConcurrencyLimitReached, map[string]any{"Max": limit}))
			return
		}

		defer release()
		c.Next()
	}
}
