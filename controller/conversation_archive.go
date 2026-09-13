package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type conversationArchiveItem struct {
	Id           int             `json:"id"`
	UserId       int             `json:"user_id"`
	Username     string          `json:"username"`
	ModelName    string          `json:"model_name"`
	Messages     json.RawMessage `json:"messages"`
	MessageCount int             `json:"message_count"`
	Format       string          `json:"format"`
	CreatedAt    int64           `json:"created_at"`
	UpdatedAt    int64           `json:"updated_at"`
}

func buildConversationArchiveItem(archive *model.ConversationArchive) conversationArchiveItem {
	return conversationArchiveItem{
		Id:           archive.Id,
		UserId:       archive.UserId,
		Username:     archive.Username,
		ModelName:    archive.ModelName,
		Messages:     json.RawMessage(archive.Messages),
		MessageCount: archive.MessageCount,
		Format:       archive.Format,
		CreatedAt:    archive.CreatedAt,
		UpdatedAt:    archive.UpdatedAt,
	}
}

func GetAllConversationArchives(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	modelName := c.Query("model_name")
	username := c.Query("username")
	archives, total, err := model.GetAllConversationArchives(startTimestamp, endTimestamp, modelName, username, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]conversationArchiveItem, 0, len(archives))
	for _, archive := range archives {
		items = append(items, buildConversationArchiveItem(archive))
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// ExportConversationArchive 以 JSONL（每行一个训练样本）流式导出归档对话。
// 支持 after_id 增量游标：仅返回 id 大于 after_id 的记录（id 升序），供没有
// 公网 IP 的接收端定期轮询增量同步。
func ExportConversationArchive(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	modelName := c.Query("model_name")
	username := c.Query("username")
	afterId, _ := strconv.Atoi(c.Query("after_id"))

	filename := fmt.Sprintf("conversation_archive_%s.jsonl", time.Now().Format("20060102_150405"))
	c.Writer.Header().Set("Content-Type", "application/x-ndjson")
	c.Writer.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	c.Writer.WriteHeader(http.StatusOK)

	flusher, _ := c.Writer.(http.Flusher)
	err := model.ExportConversationArchives(startTimestamp, endTimestamp, modelName, username, afterId, 500, func(archives []*model.ConversationArchive) error {
		for _, archive := range archives {
			line := fmt.Sprintf(`{"id":%d,"user_id":%d,"username":%s,"model_name":%s,"messages":%s}`,
				archive.Id,
				archive.UserId,
				mustQuoteJSONString(archive.Username),
				mustQuoteJSONString(archive.ModelName),
				archive.Messages,
			)
			if _, err := c.Writer.Write([]byte(line + "\n")); err != nil {
				return err
			}
		}
		if flusher != nil {
			flusher.Flush()
		}
		return nil
	})
	if err != nil {
		// 响应头已发出，无法再返回 JSON 错误，仅记录并终止。
		common.SysError("failed to export conversation archives: " + err.Error())
	}
}

func mustQuoteJSONString(value string) string {
	data, err := common.Marshal(value)
	if err != nil {
		return `""`
	}
	return string(data)
}

func DeleteConversationArchive(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "无效的记录 ID")
		return
	}
	rows, err := model.DeleteConversationArchiveById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}
