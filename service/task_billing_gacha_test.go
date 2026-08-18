package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestTaskIsGachaCard(t *testing.T) {
	task := &model.Task{}
	task.PrivateData.BillingSource = BillingSourceGachaCard
	task.PrivateData.GachaCardId = 42
	require.True(t, taskIsGachaCard(task))
	task.PrivateData.GachaCardId = 0
	require.False(t, taskIsGachaCard(task))
}
