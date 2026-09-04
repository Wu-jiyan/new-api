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

// migrateCharacterChatTables 迁移角色对话链路所需全部表
func migrateCharacterChatTables(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{},
		&model.Log{}, &model.CharacterBackground{},
		&model.CharacterChatSession{}, &model.CharacterChatMessage{}))
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

// unlockStage0 手动解锁阶段 0（新状态机下 max_stage 仅由手动解锁推进）
func unlockStage0(t *testing.T, userId int, modelName string) {
	t.Helper()
	var ch model.Character
	require.NoError(t, model.DB.Where("model_name = ?", modelName).First(&ch).Error)
	state, err := model.GetUserCharacterState(userId, &ch)
	require.NoError(t, err)
	_, err = model.UnlockUserCharacterStage(userId, modelName, state, ch.AffinityRequired, ch.Stages(), 0)
	require.NoError(t, err)
}

func TestCharacterChatCharacterNotFound(t *testing.T) {
	setupCharacterChatTestDB(t)
	migrateCharacterChatTables(t)

	r := setupCharacterChatRouter(424260)
	req := httptest.NewRequest(http.MethodPost, "/api/character/ghost-model/chat",
		strings.NewReader(`{"content":"hi"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusNotFound, w.Code)
	require.Contains(t, w.Body.String(), "角色不存在")
}

func TestCharacterChatLocked(t *testing.T) {
	setupCharacterChatTestDB(t)
	migrateCharacterChatTables(t)
	createChatCharacter(t, "char-chat-locked", "你是观测者")
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", "char-chat-locked").Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", 424261, "char-chat-locked").Delete(&model.UserCharacterProgress{})
	})

	r := setupCharacterChatRouter(424261)
	// 该用户从未调用过该模型 -> 403
	req := httptest.NewRequest(http.MethodPost, "/api/character/char-chat-locked/chat",
		strings.NewReader(`{"content":"hi"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusForbidden, w.Code)
	require.Contains(t, w.Body.String(), "该角色尚未解锁")
}

func TestCharacterChatForward(t *testing.T) {
	setupCharacterChatTestDB(t)
	migrateCharacterChatTables(t)
	const (
		modelName    = "char-chat-open"
		userId       = 424262
		systemPrompt = "你是观测者，请回答用户问题"
	)
	createChatCharacter(t, modelName, systemPrompt)
	insertConsumeLog(t, userId, modelName) // 已调用过（达标）
	unlockStage0(t, userId, modelName)     // 手动解锁阶段 0 -> 可对话
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
	})

	// 替换包级转发函数，捕获上游请求并返回模拟 SSE 响应
	var captured struct {
		url        string
		body       []byte
		authHeader string
		cookies    []*http.Cookie
	}
	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, src *http.Request, body []byte) (*http.Response, error) {
		captured.url = url
		captured.body = body
		captured.authHeader = src.Header.Get("Authorization")
		captured.cookies = src.Cookies()
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body:       io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n")),
		}, nil
	}
	t.Cleanup(func() { characterChatForward = origForward })

	r := setupCharacterChatRouter(userId)
	reqBody := `{"content":"你好"}`
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat", strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-dashboard-token")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "text/event-stream", w.Header().Get("Content-Type"))
	require.Contains(t, w.Body.String(), "[DONE]")

	// 上游 URL 指向本实例 /pg/chat/completions
	require.Equal(t, fmt.Sprintf("http://127.0.0.1:%d/pg/chat/completions", *common.Port), captured.url)
	// Authorization header 与会话 cookie 透传（保证内部转发认证通过）
	require.Equal(t, "Bearer test-dashboard-token", captured.authHeader)
	require.NotNil(t, captured.cookies)

	// 请求体构造正确：model = 角色 ModelName、system 含人设、user 原文紧随其后、stream=true
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
	require.Contains(t, forwarded.Messages[0]["content"], systemPrompt)
	require.Equal(t, "user", forwarded.Messages[1]["role"])
	require.Equal(t, "你好", forwarded.Messages[1]["content"])
}

func TestCharacterChatUpstreamError(t *testing.T) {
	setupCharacterChatTestDB(t)
	migrateCharacterChatTables(t)
	const (
		modelName = "char-chat-err"
		userId    = 424263
	)
	createChatCharacter(t, modelName, "人设")
	insertConsumeLog(t, userId, modelName)
	unlockStage0(t, userId, modelName)
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
	})

	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, src *http.Request, body []byte) (*http.Response, error) {
		return nil, fmt.Errorf("connection refused")
	}
	t.Cleanup(func() { characterChatForward = origForward })

	r := setupCharacterChatRouter(userId)
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat",
		strings.NewReader(`{"content":"hi"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusBadGateway, w.Code)
}

func TestCharacterChatPersistsSessionAndMessages(t *testing.T) {
	setupCharacterChatTestDB(t)
	migrateCharacterChatTables(t)
	const (
		modelName = "char-chat-persist"
		userId    = 424270
	)
	createChatCharacter(t, modelName, "你是观测者")
	insertConsumeLog(t, userId, modelName)
	unlockStage0(t, userId, modelName)
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
		model.DB.Where("user_id = ?", userId).Delete(&model.CharacterChatSession{})
	})

	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, src *http.Request, body []byte) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body: io.NopCloser(strings.NewReader(
				"data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"reply\\\":\\\"你好呀\\\",\\\"pose\\\":\\\"happy\\\"}\"}}]}\n\ndata: [DONE]\n\n")),
		}, nil
	}
	t.Cleanup(func() { characterChatForward = origForward })

	r := setupCharacterChatRouter(userId)
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat",
		strings.NewReader(`{"content":"你好"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var sess model.CharacterChatSession
	require.NoError(t, model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&sess).Error)
	require.Equal(t, 2, sess.MessageCount)
	var msgs []model.CharacterChatMessage
	require.NoError(t, model.DB.Where("session_id = ?", sess.Id).Order("id ASC").Find(&msgs).Error)
	require.Len(t, msgs, 2)
	require.Equal(t, "user", msgs[0].Role)
	require.Equal(t, "你好", msgs[0].Content)
	require.Equal(t, "assistant", msgs[1].Role)
	require.Equal(t, "你好呀", msgs[1].Content) // 解析后的纯台词入库
	require.Equal(t, "happy", msgs[1].Pose)
}

func TestCharacterChatAppliesAffinity(t *testing.T) {
	setupCharacterChatTestDB(t)
	migrateCharacterChatTables(t)
	const (
		modelName = "char-chat-affinity"
		userId    = 424271
	)
	createChatCharacter(t, modelName, "你是观测者")
	insertConsumeLog(t, userId, modelName)
	unlockStage0(t, userId, modelName)
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
		model.DB.Where("user_id = ?", userId).Delete(&model.CharacterChatSession{})
	})
	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, src *http.Request, body []byte) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body: io.NopCloser(strings.NewReader(
				"data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"reply\\\":\\\"太好了\\\",\\\"affinity_delta\\\":3}\"}}]}\n\ndata: [DONE]\n\n")),
		}, nil
	}
	t.Cleanup(func() { characterChatForward = origForward })
	r := setupCharacterChatRouter(userId)
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat",
		strings.NewReader(`{"content":"约好咯"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	var sess model.CharacterChatSession
	require.NoError(t, model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&sess).Error)
	var am model.CharacterChatMessage
	require.NoError(t, model.DB.Where("session_id = ? AND role = ?", sess.Id, "assistant").First(&am).Error)
	require.Equal(t, 3, am.AffinityDelta)
	var p model.UserCharacterProgress
	require.NoError(t, model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&p).Error)
	require.Equal(t, 3, p.Affinity)
}

func TestExtractNonStreamContent(t *testing.T) {
	// 非流式 OpenAI 响应体取 choices[0].message.content
	body := `{"choices":[{"message":{"role":"assistant","content":"摘要文本"}}]}`
	got, ok := extractNonStreamContent(body)
	require.True(t, ok)
	require.Equal(t, "摘要文本", got)
	_, ok2 := extractNonStreamContent("oops")
	require.False(t, ok2)
}

func TestCharacterChatFromStoryBuildsInitialContext(t *testing.T) {
	setupCharacterChatTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{},
		&model.CharacterBackground{}, &model.CharacterChatSession{}, &model.CharacterChatMessage{}))
	const (
		modelName = "char-chat-story"
		userId    = 424272
	)
	ch := &model.Character{ModelName: modelName, DisplayName: "剧情角色", SystemPrompt: "你是她", Enabled: true}
	stages := model.CharacterStages{Stages: []model.CharacterStage{
		{Index: 0, Name: "初遇", UnlockTokens: 0,
			Script: []model.CharacterScript{
				{Speaker: "她", Text: "欢迎来到我的机房。"},
				{Speaker: "她", Text: "今晚一起看星星吧。"},
			}},
	}}
	require.NoError(t, ch.SetStages(stages))
	require.NoError(t, model.DB.Create(ch).Error)
	insertConsumeLog(t, userId, modelName)
	unlockStage0(t, userId, modelName)
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
		model.DB.Where("user_id = ?", userId).Delete(&model.CharacterChatSession{})
	})

	// 两次上游调用：先非流式剧情压缩，再流式主对话
	call := 0
	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, src *http.Request, body []byte) (*http.Response, error) {
		call++
		if call == 1 {
			// 剧情压缩（stream=false）
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}},
				Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"你在机房遇到了一位少女，她邀你一同观星。"}}]}`))}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}},
			Body: io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"reply\\\":\\\"来吧，今晚的星空正好。\\\"}\"}}]}\n\ndata: [DONE]\n\n"))}, nil
	}
	t.Cleanup(func() { characterChatForward = origForward })

	r := setupCharacterChatRouter(userId)
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat",
		strings.NewReader(`{"from_story":true,"stage_index":0}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, 2, call) // 剧情压缩 + 主对话

	var sess model.CharacterChatSession
	require.NoError(t, model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&sess).Error)
	require.Contains(t, sess.InitialContext, "机房")
	require.Equal(t, 2, sess.MessageCount) // 开场白 user + assistant
	var first model.CharacterChatMessage
	require.NoError(t, model.DB.Where("session_id = ? AND role = ?", sess.Id, "user").Order("id ASC").First(&first).Error)
	require.Contains(t, first.Content, "初遇") // 模板开场白
}

func TestCharacterChatTriggersSummary(t *testing.T) {
	setupCharacterChatTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{},
		&model.CharacterBackground{}, &model.CharacterChatSession{}, &model.CharacterChatMessage{}))
	const (
		modelName = "char-chat-summary"
		userId    = 424273
	)
	createChatCharacter(t, modelName, "你是观测者")
	insertConsumeLog(t, userId, modelName)
	unlockStage0(t, userId, modelName)
	sess, err := model.GetOrCreateCharacterChatSession(userId, modelName, 0)
	require.NoError(t, err)
	// 预置 61 条历史（summary_through 0 -> 差值 61 >= 60）
	for i := 0; i < 61; i++ {
		_, err := model.AddCharacterChatUserMessage(sess, fmt.Sprintf("历史消息%d", i))
		require.NoError(t, err)
		_, err = model.AddCharacterChatAssistantMessage(sess, fmt.Sprintf("回复%d", i), model.CharacterChatVisual{}, 0)
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", userId, modelName).Delete(&model.Log{})
		model.DB.Where("user_id = ?", userId).Delete(&model.CharacterChatSession{})
	})
	call := 0
	origForward := characterChatForward
	characterChatForward = func(ctx context.Context, url string, src *http.Request, body []byte) (*http.Response, error) {
		call++
		if call == 1 { // 主对话 SSE
			return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}},
				Body: io.NopCloser(strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"reply\\\":\\\"记得我们聊过观星\\\"}\"}}]}\n\ndata: [DONE]\n\n"))}, nil
		}
		// 摘要调用（stream=false）
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"你们一起看过星星。"}}]}`))}, nil
	}
	t.Cleanup(func() { characterChatForward = origForward })
	r := setupCharacterChatRouter(userId)
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/chat", strings.NewReader(`{"content":"再聊聊"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, 2, call)
	var latest model.CharacterChatSession
	require.NoError(t, model.DB.Where("user_id = ? AND model_name = ?", userId, modelName).First(&latest).Error)
	require.Contains(t, latest.Summary, "星星")
	require.Equal(t, latest.MessageCount, latest.SummaryThrough)
}
