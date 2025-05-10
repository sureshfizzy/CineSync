//go:build !windows
// +build !windows

package api

func getDiskUsage(path string) (total, used int64, err error) {
	// Stub for Linux/macOS: returns zeros, no error
	return 0, 0, nil
}
