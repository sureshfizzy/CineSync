package realdebrid

import (
	"bytes"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DirectoryResponse writes a directory response to the provided buffer.
func DirectoryResponse(buf *bytes.Buffer, path, added string) {
	rfc1123Time := ""
	if added != "" {
		if t, err := time.Parse(time.RFC3339, added); err == nil {
			rfc1123Time = t.UTC().Format(time.RFC1123)
		} else {
			rfc1123Time = added
		}
	} else {
		rfc1123Time = time.Now().UTC().Format(time.RFC1123)
	}

	escapedPath := pathEscape(path)
	
	buf.WriteString(`<d:response>
	<d:href>`)
	buf.WriteString(escapedPath)
	buf.WriteString(`</d:href>
	<d:propstat>
		<d:prop>
			<d:resourcetype>
				<d:collection/>
			</d:resourcetype>
			<d:getlastmodified>`)
	buf.WriteString(rfc1123Time)
	buf.WriteString(`</d:getlastmodified>
		</d:prop>
		<d:status>HTTP/1.1 200 OK</d:status>
	</d:propstat>
</d:response>`)
}

// FileResponse writes a file response to the provided buffer.
func FileResponse(buf *bytes.Buffer, path string, fileSize int64, added string) {
	rfc1123Time := ""
	if added != "" {
		if t, err := time.Parse(time.RFC3339, added); err == nil {
			rfc1123Time = t.UTC().Format(time.RFC1123)
		} else {
			rfc1123Time = added
		}
	} else {
		rfc1123Time = time.Now().UTC().Format(time.RFC1123)
	}

	escapedPath := pathEscape(path)
	sizeStr := strconv.FormatInt(fileSize, 10)
	
	buf.WriteString(`<d:response>
	<d:href>`)
	buf.WriteString(escapedPath)
	buf.WriteString(`</d:href>
	<d:propstat>
		<d:prop>
			<d:getcontentlength>`)
	buf.WriteString(sizeStr)
	buf.WriteString(`</d:getcontentlength>
			<d:getlastmodified>`)
	buf.WriteString(rfc1123Time)
	buf.WriteString(`</d:getlastmodified>
			<d:resourcetype></d:resourcetype>
		</d:prop>
		<d:status>HTTP/1.1 200 OK</d:status>
	</d:propstat>
</d:response>`)
}

func pathEscape(path string) string {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		escapedPart := strings.ReplaceAll(part, "%", "PCTTAG")
		escapedPart = url.PathEscape(escapedPart)
		escapedPart = strings.ReplaceAll(escapedPart, "PCTTAG", "%25")
		parts[i] = escapedPart
	}
	
	result := "/" + strings.Join(parts, "/")
	
	if strings.HasSuffix(path, "/") && !strings.HasSuffix(result, "/") {
		result += "/"
	}
	result = strings.ReplaceAll(result, "$", "%24")
	result = strings.ReplaceAll(result, "&", "%26")
	result = strings.ReplaceAll(result, "+", "%2B")
	result = strings.ReplaceAll(result, ":", "%3A")
	result = strings.ReplaceAll(result, "@", "%40")
	
	return result
}