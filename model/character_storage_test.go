package model

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSaveCharacterImage(t *testing.T) {
	oldDir := characterUploadDir
	characterUploadDir = filepath.Join(t.TempDir(), "uploads")
	t.Cleanup(func() { characterUploadDir = oldDir })

	url, silURL, err := SaveCharacterImage("deepseek-v3", 1, []byte("fake-png-bytes"))
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(url, "/uploads/characters/deepseek-v3/1/"))
	require.True(t, strings.HasSuffix(url, ".png"))
	// 非合法图片：剪影生成失败，但立绘保存成功
	require.Equal(t, "", silURL)

	rel := strings.TrimPrefix(url, "/uploads/")
	_, err = os.Stat(filepath.Join(characterUploadDir, rel))
	require.NoError(t, err)
}

func TestSaveCharacterAsset(t *testing.T) {
	oldDir := characterUploadDir
	characterUploadDir = filepath.Join(t.TempDir(), "uploads")
	t.Cleanup(func() { characterUploadDir = oldDir })

	src := image.NewRGBA(image.Rect(0, 0, 2, 2))
	src.Set(0, 0, color.RGBA{R: 10, G: 20, B: 30, A: 255})
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, src))

	// 背景
	bgURL, _, err := SaveCharacterAsset("char-asset-test", 0, "bg", buf.Bytes())
	require.NoError(t, err)
	require.True(t, strings.Contains(bgURL, "/characters/char-asset-test/0/bg/"))

	// 姿态
	poseURL, _, err := SaveCharacterAsset("char-asset-test", 0, "poses/happy", buf.Bytes())
	require.NoError(t, err)
	require.True(t, strings.Contains(poseURL, "/characters/char-asset-test/0/poses/happy/"))

	// 剪影 URL 推导对子目录同样生效
	sil, err := EnsureSilhouette(bgURL)
	require.NoError(t, err)
	require.True(t, strings.HasSuffix(sil, "_silhouette.png"))
	_, err = os.Stat(filepath.Join(characterUploadDir, strings.TrimPrefix(sil, "/uploads/")))
	require.NoError(t, err)
}

func TestCharacterStagesRoundTripNewFields(t *testing.T) {
	stages := CharacterStages{Stages: []CharacterStage{
		{
			Index: 0, Name: "初遇", BackgroundURL: "/b.png", DefaultEffect: "fade",
			Poses: []CharacterPose{{Name: "normal", ImageURL: "/p1.png"}, {Name: "happy", ImageURL: "/p2.png"}},
			Script: []CharacterScript{
				{
					Speaker: "A", Text: "你好", Pose: "happy", Effect: "black",
					Choices: []CharacterChoice{{Text: "当然", Reply: "（她笑了）", Pose: "shy", Effect: "fade"}},
				},
			},
		},
	}}
	var ch Character
	require.NoError(t, ch.SetStages(stages))
	got := ch.Stages()
	require.Len(t, got.Stages, 1)
	st := got.Stages[0]
	require.Equal(t, "/b.png", st.BackgroundURL)
	require.Equal(t, "fade", st.DefaultEffect)
	require.Len(t, st.Poses, 2)
	require.Equal(t, "happy", st.Poses[1].Name)
	require.Len(t, st.Script, 1)
	require.Equal(t, "black", st.Script[0].Effect)
	require.Equal(t, "happy", st.Script[0].Pose)
	require.Len(t, st.Script[0].Choices, 1)
	require.Equal(t, "当然", st.Script[0].Choices[0].Text)
	require.Equal(t, "shy", st.Script[0].Choices[0].Pose)
}

func TestSaveCharacterImageWithSilhouette(t *testing.T) {
	oldDir := characterUploadDir
	characterUploadDir = filepath.Join(t.TempDir(), "uploads")
	t.Cleanup(func() { characterUploadDir = oldDir })

	// 构造一张 2x2 PNG：左上非透明红、右下透明
	src := image.NewRGBA(image.Rect(0, 0, 2, 2))
	src.Set(0, 0, color.RGBA{R: 255, G: 0, B: 0, A: 255})
	src.Set(1, 0, color.RGBA{A: 0})
	src.Set(0, 1, color.RGBA{A: 0})
	src.Set(1, 1, color.RGBA{A: 0})
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, src))

	url, silURL, err := SaveCharacterImage("char-sil-test", 0, buf.Bytes())
	require.NoError(t, err)
	require.NotEmpty(t, silURL)
	require.True(t, strings.HasSuffix(silURL, "_silhouette.png"))

	// 剪影文件存在且内容正确
	rel := strings.TrimPrefix(silURL, "/uploads/")
	silData, err := os.ReadFile(filepath.Join(characterUploadDir, rel))
	require.NoError(t, err)
	dec, err := png.Decode(bytes.NewReader(silData))
	require.NoError(t, err)
	r, g, b, a := dec.At(0, 0).RGBA()
	require.Equal(t, uint32(0), r)
	require.Equal(t, uint32(0), g)
	require.Equal(t, uint32(0), b)
	require.Equal(t, uint32(0xffff), a)
	_, _, _, a2 := dec.At(1, 1).RGBA()
	require.Equal(t, uint32(0), a2)

	// EnsureSilhouette 幂等：已存在直接返回
	got, err := EnsureSilhouette(url)
	require.NoError(t, err)
	require.Equal(t, silURL, got)

	// 原图不存在时返回错误
	_, err = EnsureSilhouette("/uploads/characters/missing/0/nope.png")
	require.Error(t, err)
}
