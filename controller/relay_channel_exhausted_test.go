package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/i18n"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// When a retry runs out of channels, the answer the client receives must be the
// failure of the previous attempt. Reporting only "no available channel" reads
// like a missing channel even when the upstream merely rejected the request.
func TestChannelSelectionFailedErrorKeepsTheUpstreamAnswer(t *testing.T) {
	if err := i18n.Init(); err != nil {
		t.Fatalf("i18n.Init: %v", err)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/tools/fetch", nil)

	upstream := types.NewOpenAIError(
		errors.New("failed to fetch URL"),
		types.ErrorCodeBadResponseStatusCode,
		http.StatusNotFound,
	)

	got := channelSelectionFailedError(c, &relaycommon.RelayInfo{LastError: upstream}, "auto")
	if got != upstream {
		t.Fatalf("returned error = %v, want the previous upstream error", got)
	}
	if got.StatusCode != http.StatusNotFound {
		t.Errorf("status code = %d, want %d", got.StatusCode, http.StatusNotFound)
	}
	if !types.IsSkipRetryError(got) {
		t.Error("the reported error must not be retried again")
	}
}

func TestChannelSelectionFailedErrorWithoutAnEarlierAttempt(t *testing.T) {
	if err := i18n.Init(); err != nil {
		t.Fatalf("i18n.Init: %v", err)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/tools/fetch", nil)

	got := channelSelectionFailedError(c, &relaycommon.RelayInfo{}, "auto")
	if got.GetErrorCode() != types.ErrorCodeGetChannelFailed {
		t.Errorf("error code = %q, want %q", got.GetErrorCode(), types.ErrorCodeGetChannelFailed)
	}
	if got.Error() == "" {
		t.Error("the error must carry a message")
	}
	if !types.IsSkipRetryError(got) {
		t.Error("a group without any channel must not be retried")
	}
}
