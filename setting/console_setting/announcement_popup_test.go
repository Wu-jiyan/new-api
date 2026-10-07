package console_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withConsoleSetting(t *testing.T, announcements string, popupEnabled bool) {
	t.Helper()

	setting := GetConsoleSetting()
	previous := *setting
	*setting = ConsoleSetting{
		Announcements:            announcements,
		AnnouncementPopupEnabled: popupEnabled,
	}
	t.Cleanup(func() {
		*setting = previous
	})
}

func TestGetAnnouncementPopupSelectsNewestMarkedAnnouncement(t *testing.T) {
	tests := []struct {
		name          string
		announcements string
		enabled       bool
		wantContent   string
	}{
		{
			name: "popup switch off keeps every announcement out of the popup",
			announcements: `[
				{"id":1,"content":"release notes","publishDate":"2026-01-02T00:00:00Z","popup":true}
			]`,
			enabled: false,
		},
		{
			name: "unmarked announcements never pop up",
			announcements: `[
				{"id":1,"content":"notice board","publishDate":"2026-01-02T00:00:00Z"}
			]`,
			enabled: true,
		},
		{
			name: "marked announcement pops up",
			announcements: `[
				{"id":1,"content":"maintenance","publishDate":"2026-01-01T00:00:00Z"},
				{"id":2,"content":"release notes","publishDate":"2026-01-02T00:00:00Z","popup":true}
			]`,
			enabled:     true,
			wantContent: "release notes",
		},
		{
			name: "newest marked announcement wins",
			announcements: `[
				{"id":1,"content":"older popup","publishDate":"2026-01-01T00:00:00Z","popup":true},
				{"id":2,"content":"newer popup","publishDate":"2026-02-01T00:00:00Z","popup":true}
			]`,
			enabled:     true,
			wantContent: "newer popup",
		},
		{
			name: "string marker is honoured",
			announcements: `[
				{"id":1,"content":"string marker","publishDate":"2026-01-01T00:00:00Z","popup":"true"}
			]`,
			enabled:     true,
			wantContent: "string marker",
		},
		{
			name: "false marker does not pop up",
			announcements: `[
				{"id":1,"content":"not marked","publishDate":"2026-01-01T00:00:00Z","popup":"false"}
			]`,
			enabled: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			withConsoleSetting(t, test.announcements, test.enabled)

			popup := GetAnnouncementPopup()

			if test.wantContent == "" {
				assert.Nil(t, popup)
				return
			}
			require.NotNil(t, popup)
			assert.Equal(t, test.wantContent, popup["content"])
		})
	}
}

func TestValidateConsoleSettingsRejectsInvalidPopupMarker(t *testing.T) {
	tests := []struct {
		name          string
		announcements string
		wantErr       bool
	}{
		{
			name:          "boolean marker is accepted",
			announcements: `[{"content":"release notes","publishDate":"2026-01-02T00:00:00Z","popup":true}]`,
		},
		{
			name:          "string marker is accepted",
			announcements: `[{"content":"release notes","publishDate":"2026-01-02T00:00:00Z","popup":"false"}]`,
		},
		{
			name:          "unknown string marker is rejected",
			announcements: `[{"content":"release notes","publishDate":"2026-01-02T00:00:00Z","popup":"yes"}]`,
			wantErr:       true,
		},
		{
			name:          "numeric marker is rejected",
			announcements: `[{"content":"release notes","publishDate":"2026-01-02T00:00:00Z","popup":1}]`,
			wantErr:       true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateConsoleSettings(test.announcements, "Announcements")

			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
		})
	}
}
