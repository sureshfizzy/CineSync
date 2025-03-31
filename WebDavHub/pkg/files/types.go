package files

import (
	"html/template"
        "path/filepath"
)

// FileInfo contains information about a file/directory for rendering in template
type FileInfo struct {
	Name      string
	Path      string
	Size      string
	ModTime   string
	Icon      string
	IconClass string
}

// BreadcrumbItem represents an item in the breadcrumb navigation
type BreadcrumbItem struct {
	Name   string
	Path   string
	IsLink bool
}

// TemplateData contains all data passed to the template
type TemplateData struct {
	Title       string
	CurrentPath string
	ParentPath  string
	ShowParent  bool
	Breadcrumbs []BreadcrumbItem
	Directories []FileInfo
	Files       []FileInfo
	Year        string
}

// PrepareTemplates loads and parses the required templates
func PrepareTemplates(templatesDir string) (*template.Template, error) {
    return template.ParseFiles(filepath.Join(templatesDir, "directory_listing.html"))
}
