package mediahub

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	
	"cinesync/pkg/logger"
)

// MediaHubExecutable
type MediaHubExecutable struct {
	Path      string
	Args      []string
	IsCompiled bool
	WorkDir   string
}

// GetMediaHubExecutable returns the appropriate MediaHub executable configuration
func GetMediaHubExecutable() (*MediaHubExecutable, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get current directory: %v", err)
	}

	var mediaHubDir string
	basename := filepath.Base(cwd)
	
	if basename == "WebDavHub" {
		parentDir := filepath.Dir(cwd)
		mediaHubDir = filepath.Join(parentDir, "MediaHub")
		logger.Debug("GetMediaHubExecutable: Running from WebDavHub, MediaHub dir: %s", mediaHubDir)
	} else {
		mediaHubDir = filepath.Join(cwd, "MediaHub")
		logger.Debug("GetMediaHubExecutable: MediaHub dir: %s", mediaHubDir)
	}

	// Determine the executable name based on OS
	var exeName string
	if runtime.GOOS == "windows" {
		exeName = "MediaHub.exe"
	} else {
		exeName = "MediaHub"
	}

	exePath := filepath.Join(mediaHubDir, exeName)
	scriptPath := filepath.Join(mediaHubDir, "main.py")

	logger.Debug("GetMediaHubExecutable: Checking for compiled exe at: %s", exePath)
	if _, err := os.Stat(exePath); err == nil {
		return &MediaHubExecutable{
			Path:       exePath,
			Args:       []string{},
			IsCompiled: true,
			WorkDir:    mediaHubDir,
		}, nil
	}

	if _, err := os.Stat(scriptPath); err == nil {
		logger.Info("GetMediaHubExecutable: Found Python script at: %s", scriptPath)
		return &MediaHubExecutable{
			Path:       scriptPath,
			Args:       []string{},
			IsCompiled: false,
			WorkDir:    mediaHubDir,
		}, nil
	}

	return nil, fmt.Errorf("neither MediaHub executable (%s) nor Python script (%s) found", exePath, scriptPath)
}

// GetPythonCommand returns the appropriate Python command for the system
func GetPythonCommand() string {
	if customPython := os.Getenv("PYTHON_COMMAND"); customPython != "" {
		return customPython
	}

	if runtime.GOOS == "windows" {
		return "python"
	}
	return "python3"
}

// GetCommand returns the command and arguments
func (m *MediaHubExecutable) GetCommand(extraArgs ...string) (string, []string) {
	if m.IsCompiled {
		return m.Path, extraArgs
	}

	pythonCmd := GetPythonCommand()
	args := []string{m.Path}
	args = append(args, extraArgs...)
	return pythonCmd, args
}

// String returns a human-readable description
func (m *MediaHubExecutable) String() string {
	if m.IsCompiled {
		return fmt.Sprintf("Compiled: %s", m.Path)
	}
	return fmt.Sprintf("Python: %s %s", GetPythonCommand(), m.Path)
}