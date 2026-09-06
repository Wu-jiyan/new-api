package model

// CharacterBackground 系统级全局背景库（所有角色共用，台词按 Name 引用，与阶段无关）
type CharacterBackground struct {
	Id        int64  `json:"id" gorm:"primaryKey"`
	Name      string `json:"name" gorm:"size:64;uniqueIndex;not null"`
	ImageURL  string `json:"image_url" gorm:"size:512;not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint"`
}
