package mediahub

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// MediaHubExecutable
type MediaHubExecutable struct {
	Path       string
	Args       []string
	IsCompiled bool
	WorkDir    string
}

// GetMediaHubExecutable returns the appropriate MediaHub executable configuration
func GetMediaHubExecutable() (*MediaHubExecutable, error) {
	candidates := []string{}

	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates, filepath.Join(exeDir, "MediaHub"))
		candidates = append(candidates, filepath.Join(filepath.Dir(exeDir), "MediaHub"))
	}

	if cwd, err := os.Getwd(); err == nil {
		basename := filepath.Base(cwd)
		if basename == "WebDavHub" {
			candidates = append(candidates, filepath.Join(filepath.Dir(cwd), "MediaHub"))
		}
		candidates = append(candidates, filepath.Join(cwd, "MediaHub"))
	}

	seen := make(map[string]bool)
	uniqueCandidates := make([]string, 0, len(candidates))
	for _, c := range candidates {
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		uniqueCandidates = append(uniqueCandidates, c)
	}

	// Determine the executable name based on OS
	var exeName string
	if runtime.GOOS == "windows" {
		exeName = "MediaHub.exe"
	} else {
		exeName = "MediaHub"
	}

	for _, mediaHubDir := range uniqueCandidates {
		exePath := filepath.Join(mediaHubDir, exeName)
		scriptPath := filepath.Join(mediaHubDir, "main.py")

		if _, err := os.Stat(exePath); err == nil {
			return &MediaHubExecutable{
				Path:       exePath,
				Args:       []string{},
				IsCompiled: true,
				WorkDir:    mediaHubDir,
			}, nil
		}

		if _, err := os.Stat(scriptPath); err == nil {
			return &MediaHubExecutable{
				Path:       scriptPath,
				Args:       []string{},
				IsCompiled: false,
				WorkDir:    mediaHubDir,
			}, nil
		}
	}

	return nil, fmt.Errorf("could not locate MediaHub executable or main.py in expected locations")
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
