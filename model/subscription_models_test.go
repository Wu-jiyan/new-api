package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A plan card advertises what the plan actually covers: the models an
// administrator pinned, or everything the plan's groups serve right now.
func TestSubscriptionPlanAdvertisesItsOwnModelScope(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Channel{}, &Ability{}, &Model{}, &Vendor{}))
	for _, table := range []string{"abilities", "channels", "models", "vendors"} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}
	InvalidatePricingCache()
	t.Cleanup(func() {
		for _, table := range []string{"abilities", "channels", "models", "vendors"} {
			require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
		}
		InvalidatePricingCache()
	})

	channel := &Channel{
		Id:     901,
		Type:   1,
		Key:    "subscription-model-scope-key",
		Status: common.ChannelStatusEnabled,
		Name:   "subscription-model-scope",
	}
	require.NoError(t, DB.Create(channel).Error)
	for _, seed := range []struct{ group, model string }{
		{"basic", "model-basic"},
		{"pro", "model-pro"},
		{"basic", "model-shared"},
		{"pro", "model-shared"},
	} {
		require.NoError(t, DB.Create(&Ability{
			Group:     seed.group,
			Model:     seed.model,
			ChannelId: channel.Id,
			Enabled:   true,
		}).Error)
	}
	InvalidatePricingCache()

	t.Run("groups combine the payable scope with the upgrade target", func(t *testing.T) {
		groups := SubscriptionPlanGroups(&SubscriptionPlan{
			UsableGroups: []string{" basic ", "basic", ""},
			UpgradeGroup: "pro",
		})
		assert.Equal(t, []string{"basic", "pro"}, groups)
	})

	t.Run("an unrestricted plan advertises every served model", func(t *testing.T) {
		assert.Equal(t,
			[]string{"model-basic", "model-pro", "model-shared"},
			SubscriptionPlanAvailableModels(&SubscriptionPlan{}),
		)
	})

	t.Run("the payable scope narrows the advertised models", func(t *testing.T) {
		assert.Equal(t,
			[]string{"model-pro", "model-shared"},
			SubscriptionPlanAvailableModels(&SubscriptionPlan{UsableGroups: []string{"pro"}}),
		)
	})

	t.Run("an upgrade-only plan follows the upgraded group", func(t *testing.T) {
		assert.Equal(t,
			[]string{"model-pro", "model-shared"},
			SubscriptionPlanAvailableModels(&SubscriptionPlan{UpgradeGroup: "pro"}),
		)
	})

	t.Run("pinned models win over the group scope and are de-duplicated", func(t *testing.T) {
		assert.Equal(t,
			[]string{"model-basic", "model-pro"},
			SubscriptionPlanAvailableModels(&SubscriptionPlan{
				UsableGroups: []string{"pro"},
				UsableModels: []string{"model-pro", " model-basic ", "model-pro"},
			}),
		)
	})
}
