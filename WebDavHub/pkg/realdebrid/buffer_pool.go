package realdebrid

import (
	"bytes"
	"sync"
)

var responseBufferPool = sync.Pool{
	New: func() interface{} {
		return bytes.NewBuffer(make([]byte, 0, 64*1024))
	},
}

func GetResponseBuffer() *bytes.Buffer {
	return responseBufferPool.Get().(*bytes.Buffer)
}

func PutResponseBuffer(buf *bytes.Buffer) {
	if buf == nil {
		return
	}
	buf.Reset()
	responseBufferPool.Put(buf)
}

var largeBufferPool = sync.Pool{
	New: func() interface{} {
		return bytes.NewBuffer(make([]byte, 0, 32*1024*1024))
	},
}

func GetLargeResponseBuffer() *bytes.Buffer {
	return largeBufferPool.Get().(*bytes.Buffer)
}

func PutLargeResponseBuffer(buf *bytes.Buffer) {
	if buf == nil {
		return
	}
	buf.Reset()
	largeBufferPool.Put(buf)
}
