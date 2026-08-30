package model

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
)

// characterUploadDir 立绘存储根目录（相对进程工作目录，下含 characters 子目录）。测试中可替换。
var characterUploadDir = "data/uploads"

// SaveCharacterImage 将立绘二进制落盘到 {characterUploadDir}/characters/{model}/{stage}/{rand}.png，
// 返回数据库存储的相对 URL（/uploads/characters/...）。
func SaveCharacterImage(modelName string, stage int, data []byte) (string, error) {
	randBytes := make([]byte, 6)
	if _, err := rand.Read(randBytes); err != nil {
		return "", err
	}
	randStr := hex.EncodeToString(randBytes)
	rel := filepath.Join("characters", modelName, strconv.Itoa(stage), randStr+".png")
	dir := filepath.Join(characterUploadDir, "characters", modelName, strconv.Itoa(stage))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, randStr+".png"), data, 0o644); err != nil {
		return "", err
	}
	return "/uploads/" + filepath.ToSlash(rel), nil
}
