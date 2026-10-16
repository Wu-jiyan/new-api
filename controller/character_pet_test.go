package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const petTestUserID = 424251

func setupCharacterPetRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	rg := r.Group("/api/character")
	rg.Use(func(c *gin.Context) { c.Set("id", petTestUserID) }) // mock UserAuth
	{
		rg.GET("/characters", ListCharacters)
		rg.POST("/pet", SetCharacterPet)
		rg.GET("/pet", GetCharacterPet)
		rg.GET("/pet/status", GetCharacterPetStatus)
		rg.POST("/:modelName/unlock", UnlockCharacter)
	}
	return r
}

// setupCharacterPetFixture 建用户 + 一个角色，返回 router。
// unlocked=false 时不写入调用记录，角色停留在未解锁状态。
func setupCharacterPetFixture(t *testing.T, modelName string, petImage string, unlocked bool) *gin.Engine {
	t.Helper()
	setupCharacterUserTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(
		&model.User{}, &model.Character{}, &model.UserCharacterProgress{}, &model.Log{},
	))

	require.NoError(t, model.DB.Create(&model.User{
		Id: petTestUserID, Username: "pet-user", Password: "x",
	}).Error)

	ch := &model.Character{
		ModelName:   modelName,
		DisplayName: "桌宠角色",
		PetImageURL: petImage,
		Enabled:     true,
	}
	require.NoError(t, ch.SetStages(model.CharacterStages{Stages: []model.CharacterStage{
		{Index: 0, Name: "初遇", UnlockTokens: 0, UnlockText: "首次调用该模型即可解锁基础立绘"},
	}}))
	require.NoError(t, model.DB.Create(ch).Error)

	t.Cleanup(func() {
		model.DB.Where("model_name = ?", modelName).Delete(&model.Character{})
		model.DB.Where("user_id = ? AND model_name = ?", petTestUserID, modelName).
			Delete(&model.UserCharacterProgress{})
		model.DB.Where("id = ?", petTestUserID).Delete(&model.User{})
	})

	if !unlocked {
		model.ClearCharacterUsageCache()
		return setupCharacterPetRouter()
	}

	require.NoError(t, model.LOG_DB.Create(&model.Log{
		UserId: petTestUserID, ModelName: modelName, Type: model.LogTypeConsume,
		PromptTokens: 100, CreatedAt: common.GetTimestamp(),
	}).Error)
	model.ClearCharacterUsageCache()

	r := setupCharacterPetRouter()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/character/"+modelName+"/unlock",
		strings.NewReader(`{"stage": 0}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	require.Contains(t, w.Body.String(), `"success":true`, "fixture setup must unlock stage 0")
	return r
}

// postPet 调用 SetCharacterPet 并解码响应；失败时保留服务端 message 供断言。
func postPet(t *testing.T, r *gin.Engine, modelName string) (bool, string, map[string]any) {
	t.Helper()
	w := httptest.NewRecorder()
	body := fmt.Sprintf(`{"model_name": %q}`, modelName)
	req := httptest.NewRequest(http.MethodPost, "/api/character/pet", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	var out struct {
		Success bool           `json:"success"`
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))
	return out.Success, out.Message, out.Data
}

func getPet(t *testing.T, r *gin.Engine) map[string]any {
	t.Helper()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/character/pet", nil))
	var out struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))
	require.True(t, out.Success)
	return out.Data
}

// 桌宠选择的三条业务规则：未解锁不可放置、无桌宠图不可放置、设置后可读回且能收回。
func TestCharacterPetSelectionLifecycle(t *testing.T) {
	const modelName = "char-pet-lifecycle"
	const petImage = "/uploads/characters/char-pet-lifecycle/pet/abc.png"

	t.Run("locked character cannot be placed", func(t *testing.T) {
		r := setupCharacterPetFixture(t, modelName, petImage, false)
		ok, message, _ := postPet(t, r, modelName)
		assert.False(t, ok, "a locked character must not become a desk pet")
		assert.NotEmpty(t, message, "rejection must explain why")
	})

	t.Run("character without pet image cannot be placed", func(t *testing.T) {
		r := setupCharacterPetFixture(t, modelName, "", true)
		ok, _, _ := postPet(t, r, modelName)
		assert.False(t, ok, "a character without a desk-pet image cannot be placed")
	})

	t.Run("unlocked character can be placed then removed", func(t *testing.T) {
		r := setupCharacterPetFixture(t, modelName, petImage, true)

		ok, _, data := postPet(t, r, modelName)
		require.True(t, ok, "unlocked character with a pet image must be placeable")
		assert.Equal(t, true, data["active"])
		assert.Equal(t, petImage, data["image_url"])
		assert.Equal(t, modelName, data["model_name"])

		// 读回必须与写入一致
		assert.Equal(t, petImage, getPet(t, r)["image_url"])

		// 收回桌宠，且要持久化
		ok, _, cleared := postPet(t, r, "")
		require.True(t, ok)
		assert.Equal(t, false, cleared["active"])
		assert.Equal(t, false, getPet(t, r)["active"], "clearing must persist across reads")
	})
}

// 未解锁角色不能通过角色接口看到桌宠图，否则未解锁素材等于公开。
func TestCharacterListHidesPetImageUntilUnlocked(t *testing.T) {
	const modelName = "char-pet-hidden"
	const petImage = "/uploads/characters/char-pet-hidden/pet/xyz.png"

	listPetImage := func(t *testing.T, r *gin.Engine) (any, bool) {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/character/characters", nil))
		var resp struct {
			Data []map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &resp))
		require.Len(t, resp.Data, 1)
		value, present := resp.Data[0]["pet_image_url"]
		return value, present
	}

	t.Run("locked character hides pet image", func(t *testing.T) {
		r := setupCharacterPetFixture(t, modelName, petImage, false)
		_, present := listPetImage(t, r)
		assert.False(t, present, "locked character must not expose pet_image_url")
	})

	t.Run("unlocked character exposes pet image", func(t *testing.T) {
		r := setupCharacterPetFixture(t, modelName, petImage, true)
		value, present := listPetImage(t, r)
		require.True(t, present, "unlocked character must expose pet_image_url")
		assert.Equal(t, petImage, value)
	})
}

// 桌宠提醒层只读当前用户自己的数据：额度、令牌、错误日志。
// 空列表是正常情况，所以「健康账户什么都不报」本身就是一条用例。
func TestCharacterPetStatus(t *testing.T) {
	setupCharacterUserTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Log{}))

	require.NoError(t, model.DB.Create(&model.User{
		Id: petTestUserID, Username: "pet-status", Password: "x", Quota: 1000,
	}).Error)
	t.Cleanup(func() {
		model.DB.Where("id = ?", petTestUserID).Delete(&model.User{})
		model.DB.Where("user_id = ?", petTestUserID).Delete(&model.Token{})
		model.LOG_DB.Where("user_id = ?", petTestUserID).Delete(&model.Log{})
	})

	r := setupCharacterPetRouter()

	status := func() []map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/character/pet/status", nil))
		var out struct {
			Success bool `json:"success"`
			Data    struct {
				Items []map[string]any `json:"items"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))
		require.True(t, out.Success)
		return out.Data.Items
	}
	reportedKeys := func(items []map[string]any) []string {
		out := make([]string, 0, len(items))
		for _, item := range items {
			if key, ok := item["key"].(string); ok {
				out = append(out, key)
			}
		}
		return out
	}
	setQuota := func(value int) {
		require.NoError(t, model.DB.Model(&model.User{}).
			Where("id = ?", petTestUserID).Update("quota", value).Error)
	}

	t.Run("healthy account reports nothing", func(t *testing.T) {
		assert.Empty(t, status())
	})

	t.Run("zero balance is reported as critical", func(t *testing.T) {
		setQuota(0)
		t.Cleanup(func() { setQuota(1000) })

		items := status()
		require.Len(t, items, 1)
		assert.Equal(t, "character.pet.status.quotaExhausted", items[0]["key"])
		assert.Equal(t, petSeverityCritical, items[0]["severity"])
	})

	t.Run("exhausted and expired keys are both counted", func(t *testing.T) {
		now := common.GetTimestamp()
		require.NoError(t, model.DB.Create(&model.Token{
			UserId: petTestUserID, Key: "sk-pet-empty", Name: "empty", Status: 1, RemainQuota: 0,
		}).Error)
		require.NoError(t, model.DB.Create(&model.Token{
			UserId: petTestUserID, Key: "sk-pet-expired", Name: "expired", Status: 1,
			UnlimitedQuota: true, ExpiredTime: now - 3600,
		}).Error)

		found := reportedKeys(status())
		assert.Contains(t, found, "character.pet.status.tokenExhausted")
		assert.Contains(t, found, "character.pet.status.tokenExpired")
	})

	t.Run("an unlimited token is never reported as exhausted", func(t *testing.T) {
		model.DB.Where("user_id = ?", petTestUserID).Delete(&model.Token{})
		require.NoError(t, model.DB.Create(&model.Token{
			UserId: petTestUserID, Key: "sk-pet-unlimited", Name: "unlimited",
			Status: 1, UnlimitedQuota: true, ExpiredTime: -1,
		}).Error)

		assert.NotContains(t, reportedKeys(status()), "character.pet.status.tokenExhausted")
	})

	t.Run("a burst of errors is reported", func(t *testing.T) {
		now := common.GetTimestamp()
		for range errorBurstThreshold {
			require.NoError(t, model.LOG_DB.Create(&model.Log{
				UserId: petTestUserID, Type: model.LogTypeError, CreatedAt: now,
			}).Error)
		}
		assert.Contains(t, reportedKeys(status()), "character.pet.status.errorBurst")
	})

	t.Run("errors older than the window are ignored", func(t *testing.T) {
		model.LOG_DB.Where("user_id = ?", petTestUserID).Delete(&model.Log{})
		require.NoError(t, model.LOG_DB.Create(&model.Log{
			UserId: petTestUserID, Type: model.LogTypeError,
			CreatedAt: common.GetTimestamp() - int64(errorBurstWindow/time.Second) - 60,
		}).Error)

		assert.NotContains(t, reportedKeys(status()), "character.pet.status.errorBurst")
	})
}
