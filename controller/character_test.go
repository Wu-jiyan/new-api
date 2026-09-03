package controller

import (
	"encoding/json"
	"fmt"
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

func setupCharacterUserRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	rg := r.Group("/api/character")
	rg.Use(func(c *gin.Context) { c.Set("id", 424250) }) // mock UserAuth
	{
		rg.GET("/characters", ListCharacters)
		rg.GET("/:modelName", GetCharacter)
		rg.GET("/:modelName/script/:stageIndex", GetCharacterScript)
		rg.POST("/:modelName/unlock", UnlockCharacter)
	}
	return r
}

// setupCharacterUserTestDB 初始化内存 SQLite 作为 model.DB（仿照 setupCharacterAdminTestDB 的惯例）
func setupCharacterUserTestDB(t *testing.T) {
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

func TestUserGetCharacterScriptLocked(t *testing.T) {
	setupCharacterUserTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{}))
	model.DB.Where("model_name = ?", "char-lock-model").Delete(&model.Character{})
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", "char-lock-model").Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", 424250, "char-lock-model").Delete(&model.UserCharacterProgress{})
	})

	ch := &model.Character{ModelName: "char-lock-model", DisplayName: "锁角色"}
	stages := model.CharacterStages{Stages: []model.CharacterStage{
		{Index: 0, Name: "初遇", UnlockTokens: 0},
		{Index: 1, Name: "同行", UnlockTokens: 10000000, Script: []model.CharacterScript{{Speaker: "A", Text: "第二章台词"}}},
	}}
	require.NoError(t, ch.SetStages(stages))
	require.NoError(t, model.DB.Create(ch).Error)

	r := setupCharacterUserRouter()

	// 未调用过 -> 阶段0，剧本阶段1 应 403
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/character/char-lock-model/script/1", nil))
	require.Equal(t, http.StatusForbidden, w.Code)

	// 写入真实调用日志（阶段1 阈值 10M tokens）使其达标
	now := common.GetTimestamp()
	for i := 0; i < 3; i++ {
		require.NoError(t, model.LOG_DB.Create(&model.Log{
			UserId: 424250, ModelName: "char-lock-model", Type: model.LogTypeConsume,
			PromptTokens: 4000000, CompletionTokens: 0, CreatedAt: now,
		}).Error)
	}
	model.ClearCharacterUsageCache()

	// 达标后不会自动解锁 -> script/1 仍 403
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/character/char-lock-model/script/1", nil))
	require.Equal(t, http.StatusForbidden, w.Code)

	postUnlock := func(stage int) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/character/char-lock-model/unlock",
			strings.NewReader(fmt.Sprintf(`{"stage": %d}`, stage)))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w
	}
	require.Contains(t, postUnlock(0).Body.String(), `"success":true`)
	require.Contains(t, postUnlock(1).Body.String(), `"success":true`)

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/character/char-lock-model/script/1", nil))
	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Success bool                     `json:"success"`
		Data    []model.CharacterScript `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Len(t, resp.Data, 1)
}

func TestUserUnlockCharacterAffinityGate(t *testing.T) {
	setupCharacterUserTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}, &model.UserCharacterProgress{}, &model.Log{}))
	const (
		modelName = "char-aff-model"
		uid       = 424251
	)
	ch := &model.Character{ModelName: modelName, DisplayName: "好感角色", AffinityRequired: 85}
	require.NoError(t, ch.SetStages(model.CharacterStages{Stages: []model.CharacterStage{
		{Index: 0, Name: "初遇", UnlockTokens: 0},
	}}))
	require.NoError(t, model.DB.Create(ch).Error)
	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", uid, modelName).Delete(&model.UserCharacterProgress{})
		model.LOG_DB.Where("user_id = ? AND model_name = ?", uid, modelName).Delete(&model.Log{})
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	rg := r.Group("/api/character")
	rg.Use(func(c *gin.Context) { c.Set("id", uid) })
	rg.POST("/:modelName/unlock", UnlockCharacter)

	postUnlock := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/character/%s/unlock", modelName),
			strings.NewReader(`{"stage": 0}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		return w
	}

	require.Contains(t, postUnlock().Body.String(), "解锁条件未满足") // 从未调用

	require.NoError(t, model.LOG_DB.Create(&model.Log{
		UserId: uid, ModelName: modelName, Type: model.LogTypeConsume,
		PromptTokens: 100, CompletionTokens: 0, CreatedAt: common.GetTimestamp(),
	}).Error)
	model.ClearCharacterUsageCache()

	require.Contains(t, postUnlock().Body.String(), "解锁条件未满足") // 好感 0 < 85

	require.NoError(t, model.DB.Model(&model.UserCharacterProgress{}).
		Where("user_id = ? AND model_name = ?", uid, modelName).
		Updates(map[string]interface{}{"affinity": 90}).Error)
	w := postUnlock()
	require.Contains(t, w.Body.String(), `"success":true`)
	require.Contains(t, w.Body.String(), `"max_stage":0`)
}
