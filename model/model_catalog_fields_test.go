package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateModelModalities(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr string
	}{
		{name: "empty is unset", raw: ""},
		{name: "empty array", raw: "[]"},
		{name: "single known modality", raw: `["text"]`},
		{name: "all known modalities", raw: `["text","image","audio","video","file"]`},
		{name: "unknown modality is rejected", raw: `["text","hologram"]`, wantErr: "unsupported modality: hologram"},
		{name: "scalar instead of array is rejected", raw: `"text"`, wantErr: "modalities must be a JSON array"},
		{name: "object instead of array is rejected", raw: `{"a":1}`, wantErr: "modalities must be a JSON array"},
		{name: "malformed json is rejected", raw: `["text"`, wantErr: "modalities must be a JSON array"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateModelModalities(tc.raw)
			if tc.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErr)
		})
	}
}

func TestParseModelModalities(t *testing.T) {
	assert.Nil(t, ParseModelModalities(""))
	assert.Equal(t, []string{"text", "image"}, ParseModelModalities(`["text","image"]`))
	// Reads must survive dirty legacy data instead of failing the whole page.
	assert.Nil(t, ParseModelModalities("not json"))
	assert.Nil(t, ParseModelModalities(`{"a":1}`))
}

func TestValidateCatalogFields(t *testing.T) {
	require.NoError(t, (&Model{ContextLength: 128000, MaxInputTokens: 128000, MaxOutputTokens: 8192,
		InputModalities: `["text","image"]`, OutputModalities: `["text"]`}).ValidateCatalogFields())

	// 0 means "not configured" everywhere and must stay valid.
	require.NoError(t, (&Model{}).ValidateCatalogFields())

	assert.Error(t, (&Model{ContextLength: -1}).ValidateCatalogFields())
	assert.Error(t, (&Model{MaxInputTokens: -1}).ValidateCatalogFields())
	assert.Error(t, (&Model{MaxOutputTokens: -1}).ValidateCatalogFields())
	assert.Error(t, (&Model{ContextLength: tokenLimitCeiling + 1}).ValidateCatalogFields())
	assert.Error(t, (&Model{InputModalities: `["nope"]`}).ValidateCatalogFields())
	assert.Error(t, (&Model{OutputModalities: `["nope"]`}).ValidateCatalogFields())
}

// Model.Update 用 Select 白名单限定 UPDATE 列。任何新加的展示字段如果漏进这个列表，
// PUT /api/models 会「成功」但值永远写不进去 —— 一个没有任何报错的数据丢失陷阱。
// 这个用例就是那个陷阱的回归护栏。
func TestModelCatalogFieldsPersistThroughUpdate(t *testing.T) {
	setupCharacterChatModelDB(t)
	require.NoError(t, DB.AutoMigrate(&Model{}, &Option{}))

	created := &Model{ModelName: "catalog-fields-model", Status: 1, SyncOfficial: 0}
	require.NoError(t, created.Insert())
	t.Cleanup(func() { DB.Unscoped().Where("model_name = ?", "catalog-fields-model").Delete(&Model{}) })

	// 非法值必须在写入前就被拒绝，而不是落库后再被发现。
	rejected := &Model{Id: created.Id, ModelName: created.ModelName, InputModalities: `["telepathy"]`}
	assert.Error(t, rejected.Update())

	updated := &Model{
		Id:              created.Id,
		ModelName:       "catalog-fields-model",
		Status:          1,
		SyncOfficial:    0,
		ContextLength:   128000,
		MaxInputTokens:  128000,
		MaxOutputTokens: 8192,
		InputModalities: `["text","image"]`,
	}
	require.NoError(t, updated.Update())

	var reloaded Model
	require.NoError(t, DB.Unscoped().First(&reloaded, created.Id).Error)
	assert.Equal(t, 128000, reloaded.ContextLength)
	assert.Equal(t, 128000, reloaded.MaxInputTokens)
	assert.Equal(t, 8192, reloaded.MaxOutputTokens)
	assert.Equal(t, []string{"text", "image"}, ParseModelModalities(reloaded.InputModalities))

	// 显式清零必须能写进去：Select 的存在意义就是让 0 也能覆盖旧值。
	cleared := &Model{Id: created.Id, ModelName: "catalog-fields-model", Status: 1}
	require.NoError(t, cleared.Update())
	require.NoError(t, DB.Unscoped().First(&reloaded, created.Id).Error)
	assert.Zero(t, reloaded.ContextLength)
	assert.Empty(t, reloaded.InputModalities)
}
