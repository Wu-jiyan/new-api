package middleware

import (
	"bytes"

	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// conversationArchiveWriter 包装 gin.ResponseWriter，把响应体复制一份到有限大小
// 的缓冲区，供对话归档解析（含流式 SSE 重组）。超出上限后不再缓存并标记截断。
type conversationArchiveWriter struct {
	gin.ResponseWriter
	body      *bytes.Buffer
	maxSize   int
	truncated bool
}

func (w *conversationArchiveWriter) writeBuffer(b []byte) {
	if w.truncated || w.body.Len() >= w.maxSize {
		w.truncated = true
		return
	}
	remain := w.maxSize - w.body.Len()
	if remain >= len(b) {
		w.body.Write(b)
	} else {
		w.body.Write(b[:remain])
		w.truncated = true
	}
}

func (w *conversationArchiveWriter) Write(b []byte) (int, error) {
	w.writeBuffer(b)
	return w.ResponseWriter.Write(b)
}

func (w *conversationArchiveWriter) WriteString(s string) (int, error) {
	w.writeBuffer([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

// ConversationArchive 在对话类 relay 端点（chat/completions、completions、
// messages、responses、Gemini generateContent）上捕获请求与响应，异步归档。
// 功能关闭或端点不匹配时零开销直通。
func ConversationArchive() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !service.ShouldCaptureConversation(c.Request.URL.Path) {
			c.Next()
			return
		}
		wrapper := &conversationArchiveWriter{
			ResponseWriter: c.Writer,
			body:           bytes.NewBuffer(make([]byte, 0, 4096)),
			maxSize:        service.ConversationArchiveMaxCaptureBytes,
		}
		c.Writer = wrapper
		c.Next()
		service.CaptureConversation(c, wrapper.body.Bytes(), wrapper.truncated, wrapper.Status(), wrapper.Header().Get("Content-Type"))
	}
}
