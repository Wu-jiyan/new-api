package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// useConcurrencySettings pins the relay concurrency settings for one test and
// restores them afterwards; the limiter reads the package globals per request.
func useConcurrencySettings(t *testing.T, enabled bool, limit int, groupsJSON string) {
	t.Helper()

	previousEnabled := setting.ModelRequestConcurrencyLimitEnabled
	previousLimit := setting.ModelRequestConcurrencyLimit
	previousGroups := setting.ModelRequestConcurrencyLimitGroup2JSONString()
	t.Cleanup(func() {
		setting.ModelRequestConcurrencyLimitEnabled = previousEnabled
		setting.ModelRequestConcurrencyLimit = previousLimit
		require.NoError(t, setting.UpdateModelRequestConcurrencyLimitGroupByJSONString(previousGroups))
	})

	setting.ModelRequestConcurrencyLimitEnabled = enabled
	setting.ModelRequestConcurrencyLimit = limit
	require.NoError(t, setting.UpdateModelRequestConcurrencyLimitGroupByJSONString(groupsJSON))
	resetMemoryConcurrencyLimiter()
}

func resetMemoryConcurrencyLimiter() {
	memoryConcurrencyLimiter.mu.Lock()
	defer memoryConcurrencyLimiter.mu.Unlock()
	memoryConcurrencyLimiter.inFlight = make(map[int]int)
}

// newConcurrencyTestRouter wires the limiter behind a stub that sets the
// authenticated user (and optional group), so a request can be parked inside the
// handler to model a request that is still running upstream.
func newConcurrencyTestRouter(userID int, group string, gate <-chan struct{}, entered chan<- struct{}) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", userID)
		if group != "" {
			common.SetContextKey(c, constant.ContextKeyTokenGroup, group)
		}
	})
	router.GET("/limited", ModelRequestConcurrencyLimit(), func(c *gin.Context) {
		if entered != nil {
			entered <- struct{}{}
		}
		<-gate
		c.Status(http.StatusNoContent)
	})
	return router
}

func waitForEntered(t *testing.T, entered <-chan struct{}) {
	t.Helper()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("request never reached the handler")
	}
}

// startParkedRequests keeps n requests inside the handler until gate closes.
func startParkedRequests(t *testing.T, router *gin.Engine, n int, gate chan struct{}, entered chan struct{}) *sync.WaitGroup {
	t.Helper()
	var running sync.WaitGroup
	for range n {
		running.Add(1)
		go func() {
			defer running.Done()
			router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/limited", nil))
		}()
		waitForEntered(t, entered)
	}
	return &running
}

func TestModelRequestConcurrencyLimitRejectsOverCapAndReusesReleasedSlot(t *testing.T) {
	require.NoError(t, i18n.Init())
	useConcurrencySettings(t, true, 2, "")

	gate := make(chan struct{})
	entered := make(chan struct{}, 4)
	router := newConcurrencyTestRouter(9101, "", gate, entered)
	running := startParkedRequests(t, router, 2, gate, entered)

	rejected := httptest.NewRecorder()
	router.ServeHTTP(rejected, httptest.NewRequest(http.MethodGet, "/limited", nil))
	require.Equal(t, http.StatusTooManyRequests, rejected.Code)
	assert.Equal(t, "1", rejected.Header().Get("Retry-After"))
	assert.Contains(t, rejected.Body.String(), `"type":"new_api_error"`)

	close(gate)
	running.Wait()

	// The finished requests must have returned their slots.
	accepted := httptest.NewRecorder()
	router.ServeHTTP(accepted, httptest.NewRequest(http.MethodGet, "/limited", nil))
	assert.Equal(t, http.StatusNoContent, accepted.Code)
}

func TestModelRequestConcurrencyLimitDisabledIgnoresInFlightCount(t *testing.T) {
	require.NoError(t, i18n.Init())
	useConcurrencySettings(t, false, 1, "")

	gate := make(chan struct{})
	entered := make(chan struct{}, 4)
	router := newConcurrencyTestRouter(9102, "", gate, entered)
	running := startParkedRequests(t, router, 3, gate, entered)

	close(gate)
	running.Wait()
}

func TestGroupConcurrencyLimitResolvesOverrideThenGlobal(t *testing.T) {
	useConcurrencySettings(t, true, 1, `{"vip": 0, "strict": 2}`)

	for _, test := range []struct {
		name  string
		group string
		want  int
	}{
		{name: "group entry wins", group: "strict", want: 2},
		{name: "zero means unlimited", group: "vip", want: 0},
		{name: "unknown group falls back to global", group: "default", want: 1},
		{name: "no group falls back to global", group: "", want: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			if test.group != "" {
				common.SetContextKey(c, constant.ContextKeyTokenGroup, test.group)
			}
			assert.Equal(t, test.want, groupConcurrencyLimit(c))
		})
	}
}

func TestModelRequestConcurrencyLimitHonorsUnlimitedGroupEndToEnd(t *testing.T) {
	require.NoError(t, i18n.Init())
	useConcurrencySettings(t, true, 1, `{"vip": 0}`)

	gate := make(chan struct{})
	entered := make(chan struct{}, 3)
	router := newConcurrencyTestRouter(9103, "vip", gate, entered)

	// The global cap is 1, but the vip group is unlimited, so both requests run.
	running := startParkedRequests(t, router, 2, gate, entered)
	close(gate)
	running.Wait()
}

func TestModelRequestConcurrencyLimitRedisSlotsExpire(t *testing.T) {
	redisServer, _ := useRateLimitMiniRedis(t)

	const userID = 9104
	release, ok, err := acquireUserConcurrencySlot(t.Context(), userID, 1)
	require.NoError(t, err)
	require.True(t, ok)

	_, ok, err = acquireUserConcurrencySlot(t.Context(), userID, 1)
	require.NoError(t, err)
	assert.False(t, ok, "the second in-flight request must exceed a cap of one")
	assert.Equal(t, modelConcurrencySlotTTL, redisServer.TTL(modelConcurrencyRedisKey(userID)))

	release()
	_, ok, err = acquireUserConcurrencySlot(t.Context(), userID, 1)
	require.NoError(t, err)
	require.True(t, ok, "a released slot must be reusable")
	release()

	// A slot leaked by a crashed process must not block the user forever.
	_, ok, err = acquireUserConcurrencySlot(t.Context(), userID, 1)
	require.NoError(t, err)
	require.True(t, ok)
	redisServer.FastForward(modelConcurrencySlotTTL + time.Second)
	_, ok, err = acquireUserConcurrencySlot(t.Context(), userID, 1)
	require.NoError(t, err)
	assert.True(t, ok, "an expired slot counter must not keep the user blocked")
}

func TestModelRequestConcurrencyLimitRedisSharesCapAcrossReplicas(t *testing.T) {
	useRateLimitMiniRedis(t)

	const userID = 9105
	release, ok, err := acquireUserConcurrencySlot(t.Context(), userID, 2)
	require.NoError(t, err)
	require.True(t, ok)
	defer release()

	// A second gateway replica increments the same Redis counter, so the cap
	// applies across instances rather than per process.
	_, ok, err = acquireUserConcurrencySlot(t.Context(), userID, 2)
	require.NoError(t, err)
	assert.True(t, ok)

	third, ok, err := acquireUserConcurrencySlot(t.Context(), userID, 2)
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Nil(t, third)
}
