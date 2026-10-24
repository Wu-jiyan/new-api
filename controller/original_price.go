package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// SyncOriginalPriceRate 立即拉取一次 USD→CNY 市场汇率。
// 模型展示的「原价 / 折扣」依赖这条汇率把美元标价换算到人民币标价，
// 定时任务已经在跑，这个接口只给管理员一个「现在就要」的入口。
func SyncOriginalPriceRate(c *gin.Context) {
	state, err := service.SyncOriginalPriceRateNow(c.Request.Context())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, state)
}
