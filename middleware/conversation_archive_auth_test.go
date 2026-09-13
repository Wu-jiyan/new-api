package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupArchiveAuthTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousRedis := common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedis
		sqlDB, err := db.DB()
		if err == nil && sqlDB != nil {
			_ = sqlDB.Close()
		}
	})
}

func performArchiveAuthRequest(t *testing.T, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/conversation_archive/export", ConversationArchiveAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})
	req := httptest.NewRequest(http.MethodGet, "/api/conversation_archive/export", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func withArchivePullToken(t *testing.T, token string) {
	t.Helper()
	setting := operation_setting.GetConversationArchiveSetting()
	previous := setting.PullToken
	setting.PullToken = token
	t.Cleanup(func() { setting.PullToken = previous })
}

// TestConversationArchiveAuthDedicatedToken 验证专用拉取令牌可访问归档接口，
// 且令牌错误时不会绕过鉴权。
func TestConversationArchiveAuthDedicatedToken(t *testing.T) {
	setupArchiveAuthTestDB(t)
	const token = "d41f7c2b9e1a4f6d8c0b3e5a7d9f1c2b6e8a0d4f"
	withArchivePullToken(t, token)

	recorder := performArchiveAuthRequest(t, map[string]string{"Authorization": token})
	assert.Equal(t, http.StatusOK, recorder.Code)

	recorder = performArchiveAuthRequest(t, map[string]string{"Authorization": "Bearer " + token})
	assert.Equal(t, http.StatusOK, recorder.Code)

	recorder = performArchiveAuthRequest(t, map[string]string{"x-api-key": token})
	assert.Equal(t, http.StatusOK, recorder.Code)

	// 错误令牌不得放行，回退到管理员鉴权后被拒绝。
	recorder = performArchiveAuthRequest(t, map[string]string{"Authorization": token + "x"})
	assert.NotEqual(t, http.StatusOK, recorder.Code)

	recorder = performArchiveAuthRequest(t, nil)
	assert.NotEqual(t, http.StatusOK, recorder.Code)
}

// TestConversationArchiveAuthWithoutTokenFallsBackToAdmin 未配置专用令牌时
// 中间件必须完整回退到管理员鉴权（不能出现无认证直通）。
func TestConversationArchiveAuthWithoutTokenFallsBackToAdmin(t *testing.T) {
	setupArchiveAuthTestDB(t)
	withArchivePullToken(t, "")
	recorder := performArchiveAuthRequest(t, map[string]string{"Authorization": "anything-at-all-value"})
	require.NotEqual(t, http.StatusOK, recorder.Code)
}
