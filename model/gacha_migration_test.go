package model

// Temporary verification for the gacha-to-entitlement migration on all three
// supported engines. Run with GACHA_MIGRATION_POSTGRES_DSN /
// GACHA_MIGRATION_MYSQL_DSN set; SQLite always runs.

import (
	"os"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ---------------------------------------------------------------------------
// Legacy shapes (pre-change): model_name, no usable_models, no merge_count.
// ---------------------------------------------------------------------------

type legacyMigrationPlan struct {
	Id                      int      `gorm:"primaryKey"`
	Title                   string   `gorm:"type:varchar(128);not null"`
	PriceAmount             float64  `gorm:"type:decimal(10,6);not null;default:0"`
	Currency                string   `gorm:"type:varchar(8);not null;default:'USD'"`
	DurationUnit            string   `gorm:"type:varchar(16);not null;default:'month'"`
	DurationValue           int      `gorm:"type:int;not null;default:1"`
	CustomSeconds           int64    `gorm:"type:bigint;not null;default:0"`
	Enabled                 bool     `gorm:"default:true"`
	SortOrder               int      `gorm:"type:int;default:0"`
	MaxPurchasePerUser      int      `gorm:"type:int;default:0"`
	UpgradeGroup            string   `gorm:"type:varchar(64);default:''"`
	DowngradeGroup          string   `gorm:"type:varchar(64);default:''"`
	UsableGroups            []string `gorm:"type:text;serializer:json"`
	TotalAmount             int64    `gorm:"type:bigint;not null;default:0"`
	QuotaResetPeriod        string   `gorm:"type:varchar(16);default:'never'"`
	QuotaResetCustomSeconds int64    `gorm:"type:bigint;default:0"`
	CreatedAt               int64    `gorm:"bigint"`
	UpdatedAt               int64    `gorm:"bigint"`
}

func (legacyMigrationPlan) TableName() string { return "subscription_plans" }

type legacyMigrationSubscription struct {
	Id                  int      `gorm:"primaryKey"`
	UserId              int      `gorm:"index"`
	PlanId              int      `gorm:"index"`
	AmountTotal         int64    `gorm:"type:bigint;not null;default:0"`
	AmountUsed          int64    `gorm:"type:bigint;not null;default:0"`
	StartTime           int64    `gorm:"bigint"`
	EndTime             int64    `gorm:"bigint;index"`
	Status              string   `gorm:"type:varchar(32);index"`
	Source              string   `gorm:"type:varchar(32);default:'order'"`
	LastResetTime       int64    `gorm:"type:bigint;default:0"`
	NextResetTime       int64    `gorm:"type:bigint;default:0;index"`
	UpgradeGroup        string   `gorm:"type:varchar(64);default:''"`
	PrevUserGroup       string   `gorm:"type:varchar(64);default:''"`
	DowngradeGroup      string   `gorm:"type:varchar(64);default:''"`
	UsableGroups        []string `gorm:"type:text;serializer:json"`
	AllowWalletOverflow bool
	CreatedAt           int64 `gorm:"bigint"`
	UpdatedAt           int64 `gorm:"bigint"`
}

func (legacyMigrationSubscription) TableName() string { return "user_subscriptions" }

type legacyMigrationEntry struct {
	Id         int    `gorm:"primaryKey"`
	PoolId     int    `gorm:"index;not null"`
	ModelName  string `gorm:"size:128;not null"`
	Group      string `gorm:"size:64;not null"`
	Weight     int    `gorm:"not null"`
	Quota      int64  `gorm:"not null"`
	QuotaMin   int64  `gorm:"default:0"`
	QuotaMax   int64  `gorm:"default:0"`
	ExpireDays int    `gorm:"default:0"`
}

func (legacyMigrationEntry) TableName() string { return "gacha_card_entries" }

// ---------------------------------------------------------------------------

func TestGachaMigrationMatrix(t *testing.T) {
	sqlitePath := t.TempDir() + "/migration.db"
	require.NoError(t, verifyGachaMigration(t, "sqlite", sqlitePath, func() gorm.Dialector {
		return sqlite.Open(sqlitePath)
	}))

	if dsn := os.Getenv("GACHA_MIGRATION_MYSQL_DSN"); dsn != "" {
		require.NoError(t, verifyGachaMigration(t, "mysql", dsn, func() gorm.Dialector {
			return mysql.Open(dsn)
		}))
	} else {
		t.Log("skip mysql: GACHA_MIGRATION_MYSQL_DSN not set")
	}

	if dsn := os.Getenv("GACHA_MIGRATION_POSTGRES_DSN"); dsn != "" {
		require.NoError(t, verifyGachaMigration(t, "postgres", dsn, func() gorm.Dialector {
			return postgres.Open(dsn)
		}))
	} else {
		t.Log("skip postgres: GACHA_MIGRATION_POSTGRES_DSN not set")
	}
}

func verifyGachaMigration(t *testing.T, engine string, dsn string, dialector func() gorm.Dialector) error {
	t.Helper()
	db, err := gorm.Open(dialector(), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err, "%s: open", engine)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	require.NoError(t, db.Migrator().DropTable(
		&GachaCardEntry{}, &UserSubscription{}, &SubscriptionPlan{},
	), "%s: drop", engine)

	// 1. Legacy schema with real rows.
	require.NoError(t, db.AutoMigrate(
		&legacyMigrationPlan{}, &legacyMigrationSubscription{}, &legacyMigrationEntry{},
	), "%s: legacy automigrate", engine)
	// Let the database assign primary keys so auto-increment sequences stay
	// consistent for rows created after the upgrade.
	legacyPlan := legacyMigrationPlan{Title: "legacy plan", TotalAmount: 100}
	require.NoError(t, db.Create(&legacyPlan).Error)
	legacySub := legacyMigrationSubscription{
		UserId: 1, PlanId: legacyPlan.Id, AmountTotal: 100, AmountUsed: 40,
		Status: "active", Source: "order", UsableGroups: []string{"vip"},
		StartTime: 1, EndTime: time.Now().Add(time.Hour).Unix(),
	}
	require.NoError(t, db.Create(&legacySub).Error)
	legacyEntry := legacyMigrationEntry{
		PoolId: 1, ModelName: "legacy-model", Group: "default", Weight: 1, Quota: 100,
	}
	require.NoError(t, db.Create(&legacyEntry).Error)

	// 2. Upgrade: the startup path renames the legacy column first, then
	// AutoMigrate adds the subscription columns.
	require.NoError(t, migrateGachaEntryModelsColumn(db), "%s: rename model_name", engine)
	require.NoError(t, db.AutoMigrate(
		&SubscriptionPlan{}, &UserSubscription{}, &GachaCardEntry{},
	), "%s: upgrade automigrate", engine)

	assert.True(t, db.Migrator().HasColumn(&UserSubscription{}, "usable_models"), "%s: usable_models column", engine)
	assert.True(t, db.Migrator().HasColumn(&UserSubscription{}, "merge_count"), "%s: merge_count column", engine)
	assert.True(t, db.Migrator().HasColumn(&SubscriptionPlan{}, "usable_models"), "%s: plan usable_models column", engine)
	assert.True(t, db.Migrator().HasColumn(&GachaCardEntry{}, "models"), "%s: models column", engine)

	// 3. Legacy rows survive and read back unrestricted.
	var sub UserSubscription
	require.NoError(t, db.First(&sub, legacySub.Id).Error, "%s: read subscription", engine)
	assert.EqualValues(t, 100, sub.AmountTotal, "%s: amount_total preserved", engine)
	assert.EqualValues(t, 40, sub.AmountUsed, "%s: amount_used preserved", engine)
	assert.Equal(t, []string{"vip"}, sub.UsableGroups, "%s: usable_groups preserved", engine)
	assert.Empty(t, sub.UsableModels, "%s: legacy rows are unrestricted", engine)
	assert.Equal(t, 0, sub.MergeCount, "%s: legacy merge_count is zero", engine)

	var plan SubscriptionPlan
	require.NoError(t, db.First(&plan, legacyPlan.Id).Error, "%s: read plan", engine)
	assert.Empty(t, plan.UsableModels, "%s: legacy plan is unrestricted", engine)

	// 4. A second startup is a no-op.
	require.NoError(t, migrateGachaEntryModelsColumn(db), "%s: rename is idempotent", engine)
	require.NoError(t, db.AutoMigrate(
		&SubscriptionPlan{}, &UserSubscription{}, &GachaCardEntry{},
	), "%s: idempotent automigrate", engine)

	// 5. New columns round-trip, including the JSON serializer and gacha merge.
	granted := UserSubscription{
		UserId: 1, PlanId: 0, AmountTotal: 500, Status: "active", Source: GachaSubscriptionSource,
		UsableModels: []string{"gpt-5", "claude-x"}, UsableGroups: []string{"vip"},
		MergeCount: 3, AllowWalletOverflow: true,
		StartTime: time.Now().Unix(), EndTime: time.Now().Add(time.Hour).Unix(),
	}
	require.NoError(t, db.Create(&granted).Error, "%s: create grant", engine)

	var stored UserSubscription
	require.NoError(t, db.First(&stored, granted.Id).Error, "%s: read grant", engine)
	assert.Equal(t, []string{"gpt-5", "claude-x"}, stored.UsableModels, "%s: usable_models round-trip", engine)
	assert.Equal(t, 3, stored.MergeCount, "%s: merge_count round-trip", engine)
	assert.True(t, SubscriptionUsableModelsAllow(stored.UsableModels, "gpt-5"), "%s: covered model", engine)
	assert.False(t, SubscriptionUsableModelsAllow(stored.UsableModels, "other"), "%s: uncovered model", engine)

	entry := GachaCardEntry{
		PoolId: 1, Models: "gpt-5,claude-x", Group: "default", Weight: 2, Quota: 200, ExpireDays: 30,
	}
	require.NoError(t, db.Create(&entry).Error, "%s: create entry", engine)
	var storedEntry GachaCardEntry
	require.NoError(t, db.First(&storedEntry, entry.Id).Error, "%s: read entry", engine)
	assert.Equal(t, []string{"gpt-5", "claude-x"}, EntryModelList(storedEntry), "%s: models round-trip", engine)

	t.Logf("%s: migration verified", engine)
	return nil
}
