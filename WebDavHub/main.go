package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"cinesync/pkg/env"
	"cinesync/pkg/logger"
	"cinesync/pkg/server"
	"cinesync/pkg/auth"
)

func main() {
	logger.Init()
	env.LoadEnv()

	// Check if WebDAV should be enabled
	if !env.IsWebDAVEnabled() {
		logger.Info("WebDAV is disabled. Set CINESYNC_WEBDAV=true in your .env file to enable it.")
		return
	}

	// Define command-line flags with fallbacks from .env or hardcoded defaults
	dir := flag.String("dir", env.GetString("DESTINATION_DIR", "."), "Directory to serve over WebDAV")
	port := flag.Int("port", env.GetInt("WEBDAV_PORT", 8082), "Port to run the WebDAV server on")
	ip := flag.String("ip", env.GetString("WEBDAV_IP", "0.0.0.0"), "IP address to bind the server to")
	flag.Parse()

	logger.Debug("Starting with configuration: dir=%s, port=%d, ip=%s", *dir, *port, *ip)

	// Ensure the directory exists and is accessible
	if _, err := os.Stat(*dir); os.IsNotExist(err) {
		logger.Fatal("Directory %s does not exist", *dir)
	}

	// Check if CineSync folder exists and use it as the effective root if found
	effectiveRootDir := *dir
	cineSyncPath := filepath.Join(*dir, "CineSync")
	if _, err := os.Stat(cineSyncPath); err == nil {
		logger.Info("CineSync folder found, using it as the effective root directory")
		effectiveRootDir = cineSyncPath
	}

	// Create required directories
	ensureDirectoryExists("./static")
	ensureDirectoryExists("./templates")

	// Initialize the server
	s := server.NewServer(effectiveRootDir)
	if err := s.Initialize(); err != nil {
		logger.Fatal("Failed to initialize server: %v", err)
	}

	// Start server
	addr := fmt.Sprintf("%s:%d", *ip, *port)
	rootInfo := *dir
	if effectiveRootDir != *dir {
		rootInfo = fmt.Sprintf("%s (using CineSync folder as root)", *dir)
	}

	logger.Info("Starting CineSync server on http://%s", addr)
	logger.Info("WebDAV access available at the root path for WebDAV clients")
	logger.Info("Serving content from: %s", rootInfo)
	logger.Info("Dashboard available at http://%s for browsers", addr)

        // In your main function, add this information after starting the server
        if env.IsBool("WEBDAV_AUTH_ENABLED", true) {
	        credentials := auth.GetCredentials()
		logger.Info("WebDAV authentication enabled (username: %s)", credentials.Username)
	        logger.Info("To disable authentication, set WEBDAV_AUTH_ENABLED=false in your .env file")
        } else {
	        logger.Warn("WebDAV authentication is disabled")
        }

	if err := http.ListenAndServe(addr, nil); err != nil {
		logger.Fatal("Server error: %v", err)
	}
}

// ensureDirectoryExists creates a directory if it doesn't exist
func ensureDirectoryExists(path string) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		logger.Info("Directory does not exist, creating it: %s", path)
		if err := os.Mkdir(path, 0755); err != nil {
			logger.Warn("Could not create directory: %v", err)
		}
	}
}
