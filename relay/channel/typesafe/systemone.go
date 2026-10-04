package typesafe

import (
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// SystemOneHandler forwards the upstream System One result to the client
// unchanged — answers are the payload clients consume — and returns the token
// counts the gateway bills. Jev charges per input token only.
func SystemOneHandler(c *gin.Context, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	service.CloseResponseBodyGracefully(resp)
	logger.LogDebug(c, "system one response body: %s", responseBody)

	var systemOneResp dto.SystemOneResponse
	if err := common.Unmarshal(responseBody, &systemOneResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	usage := systemOneResp.ToUsage()
	// A negative upstream count would turn the input price into a credit, so it
	// is treated as "no billable usage" instead of being settled.
	if usage.PromptTokens < 0 || usage.CompletionTokens < 0 {
		logger.LogWarn(c, "system one response reported negative usage, charging nothing")
		usage.PromptTokens = 0
		usage.CompletionTokens = 0
		usage.TotalTokens = 0
	}

	c.Data(http.StatusOK, "application/json", responseBody)
	return usage, nil
}
