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

	// 写入进度：阶段1 已解锁（首次请求已生成 MaxStage=0 进度记录，先删除避免唯一索引冲突）
	model.DB.Where("user_id = ? AND model_name = ?", 424250, "char-lock-model").Delete(&model.UserCharacterProgress{})
	require.NoError(t, model.DB.Create(&model.UserCharacterProgress{
		UserID: 424250, ModelName: "char-lock-model", TotalTokens: 12000000, TotalCalls: 3, MaxStage: 1,
	}).Error)

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
