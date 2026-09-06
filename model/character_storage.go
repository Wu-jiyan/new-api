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
// 并同步生成剪影（{rand}_silhouette.png）。
// 返回数据库存储的相对 URL（/uploads/characters/...）与剪影 URL。
func SaveCharacterImage(modelName string, stage int, data []byte) (string, string, error) {
	return saveCharacterImage(modelName, stage, "", data)
}

// SaveCharacterAsset 保存阶段剧情素材（背景/姿态），sub 指定子目录（如 "bg"、"poses/happy"）。
func SaveCharacterAsset(modelName string, stage int, sub string, data []byte) (string, string, error) {
	return saveCharacterImage(modelName, stage, sub, data)
}

// SaveGlobalBackground 保存系统级全局背景图到 {characterUploadDir}/backgrounds/{rand}.png，
// 返回相对 URL（/uploads/backgrounds/...）。
func SaveGlobalBackground(data []byte) (string, error) {
	randBytes := make([]byte, 6)
	if _, err := rand.Read(randBytes); err != nil {
		return "", err
	}
	randStr := hex.EncodeToString(randBytes)
	rel := filepath.Join("backgrounds", randStr+".png")
	dir := filepath.Join(characterUploadDir, "backgrounds")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, randStr+".png"), data, 0o644); err != nil {
		return "", err
	}
	return "/uploads/" + filepath.ToSlash(rel), nil
}

func saveCharacterImage(modelName string, stage int, sub string, data []byte) (string, string, error) {
	randBytes := make([]byte, 6)
	if _, err := rand.Read(randBytes); err != nil {
		return "", "", err
	}
	randStr := hex.EncodeToString(randBytes)
	rel := filepath.Join("characters", modelName, strconv.Itoa(stage), sub, randStr+".png")
	dir := filepath.Join(characterUploadDir, "characters", modelName, strconv.Itoa(stage), sub)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	filePath := filepath.Join(dir, randStr+".png")
	if err := os.WriteFile(filePath, data, 0o644); err != nil {
		return "", "", err
	}
	url := "/uploads/" + filepath.ToSlash(rel)

	silURL := silhouetteURLOf(url)
	sil, err := GenerateSilhouette(data)
	if err != nil {
		// 剪影生成失败不影响立绘保存（前端可退化为纯剪影占位）
		return url, "", nil
	}
	if err := os.WriteFile(filepath.Join(dir, randStr+silhouetteSuffix+".png"), sil, 0o644); err != nil {
		return url, "", nil
	}
	return url, silURL, nil
}
