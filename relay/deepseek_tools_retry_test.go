package relay

import (
	"net/http"
	"testing"
)

// The Search and Fetch APIs answer a rejected query or an unfetchable URL with
// a client error that no other channel can improve on. Retrying it spends the
// attempt budget and, when the model has a single channel, replaces the real
// upstream message with "no available channel".
func TestToolsRequestRejectedStatus(t *testing.T) {
	for _, tc := range []struct {
		status int
		want   bool
	}{
		{http.StatusBadRequest, true},
		{http.StatusForbidden, true},
		{http.StatusNotFound, true},
		{http.StatusMethodNotAllowed, true},
		{http.StatusGone, true},
		{http.StatusUnprocessableEntity, true},
		// A channel-scoped failure may still succeed elsewhere.
		{http.StatusUnauthorized, false},
		{http.StatusPaymentRequired, false},
		{http.StatusRequestTimeout, false},
		{http.StatusTooManyRequests, false},
		{http.StatusInternalServerError, false},
		{http.StatusBadGateway, false},
		{http.StatusGatewayTimeout, false},
		{http.StatusOK, false},
	} {
		if got := toolsRequestRejectedStatus(tc.status); got != tc.want {
			t.Errorf("toolsRequestRejectedStatus(%d) = %v, want %v", tc.status, got, tc.want)
		}
	}
}
