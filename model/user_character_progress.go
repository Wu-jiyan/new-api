package model

type UserCharacterProgress struct {
	Id           int   `json:"id"`
	UserID       int   `json:"user_id" gorm:"uniqueIndex:idx_ucp_user_model;not null"`
	ModelName    string `json:"model_name" gorm:"size:128;uniqueIndex:idx_ucp_user_model;not null"`
	TotalTokens  int64 `json:"total_tokens" gorm:"default:0"`
	TotalCalls   int64 `json:"total_calls" gorm:"default:0"`
	MaxStage     int   `json:"max_stage" gorm:"default:0"`
	LastUnlockAt int64 `json:"last_unlock_at" gorm:"bigint"`
	UpdatedAt    int64 `json:"updated_at" gorm:"bigint"`
}
