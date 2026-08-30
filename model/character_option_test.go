package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReloadCharacterStageThresholdsDefault(t *testing.T) {
	CharacterStageThresholdsValue = CharacterStageThresholds{Stage2Tokens: 0, Stage3Tokens: 0}
	ReloadCharacterStageThresholds()
	require.Equal(t, int64(10000000), CharacterStageThresholdsValue.Stage2Tokens)
	require.Equal(t, int64(50000000), CharacterStageThresholdsValue.Stage3Tokens)
}
