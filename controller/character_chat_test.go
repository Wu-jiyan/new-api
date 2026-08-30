package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupCharacterChatRouter(userId int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	rg := r.Group("/api/character")
	rg.Use(func(c *gin.Context) { c.Set("id", userId) }) // mock UserAuth
	{
		rg.POST("/:modelName/chat", CharacterChat)
	}
	return r
}

// setupCharacterChatTestDB 初始化内存 SQLite 作为 model.DB / model.LOG_DB
func setupCharacterChatTestDB(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite db: %v", err)
	}
	model.DB = db
	model.LOG_DB = db
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
}

// createChatCharacter 创建一个启用的测试角色
func createChatCharacter(t *testing.T, modelName string, systemPrompt string) {
	t.Helper()
	ch := &model.Character{ModelName: modelName, DisplayName: "对话角色", SystemPrompt: systemPrompt, Enabled: true}
	stages := model.CharacterStages{Stages: []model.CharacterStage{
		{Index: 0, Name: "初遇", UnlockTokens: 0},
	}}
	require.NoError(t, ch.SetStages(stages))
	require.NoError(t, model.DB.Create(ch).Error)
}

// insertConsumeLog 模拟用户已调用过该模型（解锁基础阶段）
func insertConsumeLog(t *testing.T, userId int, modelName string) {
	t.Helper()
	require.NoError(t, model.LOG_DB.Create(&model.Log{
		UserId:           userId,
		ModelName:        modelName,
		Type:             model.LogTypeConsume,
		PromptTokens:     100,
		CompletionTokens: 50,
		CreatedAt:        common.GetTimestamp(),
	}).Error)
}

func TestCharacterChatCharacterNotFound(t *testing.T) {
	setupCharacterChatTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{}))

	r := setupCharacterChatRouter(424260)
	req := httptest.NewRequest(http.MethodPost, "/api/character/ghost-model/chat",
		strings.NewReader(`{"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusNotFound, w.Code)
	require.Contains(t, w.Body.String(), "角色不存在")
}

func TestCharacterChatLocked(t *testing.T) {
	setupCharacterChatTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{}))
	createChatCharacter(t, "char-chat-locked", "你是观测者")
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", "char-chat-locked").Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", 424261, "char-chat-locked").Delete(&model.UserCharacterProgress{})
	})

	r := setupCharacterChatRouter(424261)
	// 该用户从未调用过该模型 -> 403
	req := httptest.NewRequest(http.MethodPost, "/api/character/char-chat-locked/chat",
		strings.NewReader(`{"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusForbidden, w.Code)
	require.Contains(t, w.Body.String(), "该角色尚未解锁")
}

func TestCharacterChatForward(t *testing.T) {
	setupCharacterChatTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{}))
	const (
		modelName    = "char-chat-open"
		userId       = 424262
		systemPrompt = "你是观测者，请回答用户问题"
	)
	createChatCharacter(t, modelName, systemPrompt)
	insertConsumeLog(t, userId, modelName) // 已调用过 -> 解锁
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
	})

	// 替换包级转发函数，捕获上游请求并返回模拟 SSE 响应
	var captured struct {
		url     string
		body    []byte
		cookies []*http.Cookie
	}
	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, cookies []*http.Cookie, body []byte) (*http.Response, error) {
		captured.url = url
		captured.body = body
		captured.cookies = cookies
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n")),
		}, nil
	}
	t.Cleanup(func() { characterChatForward = origForward })

	r := setupCharacterChatRouter(userId)
	reqBody := `{"messages":[{"role":"user","content":"你好"}],"stream":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "text/event-stream", w.Header().Get("Content-Type"))
	require.Contains(t, w.Body.String(), "[DONE]")

	// 上游 URL 指向本实例 /pg/chat/completions
	require.Equal(t, fmt.Sprintf("http://127.0.0.1:%d/pg/chat/completions", *common.Port), captured.url)
	// Cookie 透传（测试请求无 cookie，转发函数仍被调用且不 panic）
	require.NotNil(t, captured.cookies)

	// 请求体构造正确：model = 角色 ModelName、system prompt 插入头部、stream=true
	var forwarded struct {
		Model    string              `json:"model"`
		Messages []map[string]string `json:"messages"`
		Stream   bool                `json:"stream"`
	}
	require.NoError(t, json.Unmarshal(captured.body, &forwarded))
	require.Equal(t, modelName, forwarded.Model)
	require.True(t, forwarded.Stream)
	require.Len(t, forwarded.Messages, 2)
	require.Equal(t, "system", forwarded.Messages[0]["role"])
	require.Equal(t, systemPrompt, forwarded.Messages[0]["content"])
	require.Equal(t, "user", forwarded.Messages[1]["role"])
	require.Equal(t, "你好", forwarded.Messages[1]["content"])
}

func TestCharacterChatUpstreamError(t *testing.T) {
	setupCharacterChatTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{}))
	const (
		modelName = "char-chat-err"
		userId    = 424263
	)
	createChatCharacter(t, modelName, "人设")
	insertConsumeLog(t, userId, modelName)
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
	})

	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, cookies []*http.Cookie, body []byte) (*http.Response, error) {
		return nil, fmt.Errorf("connection refused")
	}
	t.Cleanup(func() { characterChatForward = origForward })

	r := setupCharacterChatRouter(userId)
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat",
		strings.NewReader(`{"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusBadGateway, w.Code)
}
