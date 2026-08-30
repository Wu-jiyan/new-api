package model

import (
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

	url, err := SaveCharacterImage("deepseek-v3", 1, []byte("fake-png-bytes"))
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(url, "/uploads/characters/deepseek-v3/1/"))
	require.True(t, strings.HasSuffix(url, ".png"))

	rel := strings.TrimPrefix(url, "/uploads/")
	_, err = os.Stat(filepath.Join(characterUploadDir, rel))
	require.NoError(t, err)
}
