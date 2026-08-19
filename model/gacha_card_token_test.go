package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func newTokenCard(t *testing.T, userId int) UserGachaCard {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&UserGachaCard{}, &GachaCardToken{}))
	card := UserGachaCard{
		UserId:      userId,
		ModelName:   "token-model",
		Group:       "default",
		TotalQuota:  100,
		RemainQuota: 100,
		Status:      0,
		ExpiredTime: -1,
		CreatedTime: common.GetTimestamp(),
		UpdatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(&card).Error)
	t.Cleanup(func() {
		DB.Unscoped().Delete(&card)
		DB.Where("card_id = ?", card.Id).Delete(&GachaCardToken{})
	})
	return card
}

func TestGachaCardTokenCreateAndFind(t *testing.T) {
	card := newTokenCard(t, 910002)

	token, plain, err := CreateGachaCardTokenTx(DB, &card)
	require.NoError(t, err)
	require.NotEmpty(t, plain)
	require.Contains(t, plain, "sk-gc-")
	require.Equal(t, card.Id, token.CardId)
	require.Equal(t, card.UserId, token.UserId)
	require.Equal(t, 0, token.Status)
	require.NotEqual(t, plain, token.KeyHash)
	require.NotEqual(t, plain, token.KeyPrefix)
	require.Len(t, token.KeyHash, 64)

	found, err := FindGachaCardToken(plain)
	require.NoError(t, err)
	require.Equal(t, token.Id, found.Id)
	require.Equal(t, card.Id, found.CardId)

	_, err = FindGachaCardToken("sk-gc-not-a-real-token")
	require.Error(t, err)
}

func TestGachaCardTokenEnsureRevokeAndReset(t *testing.T) {
	card := newTokenCard(t, 910003)

	_, plain1, created1, err := EnsureGachaCardTokenTx(DB, &card)
	require.NoError(t, err)
	require.True(t, created1)
	require.NotEmpty(t, plain1)

	token2, plain2, created2, err := EnsureGachaCardTokenTx(DB, &card)
	require.NoError(t, err)
	require.False(t, created2)
	require.Empty(t, plain2)
	require.NotNil(t, token2)
	require.NotEqual(t, plain1, plain2)

	require.NoError(t, RevokeGachaCardToken(card.UserId, card.Id))
	_, err = FindGachaCardToken(plain1)
	require.Error(t, err)

	token3, plain3, created3, err := EnsureGachaCardTokenTx(DB, &card)
	require.NoError(t, err)
	require.True(t, created3)
	require.NotEqual(t, plain1, plain3)
	require.NotEqual(t, token2.Id, token3.Id)
	found, err := FindGachaCardToken(plain3)
	require.NoError(t, err)
	require.Equal(t, token3.Id, found.Id)
}
