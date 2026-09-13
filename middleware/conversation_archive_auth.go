package middleware

import (
	"strings"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ConversationArchiveAuth 保护归档拉取接口：请求头携带专用拉取令牌
// （conversation_archive_setting.pull_token）时直接放行，否则回退到管理员
// 鉴权（AdminAuth），保证后台管理员仍可正常使用导出/删除接口。
// 该令牌只能访问归档拉取接口，权限范围不扩散到其他管理 API。
func ConversationArchiveAuth() gin.HandlerFunc {
	adminAuth := AdminAuth()
	return func(c *gin.Context) {
		token := archivePullTokenFromRequest(c)
		if token != "" && model.VerifyConversationArchivePullToken(token) {
			c.Next()
			return
		}
		adminAuth(c)
	}
}

// archivePullTokenFromRequest 提取拉取令牌，支持 Authorization: <token>、
// Bearer <token>，以及 x-api-key 头（便于 curl/脚本直接使用）。
func archivePullTokenFromRequest(c *gin.Context) string {
	header := strings.TrimSpace(c.GetHeader("Authorization"))
	if header != "" {
		parts := strings.Fields(header)
		if len(parts) == 1 {
			return parts[0]
		}
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			return parts[1]
		}
		return ""
	}
	return strings.TrimSpace(c.GetHeader("x-api-key"))
}
