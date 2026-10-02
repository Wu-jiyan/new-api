package model

import (
	"context"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSubscriptionGroupTransitionsPreserveAuthVersionAndSessions(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)
	now := time.Now().Unix()
	user := User{
		Username:    "subscription-auth-user",
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, CreateUserSession(&UserSession{
		SID:             "subscription-auth-session",
		UserID:          user.Id,
		Version:         1,
		UserAuthVersion: 1,
		Status:          UserSessionStatusActive,
		RefreshHash:     "refresh-hash",
		LoginMethod:     "password",
		LastActiveAt:    now,
		ExpiresAt:       now + 3600,
	}))
	require.NoError(t, populateUserCache(user))
	plan := &SubscriptionPlan{
		Title:         "Upgraded",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   100,
		UpgradeGroup:  "pro",
		Enabled:       true,
	}
	require.NoError(t, DB.Create(plan).Error)

	subscription, err := CreateUserSubscriptionFromPlanTx(DB, user.Id, plan, "test")
	require.NoError(t, err)
	require.Equal(t, "default", subscription.PrevUserGroup)
	require.NoError(t, RefreshUserGroupCache(user.Id))

	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "pro", updated.Group)
	assert.EqualValues(t, 1, updated.AuthVersion)
	var session UserSession
	require.NoError(t, DB.First(&session, "sid = ?", "subscription-auth-session").Error)
	assert.Equal(t, UserSessionStatusActive, session.Status)
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "pro", cached.Group)
	assert.EqualValues(t, 1, cached.AuthVersion)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		target, err := downgradeUserGroupForSubscriptionTx(tx, subscription, now+1)
		assert.Equal(t, "default", target)
		return err
	}))
	require.NoError(t, RefreshUserGroupCache(user.Id))
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "default", updated.Group)
	assert.EqualValues(t, 1, updated.AuthVersion)
	require.NoError(t, DB.First(&session, "sid = ?", "subscription-auth-session").Error)
	assert.Equal(t, UserSessionStatusActive, session.Status)
	cached, err = GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, "default", cached.Group)
}

// TestSubscriptionUsableGroupsRestrictConsumption covers the group restriction
// end-to-end: the plan snapshot, pre-consume selection, and the two group-aware
// existence checks that decide wallet fallback.
func TestSubscriptionUsableGroupsRestrictConsumption(t *testing.T) {
	truncateTables(t)
	// The shared fixture migrates plans and subscriptions but not the pre-consume
	// record table, which this test needs to actually reserve quota.
	require.NoError(t, DB.AutoMigrate(&SubscriptionPreConsumeRecord{}))
	t.Cleanup(func() {
		DB.Exec("DELETE FROM subscription_pre_consume_records")
	})
	useUserCacheMiniRedis(t)
	user := User{
		Username:    "usable-groups-user",
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))

	restrictedPlan := &SubscriptionPlan{
		Title:         "VIP only",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   100,
		UsableGroups:  []string{"vip", "pro"},
		Enabled:       true,
	}
	require.NoError(t, DB.Create(restrictedPlan).Error)

	sub, err := CreateUserSubscriptionFromPlanTx(DB, user.Id, restrictedPlan, "admin")
	require.NoError(t, err)
	// The snapshot is taken at purchase time so later plan edits do not move old
	// subscriptions.
	require.Equal(t, []string{"vip", "pro"}, sub.UsableGroups)

	t.Run("restricted groups decide wallet fallback", func(t *testing.T) {
		// Not usable anywhere yet, so the two group-aware checks must say "no
		// subscription here" and the caller falls back to the wallet.
		hasDefault, err := HasActiveUserSubscription(user.Id, "default")
		require.NoError(t, err)
		assert.False(t, hasDefault)

		hasVip, err := HasActiveUserSubscription(user.Id, "vip")
		require.NoError(t, err)
		assert.True(t, hasVip)

		allowDefault, err := UserActiveSubscriptionsAllowWalletOverflow(user.Id, "default")
		require.NoError(t, err)
		assert.True(t, allowDefault, "no subscription applies here, so the wallet stays usable")
	})

	t.Run("pre-consume pays only from a covered group", func(t *testing.T) {
		_, err := PreConsumeUserSubscription("req-outside", user.Id, "default", 0, 10)
		require.Error(t, err)
		require.ErrorIs(t, err, ErrSubscriptionGroupNotUsable)

		result, err := PreConsumeUserSubscription("req-vip", user.Id, "vip", 0, 10)
		require.NoError(t, err)
		require.Equal(t, sub.Id, result.UserSubscriptionId)
		assert.EqualValues(t, 10, result.PreConsumed)
	})

	t.Run("unrestricted plan pays any group", func(t *testing.T) {
		openPlan := &SubscriptionPlan{
			Title:         "Any group",
			DurationUnit:  SubscriptionDurationMonth,
			DurationValue: 1,
			TotalAmount:   50,
			Enabled:       true,
		}
		require.NoError(t, DB.Create(openPlan).Error)
		_, err := CreateUserSubscriptionFromPlanTx(DB, user.Id, openPlan, "admin")
		require.NoError(t, err)

		hasDefault, err := HasActiveUserSubscription(user.Id, "default")
		require.NoError(t, err)
		assert.True(t, hasDefault)

		result, err := PreConsumeUserSubscription("req-open", user.Id, "default", 0, 10)
		require.NoError(t, err)
		assert.EqualValues(t, 10, result.PreConsumed)
	})

	t.Run("legacy rows without the restriction pay any group", func(t *testing.T) {
		// A row written before the column existed reads back as an empty
		// restriction, which must keep paying for every group.
		legacy := &UserSubscription{
			UserId:      user.Id,
			PlanId:      restrictedPlan.Id,
			AmountTotal: 30,
			StartTime:   time.Now().Unix(),
			EndTime:     time.Now().Add(24 * time.Hour).Unix(),
			Status:      "active",
		}
		require.NoError(t, DB.Create(legacy).Error)

		var stored UserSubscription
		require.NoError(t, DB.First(&stored, legacy.Id).Error)
		assert.Empty(t, stored.UsableGroups)

		hasAny, err := HasActiveUserSubscription(user.Id, "any-group")
		require.NoError(t, err)
		assert.True(t, hasAny)
	})
}

// legacySubscriptionPlan / legacyUserSubscription mirror the table shape before the
// usable-groups column existed, so the upgrade path can be exercised on a real file DB.
type legacySubscriptionPlan struct {
	Id    int    `gorm:"primaryKey"`
	Title string `gorm:"type:varchar(128)"`
	Total int64  `gorm:"type:bigint"`
}

func (legacySubscriptionPlan) TableName() string { return "subscription_plans" }

type legacyUserSubscription struct {
	Id          int    `gorm:"primaryKey"`
	UserId      int    `gorm:"index"`
	PlanId      int    `gorm:"index"`
	AmountTotal int64  `gorm:"type:bigint"`
	AmountUsed  int64  `gorm:"type:bigint"`
	Status      string `gorm:"type:varchar(32)"`
	StartTime   int64
	EndTime     int64
	// UsableGroups does not exist yet in this shape; the column must be added by
	// AutoMigrate below.
}

func (legacyUserSubscription) TableName() string { return "user_subscriptions" }

// TestSubscriptionUsableGroupsMigrationPreservesLegacyRows proves the schema change is
// additive on a real SQLite file: existing rows survive, keep paying, and a second
// AutoMigrate is a no-op.
func TestSubscriptionUsableGroupsMigrationPreservesLegacyRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	// Registered after TempDir, so LIFO cleanup closes the file before removal
	// (Windows refuses to unlink a still-open database).
	t.Cleanup(func() { _ = sqlDB.Close() })

	// Legacy database: tables without the usable_groups column, plus real rows.
	require.NoError(t, db.AutoMigrate(&legacySubscriptionPlan{}, &legacyUserSubscription{}))
	require.NoError(t, db.Create(&legacySubscriptionPlan{Id: 1, Title: "Legacy plan", Total: 100}).Error)
	require.NoError(t, db.Create(&legacyUserSubscription{
		Id: 1, UserId: 1, PlanId: 1, AmountTotal: 100, AmountUsed: 40,
		Status: "active", StartTime: 1, EndTime: time.Now().Add(time.Hour).Unix(),
	}).Error)

	// Upgrade.
	require.NoError(t, db.AutoMigrate(&SubscriptionPlan{}, &UserSubscription{}))

	var column string
	require.NoError(t, db.Raw(
		"SELECT type FROM pragma_table_info('user_subscriptions') WHERE name = 'usable_groups'",
	).Scan(&column).Error)
	require.NotEmpty(t, column, "usable_groups column must be added to existing tables")

	var sub UserSubscription
	require.NoError(t, db.First(&sub, 1).Error)
	assert.EqualValues(t, 40, sub.AmountUsed, "existing usage must survive the upgrade")
	assert.EqualValues(t, 100, sub.AmountTotal)
	assert.Empty(t, sub.UsableGroups, "legacy rows read back as unrestricted")

	// The upgraded row keeps paying for every group.
	previousDB, previousLogDB := DB, LOG_DB
	DB, LOG_DB = db, db
	t.Cleanup(func() { DB, LOG_DB = previousDB, previousLogDB })
	has, err := HasActiveUserSubscription(1, "any-group")
	require.NoError(t, err)
	assert.True(t, has)

	// Writing a restriction works, and clearing it back to unrestricted works too.
	require.NoError(t, db.Model(&UserSubscription{}).Where("id = ?", 1).
		Select("usable_groups").Updates(UserSubscription{UsableGroups: []string{"vip"}}).Error)
	var restricted UserSubscription
	require.NoError(t, db.First(&restricted, 1).Error)
	assert.Equal(t, []string{"vip"}, restricted.UsableGroups)
	assert.True(t, SubscriptionUsableGroupsAllow(restricted.UsableGroups, "vip"))
	assert.False(t, SubscriptionUsableGroupsAllow(restricted.UsableGroups, "default"))

	require.NoError(t, db.Model(&UserSubscription{}).Where("id = ?", 1).
		Select("usable_groups").Updates(UserSubscription{UsableGroups: []string{}}).Error)
	var cleared UserSubscription
	require.NoError(t, db.First(&cleared, 1).Error)
	assert.Empty(t, cleared.UsableGroups)
	assert.EqualValues(t, 40, cleared.AmountUsed, "clearing the restriction must not touch usage")

	// Idempotency: migrating again changes nothing.
	require.NoError(t, db.AutoMigrate(&SubscriptionPlan{}, &UserSubscription{}))
	var after UserSubscription
	require.NoError(t, db.First(&after, 1).Error)
	assert.EqualValues(t, 40, after.AmountUsed)
}

func TestSubscriptionGroupCacheRefreshFailureDoesNotChangeCommittedResult(t *testing.T) {
	previousDB, previousLogDB := DB, LOG_DB
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	DB, LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&User{}, &SubscriptionPlan{}, &UserSubscription{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(4)
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		_ = sqlDB.Close()
	})

	user := User{
		Username:    "subscription-cache-failure",
		Password:    "unused-password-hash",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AuthVersion: 1,
	}
	require.NoError(t, DB.Create(&user).Error)
	plan := &SubscriptionPlan{
		Title:         "Cache failure plan",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   100,
		UpgradeGroup:  "pro",
		Enabled:       true,
	}
	require.NoError(t, DB.Create(plan).Error)
	InvalidateSubscriptionPlanCache(plan.Id)

	oldRedisEnabled, oldRDB := common.RedisEnabled, common.RDB
	common.RedisEnabled = true
	common.RDB = redis.NewClient(&redis.Options{
		Dialer: func(context.Context, string, string) (net.Conn, error) {
			return nil, errors.New("forced redis failure")
		},
		MaxRetries: -1,
	})
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RedisEnabled, common.RDB = oldRedisEnabled, oldRDB
	})

	message, err := AdminBindSubscription(user.Id, plan.Id, "test")
	require.NoError(t, err)
	assert.Contains(t, message, "pro")

	var updated User
	require.NoError(t, DB.First(&updated, user.Id).Error)
	assert.Equal(t, "pro", updated.Group)
	assert.EqualValues(t, 1, updated.AuthVersion)
	var subscription UserSubscription
	require.NoError(t, DB.Where("user_id = ?", user.Id).First(&subscription).Error)
	assert.Equal(t, "active", subscription.Status)
}
