package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
)

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

	logger.Info("[RC Refresh] Requesting external VFS refresh: dirs=%v recursive=%t async=%t mount=%s",
		dirs,
		recursive,
		request.Async != nil && *request.Async,
		mountName,
	)
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

	logger.Info("[RC Refresh] External VFS refresh completed: dirs=%v", dirs)
	return map[string]interface{}{
		"success":       true,
		"message":       "External rclone refresh requested successfully",
		"dir":           requestedDirs[0],
		"requestedDirs": requestedDirs,
		"dirs":          dirs,
	}, http.StatusOK, nil
}