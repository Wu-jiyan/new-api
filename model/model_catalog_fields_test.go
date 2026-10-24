package model

import (
	"math"
	"os"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestValidateModelModalities(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr string
	}{
		{name: "empty is unset", raw: ""},
		{name: "empty array", raw: "[]"},
		{name: "single known modality", raw: `["text"]`},
		{name: "all known modalities", raw: `["text","image","audio","video","file"]`},
		{name: "unknown modality is rejected", raw: `["text","hologram"]`, wantErr: "unsupported modality: hologram"},
		{name: "scalar instead of array is rejected", raw: `"text"`, wantErr: "modalities must be a JSON array"},
		{name: "object instead of array is rejected", raw: `{"a":1}`, wantErr: "modalities must be a JSON array"},
		{name: "malformed json is rejected", raw: `["text"`, wantErr: "modalities must be a JSON array"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateModelModalities(tc.raw)
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErr)
		})
	}
}

func TestParseModelModalities(t *testing.T) {
	assert.Nil(t, ParseModelModalities(""))
	assert.Equal(t, []string{"text", "image"}, ParseModelModalities(`["text","image"]`))
	// Reads must survive dirty legacy data instead of failing the whole page.
	assert.Nil(t, ParseModelModalities("not json"))
	assert.Nil(t, ParseModelModalities(`{"a":1}`))
}

func TestValidateCatalogFields(t *testing.T) {
	require.NoError(t, (&Model{ContextLength: 128000, MaxInputTokens: 128000, MaxOutputTokens: 8192,
		InputModalities: `["text","image"]`, OutputModalities: `["text"]`}).ValidateCatalogFields())

	// 0 means "not configured" everywhere and must stay valid.
	require.NoError(t, (&Model{}).ValidateCatalogFields())

	assert.Error(t, (&Model{ContextLength: -1}).ValidateCatalogFields())
	assert.Error(t, (&Model{MaxInputTokens: -1}).ValidateCatalogFields())
	assert.Error(t, (&Model{MaxOutputTokens: -1}).ValidateCatalogFields())
	assert.Error(t, (&Model{ContextLength: tokenLimitCeiling + 1}).ValidateCatalogFields())
	assert.Error(t, (&Model{InputModalities: `["nope"]`}).ValidateCatalogFields())
	assert.Error(t, (&Model{OutputModalities: `["nope"]`}).ValidateCatalogFields())
}

// Model.Update 用 Select 白名单限定 UPDATE 列。任何新加的展示字段如果漏进这个列表，
// PUT /api/models 会「成功」但值永远写不进去 —— 一个没有任何报错的数据丢失陷阱。
// 这个用例就是那个陷阱的回归护栏。
func TestModelCatalogFieldsPersistThroughUpdate(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&Model{}, &Option{}))

	created := &Model{ModelName: "catalog-fields-model", Status: 1, SyncOfficial: 0}
	require.NoError(t, created.Insert())
	t.Cleanup(func() { DB.Unscoped().Where("model_name = ?", "catalog-fields-model").Delete(&Model{}) })

	// 非法值必须在写入前就被拒绝，而不是落库后再被发现。
	rejected := &Model{Id: created.Id, ModelName: created.ModelName, InputModalities: `["telepathy"]`}
	assert.Error(t, rejected.Update())

	updated := &Model{
		Id:              created.Id,
		ModelName:       "catalog-fields-model",
		Status:          1,
		SyncOfficial:    0,
		ContextLength:   128000,
		MaxInputTokens:  128000,
		MaxOutputTokens: 8192,
		InputModalities: `["text","image"]`,
	}
	require.NoError(t, updated.Update())

	var reloaded Model
	require.NoError(t, DB.Unscoped().First(&reloaded, created.Id).Error)
	assert.Equal(t, 128000, reloaded.ContextLength)
	assert.Equal(t, 128000, reloaded.MaxInputTokens)
	assert.Equal(t, 8192, reloaded.MaxOutputTokens)
	assert.Equal(t, []string{"text", "image"}, ParseModelModalities(reloaded.InputModalities))

	// 显式清零必须能写进去：Select 的存在意义就是让 0 也能覆盖旧值。
	cleared := &Model{Id: created.Id, ModelName: "catalog-fields-model", Status: 1}
	require.NoError(t, cleared.Update())
	require.NoError(t, DB.Unscoped().First(&reloaded, created.Id).Error)
	assert.Zero(t, reloaded.ContextLength)
	assert.Empty(t, reloaded.InputModalities)
}

// 原价是纯展示基准：币种必须落在闭集内，填了金额就必须有币种，
// 否则前端算折扣时会把「没有币种」当成 USD 用，悄悄算出一个错的折扣。
func TestValidateOriginalPrice(t *testing.T) {
	tests := []struct {
		name    string
		model   Model
		wantErr string
	}{
		{name: "unset stays unset", model: Model{}},
		{name: "currency without amounts is allowed", model: Model{OriginalPriceCurrency: "USD"}},
		{
			name:  "usd amounts in usd",
			model: Model{OriginalPriceCurrency: "USD", OriginalPriceInput: 3, OriginalPriceOutput: 15},
		},
		{
			name:  "lowercase currency is normalized",
			model: Model{OriginalPriceCurrency: " cny ", OriginalPriceInput: 12},
		},
		{
			name:    "amount without currency is rejected",
			model:   Model{OriginalPriceInput: 12},
			wantErr: "original price currency is required",
		},
		{
			name:    "unknown currency is rejected",
			model:   Model{OriginalPriceCurrency: "EUR", OriginalPriceInput: 1},
			wantErr: "original price currency must be USD or CNY",
		},
		{
			name:    "negative amount is rejected",
			model:   Model{OriginalPriceCurrency: "CNY", OriginalPriceOutput: -1},
			wantErr: "cannot be negative",
		},
		{
			name:    "non-finite amount is rejected",
			model:   Model{OriginalPriceCurrency: "CNY", OriginalPriceCache: math.Inf(1)},
			wantErr: "must be a finite number",
		},
		{
			name:    "implausible amount is rejected",
			model:   Model{OriginalPriceCurrency: "CNY", OriginalPriceRequest: originalPriceCeiling + 1},
			wantErr: "implausibly large",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			model := tc.model
			err := model.ValidateOriginalPrice()
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErr)
		})
	}

	normalized := Model{OriginalPriceCurrency: " cny ", OriginalPriceInput: 12}
	require.NoError(t, normalized.ValidateOriginalPrice())
	assert.Equal(t, "CNY", normalized.OriginalPriceCurrency)
}

// Update 的 Select 白名单同样覆盖原价字段：漏进去就是无声丢数据。
func TestOriginalPricePersistsThroughUpdate(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&Model{}, &Option{}))

	created := &Model{ModelName: "original-price-model", Status: 1, SyncOfficial: 0}
	require.NoError(t, created.Insert())
	t.Cleanup(func() { DB.Unscoped().Where("model_name = ?", "original-price-model").Delete(&Model{}) })

	updated := &Model{
		Id:                      created.Id,
		ModelName:               "original-price-model",
		Status:                  1,
		SyncOfficial:            0,
		OriginalPriceCurrency:   "CNY",
		OriginalPriceInput:      12,
		OriginalPriceOutput:     32,
		OriginalPriceCache:      1.2,
		OriginalPriceCacheWrite: 15,
	}
	require.NoError(t, updated.Update())

	var reloaded Model
	require.NoError(t, DB.Unscoped().First(&reloaded, created.Id).Error)
	assert.Equal(t, "CNY", reloaded.OriginalPriceCurrency)
	assert.InDelta(t, 12.0, reloaded.OriginalPriceInput, 1e-9)
	assert.InDelta(t, 32.0, reloaded.OriginalPriceOutput, 1e-9)
	assert.InDelta(t, 1.2, reloaded.OriginalPriceCache, 1e-9)
	assert.InDelta(t, 15.0, reloaded.OriginalPriceCacheWrite, 1e-9)

	// 卡片只看原价：元信息里没有币种时不该出现在定价接口上。
	assert.Nil(t, buildPricingOriginalPrice(&Model{}))
	original := buildPricingOriginalPrice(&reloaded)
	require.NotNil(t, original)
	assert.Equal(t, "CNY", original.Currency)
	assert.InDelta(t, 12.0, original.Input, 1e-9)
}

// legacyModel 是「上一版」models 表的形状：有元信息与评分列，
// 没有原价列。用它模拟一台已经跑着旧版本、库里已经有数据的机器，
// 验证 AutoMigrate 能补列且不丢行。
type legacyModel struct {
	Id          int            `json:"id"`
	ModelName   string         `json:"model_name" gorm:"size:128;not null;uniqueIndex:uk_model_name_delete_at,priority:1"`
	Description string         `json:"description" gorm:"type:text"`
	Status      int            `json:"status" gorm:"default:1"`
	CreatedTime int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index;uniqueIndex:uk_model_name_delete_at,priority:2"`
}

func (legacyModel) TableName() string {
	return "orig_price_test_models"
}

// TestOriginalPriceColumnsDatabaseMatrix 守住三种数据库上的迁移行为：
// 旧表结构 + 已有数据升级时补出原价列、数据不丢、重复迁移幂等、值可往返。
// MySQL / PostgreSQL 通过 TEST_MYSQL_DSN / TEST_POSTGRES_DSN 注入真实实例，
// 没配置时跳过（与本仓库其它数据库矩阵用例一致）。
func TestOriginalPriceColumnsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dialector gorm.Dialector
			switch dialect {
			case "sqlite":
				dialector = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				dialector = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				dialector = postgres.Open(dsn)
			}
			db, err := gorm.Open(dialector, &gorm.Config{
				NamingStrategy: schema.NamingStrategy{TablePrefix: "orig_price_test_"},
			})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })

			dropTables := func() {
				assert.NoError(t, db.Migrator().DropTable(&Model{}, &legacyModel{}))
			}
			dropTables()
			t.Cleanup(dropTables)

			// 上一版表结构 + 一条业务数据。
			require.NoError(t, db.AutoMigrate(&legacyModel{}))
			require.NoError(t, db.Exec(
				"INSERT INTO orig_price_test_models (model_name, description, status) VALUES (?, ?, ?)",
				"legacy-model", "kept through upgrade", 1,
			).Error)

			// 旧库升级：补列；再跑一次证明幂等。
			require.NoError(t, db.AutoMigrate(&Model{}))
			require.NoError(t, db.AutoMigrate(&Model{}))

			for _, column := range []string{
				"original_price_currency", "original_price_input", "original_price_output",
				"original_price_cache", "original_price_cache_write", "original_price_request",
			} {
				assert.True(t, db.Migrator().HasColumn(&Model{}, column), "missing column %s on %s", column, dialect)
			}

			var legacy Model
			require.NoError(t, db.Table("orig_price_test_models").Where("model_name = ?", "legacy-model").First(&legacy).Error)
			assert.Equal(t, "kept through upgrade", legacy.Description)
			assert.Zero(t, legacy.OriginalPriceInput)

			require.NoError(t, db.Table("orig_price_test_models").Where("id = ?", legacy.Id).
				Updates(map[string]any{"original_price_currency": "CNY", "original_price_input": 12.5}).Error)
			var migrated Model
			require.NoError(t, db.Table("orig_price_test_models").Where("id = ?", legacy.Id).First(&migrated).Error)
			assert.Equal(t, "CNY", migrated.OriginalPriceCurrency)
			assert.InDelta(t, 12.5, migrated.OriginalPriceInput, 1e-9)
		})
	}
}
