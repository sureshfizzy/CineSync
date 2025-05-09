package api

import (
	"fmt"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func getDiskUsage(path string) (total, used int64, err error) {
	drive := filepath.VolumeName(path)
	if drive == "" {
		return 0, 0, fmt.Errorf("invalid path: %s", path)
	}

	var freeBytesAvailable, totalBytes, totalFreeBytes uint64
	err = windows.GetDiskFreeSpaceEx(
		windows.StringToUTF16Ptr(drive),
		&freeBytesAvailable,
		&totalBytes,
		&totalFreeBytes,
	)
	if err != nil {
		return 0, 0, err
	}

	return int64(totalBytes), int64(totalBytes - freeBytesAvailable), nil
}
