package realdebrid

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

func DirectoryResponse(path, added string) string {
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

	return fmt.Sprintf(`<d:response>
	<d:href>%s</d:href>
	<d:propstat>
		<d:prop>
			<d:resourcetype>
				<d:collection/>
			</d:resourcetype>
			<d:getlastmodified>%s</d:getlastmodified>
		</d:prop>
		<d:status>HTTP/1.1 200 OK</d:status>
	</d:propstat>
</d:response>`, pathEscape(path), rfc1123Time)
}

func FileResponse(path string, fileSize int64, added string) string {
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

	return fmt.Sprintf(`<d:response>
	<d:href>%s</d:href>
	<d:propstat>
		<d:prop>
			<d:getcontentlength>%d</d:getcontentlength>
			<d:getlastmodified>%s</d:getlastmodified>
			<d:resourcetype></d:resourcetype>
		</d:prop>
		<d:status>HTTP/1.1 200 OK</d:status>
	</d:propstat>
</d:response>`, pathEscape(path), fileSize, rfc1123Time)
}

func pathEscape(path string) string {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	
	result := "/" + strings.Join(parts, "/")
	
	if strings.HasSuffix(path, "/") && !strings.HasSuffix(result, "/") {
		result += "/"
	}
	
	return result
}
