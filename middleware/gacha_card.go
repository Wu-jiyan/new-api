package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GachaCardMiddleware 解析 New-Api-Card 请求头并校验卡片归属与状态。
func GachaCardMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := strings.TrimSpace(c.GetHeader("New-Api-Card"))
		if header == "" {
			c.Next()
			return
		}
		cardId, err := strconv.Atoi(header)
		if err != nil || cardId <= 0 {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": gin.H{
				"message": "invalid New-Api-Card header",
				"type":    "invalid_request_error",
			}})
			return
		}
		userId := c.GetInt("id")
		card, err := model.GetGachaCardByUser(cardId, userId)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": gin.H{
				"message": "gacha card not found",
				"type":    "invalid_request_error",
			}})
			return
		}
		if card.Status != 0 || (card.ExpiredTime > 0 && card.ExpiredTime < common.GetTimestamp()) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": gin.H{
				"message": "gacha card is not usable",
				"type":    "invalid_request_error",
			}})
			return
		}
		c.Set("gacha_card_id", cardId)
		c.Next()
	}
}
