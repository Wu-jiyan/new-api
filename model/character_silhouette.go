package model

import (
	"bytes"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

// GenerateSilhouette 将立绘转成剪影：非透明像素去色为纯黑（保留原透明度），透明像素保持透明。
// 支持 png/jpeg/gif 解码，输出 png。
func GenerateSilhouette(data []byte) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			_, _, _, a := src.At(x, y).RGBA()
			if a > 0 {
				dst.Set(x-b.Min.X, y-b.Min.Y, color.RGBA{A: uint8(a >> 8)})
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// silhouetteSuffix 剪影文件命名：{原图名}_silhouette.png。
const silhouetteSuffix = "_silhouette"

// silhouetteURLOf 由立绘 URL 推导剪影 URL：/uploads/characters/x/0/abc.png -> /uploads/characters/x/0/abc_silhouette.png
func silhouetteURLOf(imageURL string) string {
	return strings.TrimSuffix(imageURL, ".png") + silhouetteSuffix + ".png"
}

// EnsureSilhouette 确保立绘的剪影文件存在（缺失时懒生成并落盘），返回剪影 URL。
func EnsureSilhouette(imageURL string) (string, error) {
	if imageURL == "" {
		return "", nil
	}
	silURL := silhouetteURLOf(imageURL)
	rel := strings.TrimPrefix(silURL, "/uploads/")
	path := filepath.Join(characterUploadDir, filepath.FromSlash(rel))
	if _, err := os.Stat(path); err == nil {
		return silURL, nil
	}
	// 读取原图生成剪影
	origRel := strings.TrimPrefix(imageURL, "/uploads/")
	origPath := filepath.Join(characterUploadDir, filepath.FromSlash(origRel))
	data, err := os.ReadFile(origPath)
	if err != nil {
		return "", err
	}
	sil, err := GenerateSilhouette(data)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, sil, 0o644); err != nil {
		return "", err
	}
	return silURL, nil
}
