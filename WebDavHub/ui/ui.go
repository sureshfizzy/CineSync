package ui

import (
        "html/template"
        "io/fs"
        "mime"
        "net/http"
        "os"
        "path/filepath"
        "sort"
        "strings"
        "time"
)

// UIHandler serves the web UI
type UIHandler struct {
        baseDir string
}

// FileInfo contains file information for display
type FileInfo struct {
        Name         string
        Path         string
        IsDir        bool
        Size         int64
        LastModified string
        Icon         string
}

// NewUIHandler creates a new UI handler
func NewUIHandler(dir string) *UIHandler {
        return &UIHandler{
                baseDir: dir,
        }
}

// ServeHTTP handles HTTP requests for the UI
func (h *UIHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
        filePath := filepath.Join(h.baseDir, r.URL.Path)
        fileInfo, err := os.Stat(filePath)
        if err != nil {
                http.Error(w, "File not found: "+err.Error(), http.StatusNotFound)
                return
        }

        if fileInfo.IsDir() {
                h.serveDirectoryListing(w, filePath, r.URL.Path)
                return
        }

        h.serveFile(w, r, filePath)
}

// serveDirectoryListing shows the contents of a directory
func (h *UIHandler) serveDirectoryListing(w http.ResponseWriter, dir, urlPath string) {
        entries, err := os.ReadDir(dir)
        if err != nil {
                http.Error(w, "Failed to list directory: "+err.Error(), http.StatusInternalServerError)
                return
        }

        // Create template with functions
        tmpl, err := template.New("listing").Funcs(template.FuncMap{
                "split": func(s, sep string) []string {
                        return strings.Split(s, sep)
                },
                "joinPath": func(base, path string) string {
                        result := filepath.Join(base, path)
                        // Convert backslashes to forward slashes for URLs
                        return strings.ReplaceAll(result, "\\", "/")
                },
                "formatSize": formatFileSize,
        }).Parse(directoryTemplate)

        if err != nil {
                http.Error(w, "Template error: "+err.Error(), http.StatusInternalServerError)
                return
        }

        var files []FileInfo
        for _, entry := range entries {
                info, err := entry.Info()
                if err != nil {
                        continue
                }

                icon := h.getFileIcon(entry)
                path := filepath.Join(urlPath, entry.Name())

                // Make sure the path uses forward slashes for URLs
                path = strings.ReplaceAll(path, "\\", "/")

                // Format the date
                modTime := info.ModTime().Format("Jan 02, 2006 15:04:05")

                files = append(files, FileInfo{
                        Name:         entry.Name(),
                        Path:         path,
                        IsDir:        entry.IsDir(),
                        Size:         info.Size(),
                        LastModified: modTime,
                        Icon:         icon,
                })
        }

        // Sort directories first, then by name
        sort.Slice(files, func(i, j int) bool {
                if files[i].IsDir != files[j].IsDir {
                        return files[i].IsDir
                }
                return files[i].Name < files[j].Name
        })

        // Add parent directory link if not at root
        if urlPath != "/" && urlPath != "" {
                parentPath := filepath.Dir(urlPath)
                if parentPath == "." {
                        parentPath = "/"
                }
                parentPath = strings.ReplaceAll(parentPath, "\\", "/")

                files = append([]FileInfo{
                        {
                                Name:  "..",
                                Path:  parentPath,
                                IsDir: true,
                                Icon:  "folder-arrow-up",
                        },
                }, files...)
        }

        data := struct {
                Path        string
                Files       []FileInfo
                CurrentTime string
        }{
                Path:        urlPath,
                Files:       files,
                CurrentTime: time.Now().Format("Jan 02, 2006 15:04:05"),
        }

        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        err = tmpl.Execute(w, data)
        if err != nil {
                http.Error(w, "Template execution error: "+err.Error(), http.StatusInternalServerError)
        }
}

// serveFile serves a single file
func (h *UIHandler) serveFile(w http.ResponseWriter, r *http.Request, filePath string) {
        w.Header().Set("Content-Type", h.getMimeType(filePath))
        w.Header().Set("Accept-Ranges", "bytes")
        http.ServeFile(w, r, filePath)
}

// getMimeType determines the MIME type of a file
func (h *UIHandler) getMimeType(filePath string) string {
        ext := filepath.Ext(filePath)
        mimeType := mime.TypeByExtension(ext)
        if mimeType == "" {
                return "application/octet-stream"
        }
        return mimeType
}

// getFileIcon returns an appropriate icon class for a file type
func (h *UIHandler) getFileIcon(entry fs.DirEntry) string {
        if entry.IsDir() {
                return "folder"
        }

        ext := strings.ToLower(filepath.Ext(entry.Name()))
        switch ext {
        case ".mp4", ".webm", ".avi", ".mov", ".mkv":
                return "film"
        case ".mp3", ".wav", ".ogg", ".flac":
                return "music"
        case ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp":
                return "image"
        case ".pdf":
                return "file-pdf"
        case ".doc", ".docx", ".txt", ".rtf":
                return "file-text"
        case ".xls", ".xlsx", ".csv":
                return "file-spreadsheet"
        case ".ppt", ".pptx":
                return "file-presentation"
        case ".zip", ".rar", ".tar", ".gz", ".7z":
                return "file-archive"
        case ".go", ".js", ".html", ".css", ".py", ".java", ".c", ".cpp", ".php", ".rb":
                return "file-code"
        default:
                return "file"
        }
}

// formatFileSize formats a file size in bytes to a human-readable string
func formatFileSize(size int64) string {
        if size < 1024 {
                return fmt.Sprintf("%d B", size)
        }

        if size < 1024*1024 {
                return fmt.Sprintf("%.1f KB", float64(size)/1024)
        }

        if size < 1024*1024*1024 {
                return fmt.Sprintf("%.1f MB", float64(size)/(1024*1024))
        }

        return fmt.Sprintf("%.1f GB", float64(size)/(1024*1024*1024))
}

// directoryTemplate is the HTML template for directory listings
const directoryTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebDAV - {{.Path}}</title>
    <link rel="stylesheet" href="/static/style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        /* Inline critical CSS in case the static file isn't loaded */
        :root {
            --primary-color: #2c3e50;
            --secondary-color: #3498db;
            --background-color: #f8f9fa;
            --text-color: #333;
            --border-color: #ddd;
            --hover-color: #eee;
            --dir-color: #f1c40f;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: var(--text-color);
            background-color: var(--background-color);
            padding: 20px;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        header {
            margin-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 10px;
        }

        header h1 {
            color: var(--primary-color);
            margin-bottom: 5px;
        }

        .file-list {
            border: 1px solid var(--border-color);
            border-radius: 5px;
            overflow: hidden;
        }

        .file-list-header {
            display: grid;
            grid-template-columns: 3fr 1fr 2fr;
            padding: 10px 15px;
            background-color: var(--primary-color);
            color: white;
            font-weight: bold;
        }

        .file-item {
            display: grid;
            grid-template-columns: 3fr 1fr 2fr;
            padding: 10px 15px;
            border-bottom: 1px solid var(--border-color);
            text-decoration: none;
            color: var(--text-color);
        }

        .file-item:hover {
            background-color: var(--hover-color);
        }

        .file-dir {
            background-color: rgba(241, 196, 15, 0.1);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1><i class="fas fa-server"></i> WebDAV Explorer</h1>
            <p>
                <a href="/"><i class="fas fa-home"></i> Home</a>
                {{if ne .Path "/"}}
                    / 
                    {{$path := ""}}
                    {{$parts := split .Path "/"}}
                    {{range $index, $part := $parts}}
                        {{if ne $part ""}}
                            {{if ne $path ""}}
                                {{$path = joinPath $path $part}}
                            {{else}}
                                {{$path = $part}}
                            {{end}}
                            <a href="/{{$path}}">{{$part}}</a>
                            {{if lt $index (subtract (len $parts) 1)}} / {{end}}
                        {{end}}
                    {{end}}
                {{end}}
            </p>
        </header>

        <main>
            <div class="file-list">
                <div class="file-list-header">
                    <div class="file-name">Name</div>
                    <div class="file-size">Size</div>
                    <div class="file-modified">Modified</div>
                </div>

                {{range .Files}}
                <a href="{{.Path}}" class="file-item {{if .IsDir}}file-dir{{end}}">
                    <div class="file-name">
                        <i class="fas fa-{{.Icon}}"></i> {{.Name}}
                    </div>
                    <div class="file-size">
                        {{if not .IsDir}}
                            {{formatSize .Size}}
                        {{end}}
                    </div>
                    <div class="file-modified">{{.LastModified}}</div>
                </a>
                {{end}}
            </div>
        </main>
        <footer>
            <p>WebDAV Server | Current time: {{.CurrentTime}}</p>
        </footer>
    </div>
</body>
</html>
`
