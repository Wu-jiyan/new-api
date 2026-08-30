package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupCharacterAdminRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	rg := r.Group("/api/character/admin")
	rg.Use(func(c *gin.Context) { c.Set("id", 1); c.Set("role", 100) }) // mock AdminAuth
	{
		rg.GET("/characters", AdminListCharacters)
		rg.POST("/characters", AdminCreateCharacter)
		rg.PUT("/characters/:id", AdminUpdateCharacter)
		rg.DELETE("/characters/:id", AdminDeleteCharacter)
		rg.PUT("/thresholds", AdminUpdateCharacterThresholds)
	}
	return r
}

// setupCharacterAdminTestDB 初始化内存 SQLite 作为 model.DB（参考 controller 包其他测试的惯例）
func setupCharacterAdminTestDB(t *testing.T) {
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

func TestAdminCharacterCRUD(t *testing.T) {
	setupCharacterAdminTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Character{}))
	model.DB.Where("model_name = ?", "char-crud-model").Delete(&model.Character{})
	t.Cleanup(func() { model.DB.Where("model_name = ?", "char-crud-model").Delete(&model.Character{}) })

	r := setupCharacterAdminRouter()

	body, _ := json.Marshal(map[string]interface{}{
		"model_name": "char-crud-model", "display_name": "测试角色", "title": "观测者",
		"description": "人设", "tags": "推理系", "enabled": true,
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/character/admin/characters", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Id        int    `json:"id"`
			ModelName string `json:"model_name"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Equal(t, "char-crud-model", resp.Data.ModelName)
	require.Greater(t, resp.Data.Id, 0)

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/character/admin/characters", nil))
	require.Equal(t, http.StatusOK, w.Code)
	require.Contains(t, w.Body.String(), "char-crud-model")

	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/character/admin/characters/"+strconv.Itoa(resp.Data.Id), nil))
	require.Equal(t, http.StatusOK, w.Code)
	require.Contains(t, w.Body.String(), `"success":true`)
}
