package model

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type GachaCardToken struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	CardId      int    `json:"card_id" gorm:"index;not null"`
	UserId      int    `json:"user_id" gorm:"index;not null"`
	KeyHash     string `json:"-" gorm:"type:char(64);uniqueIndex;not null"`
	KeyPrefix   string `json:"key_prefix" gorm:"size:24;not null"`
	Status      int    `json:"status" gorm:"default:0;index"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
	RevokedTime int64  `json:"revoked_time" gorm:"bigint;default:0"`
}

func hashGachaCardToken(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func newGachaCardTokenKey() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "sk-gc-" + base64.RawURLEncoding.EncodeToString(bytes), nil
}

func CreateGachaCardTokenTx(tx *gorm.DB, card *UserGachaCard) (token *GachaCardToken, plainKey string, err error) {
	if tx == nil || card == nil || card.Id <= 0 || card.UserId <= 0 {
		return nil, "", errors.New("invalid gacha card token input")
	}
	plainKey, err = newGachaCardTokenKey()
	if err != nil {
		return nil, "", err
	}
	token = &GachaCardToken{
		CardId:      card.Id,
		UserId:      card.UserId,
		KeyHash:     hashGachaCardToken(plainKey),
		KeyPrefix:   plainKey[:14],
		Status:      0,
		CreatedTime: common.GetTimestamp(),
	}
	if err = tx.Create(token).Error; err != nil {
		return nil, "", err
	}
	return token, plainKey, nil
}

func FindGachaCardToken(key string) (*GachaCardToken, error) {
	if key == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var token GachaCardToken
	if err := DB.Where("key_hash = ? AND status = 0", hashGachaCardToken(key)).First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func RevokeGachaCardToken(userId, cardId int) error {
	if userId <= 0 || cardId <= 0 {
		return errors.New("invalid gacha card token owner")
	}
	return DB.Model(&GachaCardToken{}).
		Where("user_id = ? AND card_id = ? AND status = 0", userId, cardId).
		Updates(map[string]interface{}{"status": 1, "revoked_time": common.GetTimestamp()}).Error
}

func ResetGachaCardToken(userId, cardId int) (*GachaCardToken, string, error) {
	var result *GachaCardToken
	var plainKey string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var card UserGachaCard
		if err := tx.Where("id = ? AND user_id = ?", cardId, userId).First(&card).Error; err != nil {
			return err
		}
		if err := tx.Model(&GachaCardToken{}).
			Where("user_id = ? AND card_id = ? AND status = 0", userId, cardId).
			Updates(map[string]interface{}{"status": 1, "revoked_time": common.GetTimestamp()}).Error; err != nil {
			return err
		}
		var err error
		result, plainKey, err = CreateGachaCardTokenTx(tx, &card)
		return err
	})
	if err != nil {
		return nil, "", err
	}
	return result, plainKey, nil
}

func EnsureGachaCardTokenTx(tx *gorm.DB, card *UserGachaCard) (token *GachaCardToken, plainKey string, created bool, err error) {
	if tx == nil || card == nil || card.Id <= 0 || card.UserId <= 0 {
		return nil, "", false, errors.New("invalid gacha card token input")
	}
	var existing GachaCardToken
	if err = tx.Where("card_id = ? AND user_id = ? AND status = 0", card.Id, card.UserId).First(&existing).Error; err == nil {
		return &existing, "", false, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, "", false, err
	}
	token, plainKey, err = CreateGachaCardTokenTx(tx, card)
	if err != nil {
		return nil, "", false, err
	}
	return token, plainKey, true, nil
}
