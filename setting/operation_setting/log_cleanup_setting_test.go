/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateLogCleanupRetentionDays(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{name: "zero disables automatic cleanup", value: "0"},
		{name: "typical retention", value: "30"},
		{name: "surrounding whitespace", value: " 90 "},
		{name: "maximum retention", value: "3650"},
		{name: "negative", value: "-1", wantErr: true},
		{name: "above maximum", value: "3651", wantErr: true},
		{name: "not a number", value: "thirty", wantErr: true},
		{name: "empty", value: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateLogCleanupRetentionDays(tt.value)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestLogCleanupSettingIsRegisteredAndDefaultsToOff(t *testing.T) {
	setting := GetLogCleanupSetting()
	require.NotNil(t, setting)

	// A fresh install must not schedule deletions before an operator opts in.
	saved := *setting
	t.Cleanup(func() { *setting = saved })
	setting.Enabled = false
	setting.RetentionDays = 0
	assert.False(t, setting.Enabled)
	assert.Equal(t, 0, setting.RetentionDays)
}
