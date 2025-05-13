package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"cinesync/pkg/api"
	"cinesync/pkg/auth"
	"cinesync/pkg/env"
	"cinesync/pkg/logger"
	"cinesync/pkg/server"
	"cinesync/pkg/webdav"

	"github.com/joho/godotenv"
)

func startNpmServer() error {
	// Change to the frontend directory
	if err := os.Chdir("frontend"); err != nil {
		return fmt.Errorf("failed to change to frontend directory: %v", err)
	}

	// Check if node_modules exists
	if _, err := os.Stat("node_modules"); os.IsNotExist(err) {
		// Only install dependencies if node_modules doesn't exist
		logger.Info("Installing frontend dependencies...")
		installCmd := exec.Command("npm", "install")
		installCmd.Stdout = os.Stdout
		installCmd.Stderr = os.Stderr
		if err := installCmd.Run(); err != nil {
			return fmt.Errorf("failed to install dependencies: %v", err)
		}
	} else {
		logger.Info("Frontend dependencies already installed, skipping npm install")
	}

	// Start npm dev server
	logger.Info("Starting frontend development server...")
	cmd := exec.Command("npm", "run", "dev")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Start the command in a new process
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start npm server: %v", err)
	}

	// Change back to the original directory
	if err := os.Chdir(".."); err != nil {
		return fmt.Errorf("failed to change back to original directory: %v", err)
	}

	// Get UI port from environment variable or use default
	uiPort := env.GetString("CINESYNC_UI_PORT", "5173")

	// Wait for the development server to be ready
	logger.Info("Waiting for frontend server to be ready...")
	for i := 0; i < 30; i++ {
		resp, err := http.Get(fmt.Sprintf("http://localhost:%s", uiPort))
		if err == nil {
			resp.Body.Close()
			logger.Info("Frontend server is ready!")
			return nil
		}
		time.Sleep(time.Second)
	}

	return fmt.Errorf("frontend server failed to start within 30 seconds")
}

func main() {
	// Load .env from one directory above
	dotenvPath := filepath.Join("..", ".env")
	_ = godotenv.Load(dotenvPath)

	rootDir := os.Getenv("DESTINATION_DIR")
	if rootDir == "" {
		log.Fatal("DESTINATION_DIR not set in .env")
	}

	logger.Init()
	env.LoadEnv()

	// Check if WebDAV should be enabled
	if !env.IsWebDAVEnabled() {
		logger.Info("WebDAV is disabled. Set CINESYNC_WEBDAV=true in your .env file to enable it.")
		return
	}

	// Define command-line flags with fallbacks from .env or hardcoded defaults
	dir := flag.String("dir", env.GetString("DESTINATION_DIR", "."), "Directory to serve over WebDAV")
	port := flag.Int("port", env.GetInt("CINESYNC_API_PORT", 8082), "Port to run the CineSync API server on")
	ip := flag.String("ip", env.GetString("CINESYNC_IP", "0.0.0.0"), "IP address to bind the server to")
	flag.Parse()

	logger.Debug("Starting with configuration: dir=%s, port=%d, ip=%s", *dir, *port, *ip)

	// Ensure the directory exists and is accessible
	if _, err := os.Stat(*dir); os.IsNotExist(err) {
		logger.Fatal("Directory %s does not exist", *dir)
	}

	// Always use DESTINATION_DIR as the effective root
	effectiveRootDir := *dir

	// Initialize the server
	srv := server.NewServer(effectiveRootDir)
	if err := srv.Initialize(); err != nil {
		logger.Fatal("Failed to initialize server: %v", err)
	}

	// Set the root directory for file operations
	api.SetRootDir(effectiveRootDir)

	// Create a new mux for API routes
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("/api/files/", api.HandleFiles)
	apiMux.HandleFunc("/api/stream/", api.HandleStream)
	apiMux.HandleFunc("/api/stats", api.HandleStats)
	apiMux.HandleFunc("/api/auth/test", api.HandleAuthTest)
	apiMux.HandleFunc("/api/auth/enabled", api.HandleAuthEnabled)
	apiMux.HandleFunc("/api/auth/login", auth.HandleLogin)
	apiMux.HandleFunc("/api/auth/check", auth.HandleAuthCheck)
	apiMux.HandleFunc("/api/readlink", api.HandleReadlink)
	apiMux.HandleFunc("/api/delete", api.HandleDelete)
	apiMux.HandleFunc("/api/rename", api.HandleRename)
	apiMux.HandleFunc("/api/me", auth.HandleMe)
	apiMux.HandleFunc("/api/tmdb/search", api.HandleTmdbProxy)
	apiMux.HandleFunc("/api/tmdb/details", api.HandleTmdbDetails)

	// Use the new WebDAV handler from pkg/webdav
	webdavHandler := webdav.NewWebDAVHandler(effectiveRootDir)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			// Public endpoints
			if r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/auth/enabled" {
				apiMux.ServeHTTP(w, r)
				return
			}
			// Protected endpoints
			auth.JWTMiddleware(apiMux).ServeHTTP(w, r)
			return
		}
		// WebDAV handler for non-API paths
		webdavHandler.ServeHTTP(w, r)
	})

	// Start npm development server
	if err := startNpmServer(); err != nil {
		logger.Error("Failed to start npm server: %v", err)
		logger.Info("Continuing with backend server only...")
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

	logger.Info("WebDAV server running at http://localhost:%d (serving %s)\n", *port, rootDir)

	log.Fatal(http.ListenAndServe(addr, nil))
}
