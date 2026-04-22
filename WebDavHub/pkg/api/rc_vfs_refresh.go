package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"cinesync/pkg/logger"
	"cinesync/pkg/mediahub"
	"cinesync/pkg/realdebrid"
)

const pyBootstrap = "import os,sys;" +
	"p=sys.argv[1];" +
	"root=os.path.dirname(os.getcwd());" +
	"sys.path.insert(0,root);" +
	"sys.path.insert(0,os.getcwd());"

const pollingMonitorProcessFileCode = pyBootstrap +
	"from MediaHub.monitor.polling_monitor import process_file;" +
	"process_file(p)"

const deleteBrokenSymlinksCode = pyBootstrap +
	"from MediaHub.config.config import get_directories;" +
	"from MediaHub.processors.symlink_utils import delete_broken_symlinks_batch;" +
	"_,dest=get_directories();" +
	"delete_broken_symlinks_batch(dest,[p])"

type externalRcloneRefreshRequest struct {
	Dir       string   `json:"dir"`
	Dirs      []string `json:"dirs"`
	Recursive *bool    `json:"recursive"`
	Async     *bool    `json:"async"`
}

func externalRCBaseURL(serverURL, port string) (*url.URL, error) {
	serverURL = strings.TrimSpace(serverURL)
	port = strings.TrimSpace(port)
	if serverURL == "" {
		return nil, fmt.Errorf("external RC server URL is required")
	}

	if !strings.Contains(serverURL, "://") {
		serverURL = "http://" + serverURL
	}

	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		return nil, fmt.Errorf("invalid external RC server URL: %w", err)
	}
	if parsedURL.Scheme == "" || parsedURL.Host == "" || parsedURL.Hostname() == "" {
		return nil, fmt.Errorf("external RC server URL must include a valid scheme and host")
	}
	if port != "" {
		parsedURL.Host = parsedURL.Hostname() + ":" + port
	}

	parsedURL.RawQuery = ""
	parsedURL.Fragment = ""
	return parsedURL, nil
}

func externalRCMountName(mountName string) string {
	mountName = strings.TrimSpace(mountName)
	if mountName == "" {
		return ""
	}
	if !strings.HasSuffix(mountName, ":") {
		mountName += ":"
	}
	return mountName
}

func externalRCDirsToRefresh(requestedDirs []string) []string {
	seen := make(map[string]struct{})
	dirs := make([]string, 0, 3)

	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || value == "." || value == "/" {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		dirs = append(dirs, value)
	}

	for _, dir := range requestedDirs {
		add(dir)

		parent := path.Dir(dir)
		add(parent)

		grandParent := path.Dir(parent)
		add(grandParent)
	}

	if len(dirs) == 0 {
		return []string{realdebrid.ALL_TORRENTS}
	}

	return dirs
}

func callExternalRC(baseURL *url.URL, username, password, endpoint string, form url.Values) (map[string]interface{}, int, string, error) {
	requestURL := *baseURL
	requestURL.Path = strings.TrimRight(requestURL.Path, "/") + endpoint

	req, err := http.NewRequest(http.MethodPost, requestURL.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, http.StatusInternalServerError, "", fmt.Errorf("failed to prepare RC request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if strings.TrimSpace(username) != "" {
		req.SetBasicAuth(strings.TrimSpace(username), password)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	bodyText := strings.TrimSpace(string(body))

	var decoded map[string]interface{}
	if len(body) > 0 {
		_ = json.Unmarshal(body, &decoded)
	}

	return decoded, resp.StatusCode, bodyText, nil
}

func externalRCFormArgs(dirs []string, mountName string, recursive bool, async *bool, includeRecursive bool) url.Values {
	form := url.Values{}
	for i, dir := range dirs {
		key := "dir"
		if i > 0 {
			key = fmt.Sprintf("dir%d", i+1)
		}
		form.Set(key, dir)
	}
	if mountName != "" {
		form.Set("fs", mountName)
	}
	if includeRecursive {
		form.Set("recursive", fmt.Sprintf("%t", recursive))
	}
	if async != nil && *async {
		form.Set("_async", "true")
	}
	return form
}

func refreshExternalRcloneVFS(request externalRcloneRefreshRequest) (map[string]interface{}, int, error) {
	cfg := realdebrid.GetConfigManager().GetConfig()
	rc := cfg.RcloneSettings
	if !rc.ServeFromRclone {
		return nil, http.StatusBadRequest, fmt.Errorf("external rclone mount mode is not enabled")
	}

	baseURL, err := externalRCBaseURL(rc.ExternalRcServerURL, rc.ExternalRcPort)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}

	recursive := true
	if request.Recursive != nil {
		recursive = *request.Recursive
	}

	requestedDirs := make([]string, 0, len(request.Dirs)+1)
	for _, dir := range request.Dirs {
		dir = strings.TrimSpace(dir)
		if dir != "" {
			requestedDirs = append(requestedDirs, dir)
		}
	}
	if dir := strings.TrimSpace(request.Dir); dir != "" {
		requestedDirs = append(requestedDirs, dir)
	}
	if len(requestedDirs) == 0 {
		requestedDirs = []string{realdebrid.ALL_TORRENTS}
	}

	mountName := externalRCMountName(rc.ExternalVfsMountName)
	dirs := externalRCDirsToRefresh(requestedDirs)

	_, forgetStatusCode, forgetBodyText, forgetErr := callExternalRC(
		baseURL,
		rc.ExternalRcUsername,
		rc.ExternalRcPassword,
		"/vfs/forget",
		externalRCFormArgs(dirs, mountName, recursive, nil, false),
	)
	if forgetErr != nil {
		return map[string]interface{}{
			"success": false,
			"error":   forgetErr.Error(),
		}, forgetStatusCode, nil
	}
	if forgetStatusCode < http.StatusOK || forgetStatusCode >= http.StatusMultipleChoices {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("external RC forget returned %d", forgetStatusCode),
			"details": forgetBodyText,
			"dirs":    dirs,
		}, http.StatusBadGateway, nil
	}

	_, refreshStatusCode, refreshBodyText, refreshErr := callExternalRC(
		baseURL,
		rc.ExternalRcUsername,
		rc.ExternalRcPassword,
		"/vfs/refresh",
		externalRCFormArgs(dirs, mountName, recursive, request.Async, true),
	)
	if refreshErr != nil {
		logger.Warn("[RC Refresh] External VFS refresh request failed: %v", refreshErr)
		return map[string]interface{}{
			"success": false,
			"error":   refreshErr.Error(),
		}, refreshStatusCode, nil
	}
	if refreshStatusCode < http.StatusOK || refreshStatusCode >= http.StatusMultipleChoices {
		return map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("external RC refresh returned %d", refreshStatusCode),
			"details": refreshBodyText,
			"dirs":    dirs,
		}, http.StatusBadGateway, nil
	}

	return map[string]interface{}{
		"success":       true,
		"message":       "External rclone refresh requested successfully",
		"dir":           requestedDirs[0],
		"requestedDirs": requestedDirs,
		"dirs":          dirs,
	}, http.StatusOK, nil
}

// RcloneRefreshForDirs requests an external RC VFS refresh
func RcloneRefreshForDirs(dirs []string, source string) {
	if len(dirs) == 0 {
		return
	}

	recursive := false
	async := true
	response, statusCode, err := refreshExternalRcloneVFS(externalRcloneRefreshRequest{
		Dirs:      dirs,
		Recursive: &recursive,
		Async:     &async,
	})
	if err != nil {
		logger.Warn("[RC Refresh] %s: external VFS refresh failed for %v: %v", source, dirs, err)
		return
	}

	if success, _ := response["success"].(bool); success {
		logger.Debug("[RC Refresh] %s: external VFS refresh requested for %v (status %d)", source, dirs, statusCode)
		return
	}

	logger.Warn("[RC Refresh] %s: external VFS refresh rejected for %v: %v", source, dirs, response["error"])
}

func runMonitorProcessFile(workDir, singlePath string) {
	cmd := exec.Command(mediahub.GetPythonCommand(), "-c", pollingMonitorProcessFileCode, singlePath)
	cmd.Dir = workDir
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Run()
}

func runSinglePathProcessing(candidates []string, source string) {
	mediaHubExec, err := mediahub.GetMediaHubExecutable()
	if err != nil {
		logger.Warn("[Import] %s: failed to resolve MediaHub workspace: %v", source, err)
		return
	}

	for _, candidate := range candidates {
		var info os.FileInfo
		ready := false
		for attempt := 0; attempt < 8; attempt++ {
			if statInfo, statErr := os.Stat(candidate); statErr == nil {
				info = statInfo
				ready = true
				break
			}
			time.Sleep(2 * time.Second)
		}
		if !ready || info == nil {
			logger.Warn("[Import] %s: new torrent path not visible on mount yet: %s", source, candidate)
			continue
		}

		pathsToProcess := make([]string, 0, 8)
		collectVideoPaths := func() {
			pathsToProcess = pathsToProcess[:0]
			if info.IsDir() {
				_ = filepath.WalkDir(candidate, func(p string, d os.DirEntry, walkErr error) error {
					if walkErr == nil && d != nil && !d.IsDir() && realdebrid.IsVideoFile(d.Name()) {
						pathsToProcess = append(pathsToProcess, p)
					}
					return nil
				})
			} else if realdebrid.IsVideoFile(info.Name()) {
				pathsToProcess = append(pathsToProcess, candidate)
			}
		}
		collectVideoPaths()
		for retry := 0; len(pathsToProcess) == 0 && retry < 4 && info.IsDir(); retry++ {
			time.Sleep(2 * time.Second)
			collectVideoPaths()
		}

		if len(pathsToProcess) == 0 {
			logger.Warn("[Import] %s: no video files found in %s", source, candidate)
			continue
		}

		for _, singlePath := range pathsToProcess {
			runMonitorProcessFile(mediaHubExec.WorkDir, singlePath)
		}
	}
}

// TriggerBrokenSymlinkCleanup calls delete_broken_symlinks_batch
func TriggerBrokenSymlinkCleanup(torrentFilenames []string, source string) {
	if len(torrentFilenames) == 0 {
		return
	}

	cfg := realdebrid.GetConfigManager().GetConfig()
	mountPath := strings.TrimSpace(cfg.RcloneSettings.MountPath)
	if mountPath == "" {
		logger.Debug("[Cleanup] %s: skipping broken symlink cleanup (empty mount path)", source)
		return
	}

	mediaHubExec, err := mediahub.GetMediaHubExecutable()
	if err != nil {
		logger.Warn("[Cleanup] %s: failed to resolve MediaHub workspace: %v", source, err)
		return
	}

	seen := make(map[string]struct{}, len(torrentFilenames))
	for _, torrentFilename := range torrentFilenames {
		entryNames := importFolderExtensionEntryNames(cfg, torrentFilename)
		if len(entryNames) == 0 {
			continue
		}
		p := filepath.Clean(filepath.Join(mountPath, realdebrid.ALL_TORRENTS, entryNames[0]))
		if _, exists := seen[p]; exists {
			continue
		}
		seen[p] = struct{}{}

		cmd := exec.Command(mediahub.GetPythonCommand(), "-c", deleteBrokenSymlinksCode, p)
		cmd.Dir = mediaHubExec.WorkDir
		cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			continue
		}
	}
}

// TriggerSymlinkCreation executes single path processing.
func TriggerSymlinkCreation(torrentFilenames []string, source string) {
	if len(torrentFilenames) == 0 {
		return
	}

	cfg := realdebrid.GetConfigManager().GetConfig()
	mountPath := strings.TrimSpace(cfg.RcloneSettings.MountPath)
	if mountPath == "" {
		logger.Debug("[Import] %s: skipping processing (empty mount path)", source)
		return
	}

	candidates := make([]string, 0, len(torrentFilenames))
	seenCandidates := make(map[string]struct{}, len(torrentFilenames)*2)
	for _, torrentFilename := range torrentFilenames {
		entryNames := importFolderExtensionEntryNames(cfg, torrentFilename)
		chosen := ""
		for _, entryName := range entryNames {
			p := filepath.Clean(filepath.Join(mountPath, realdebrid.ALL_TORRENTS, entryName))
			if _, err := os.Stat(p); err == nil {
				chosen = p
				break
			}
		}
		if chosen == "" && len(entryNames) > 0 {
			chosen = filepath.Clean(filepath.Join(mountPath, realdebrid.ALL_TORRENTS, entryNames[0]))
		}
		if chosen == "" {
			continue
		}
		if _, exists := seenCandidates[chosen]; exists {
			continue
		}
		seenCandidates[chosen] = struct{}{}
		candidates = append(candidates, chosen)
	}

	runSinglePathProcessing(candidates, source)
}
