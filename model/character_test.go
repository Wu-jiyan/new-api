package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCharacterStagesRoundTrip(t *testing.T) {
	c := &Character{ModelName: "deepseek-v3"}
	stages := DefaultCharacterStages()
	require.Len(t, stages.Stages, 3)
	require.Zero(t, stages.Stages[0].UnlockTokens)

	require.NoError(t, c.SetStages(stages))
	got := c.Stages()
	require.Len(t, got.Stages, 3)
	require.Equal(t, "初遇", got.Stages[0].Name)
}

func TestCharacterStagesMalformedJSON(t *testing.T) {
	c := &Character{StagesJSON: "{not-json"}
	require.Empty(t, c.Stages().Stages)
}
