package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"cinesync/pkg/api"
	"cinesync/pkg/config"
	"cinesync/pkg/auth"
	"cinesync/pkg/db"
	"cinesync/pkg/env"
	"cinesync/pkg/logger"
	"cinesync/pkg/server"
	"cinesync/pkg/webdav"

	"github.com/joho/godotenv"
)



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

	projectDir := ".."
	api.InitializeImageCache(projectDir)

	// Initialize job manager
	api.InitJobManager()

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
	apiMux.HandleFunc("/api/download", api.HandleDownload)
	apiMux.HandleFunc("/api/me", auth.HandleMe)
	apiMux.HandleFunc("/api/tmdb/search", api.HandleTmdbProxy)
	apiMux.HandleFunc("/api/tmdb/details", api.HandleTmdbDetails)
	apiMux.HandleFunc("/api/file-details", api.HandleFileDetails)
	apiMux.HandleFunc("/api/tmdb-cache", api.HandleTmdbCache)
	apiMux.HandleFunc("/api/image-cache", api.HandleImageCache)
	apiMux.HandleFunc("/api/python-bridge", api.HandlePythonBridge)
	apiMux.HandleFunc("/api/python-bridge/input", api.HandlePythonBridgeInput)
	apiMux.HandleFunc("/api/python-bridge/message", api.HandlePythonMessage)
	apiMux.HandleFunc("/api/mediahub/message", api.HandleMediaHubMessage)
	apiMux.HandleFunc("/api/recent-media", api.HandleRecentMedia)
	apiMux.HandleFunc("/api/config", config.HandleGetConfig)
	apiMux.HandleFunc("/api/config/update", config.HandleUpdateConfig)

	// MediaHub service endpoints
	apiMux.HandleFunc("/api/mediahub/status", api.HandleMediaHubStatus)
	apiMux.HandleFunc("/api/mediahub/start", api.HandleMediaHubStart)
	apiMux.HandleFunc("/api/mediahub/stop", api.HandleMediaHubStop)
	apiMux.HandleFunc("/api/mediahub/restart", api.HandleMediaHubRestart)
	apiMux.HandleFunc("/api/mediahub/logs", api.HandleMediaHubLogs)
	apiMux.HandleFunc("/api/mediahub/monitor/start", api.HandleMediaHubMonitorStart)
	apiMux.HandleFunc("/api/mediahub/monitor/stop", api.HandleMediaHubMonitorStop)

	// Job management endpoints
	apiMux.HandleFunc("/api/jobs/events", api.HandleJobEvents)
	apiMux.HandleFunc("/api/jobs/", api.HandleJobsRouter)
	apiMux.HandleFunc("/api/jobs", api.HandleJobsRouter)

	// Use the new WebDAV handler from pkg/webdav
	webdavHandler := webdav.NewWebDAVHandler(effectiveRootDir)
	// Create a new mux for the main server
	rootMux := http.NewServeMux()

	// API handling
	apiRouter := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/auth/enabled" {
			apiMux.ServeHTTP(w, r)
			return
		}
		// For other /api/ paths, apply JWT middleware if WEBDAV_AUTH_ENABLED is true
		authRequired := env.IsBool("WEBDAV_AUTH_ENABLED", true)
		if authRequired {
			auth.JWTMiddleware(apiMux).ServeHTTP(w, r) // JWTMiddleware wraps the entire apiMux for protected routes
		} else {
			apiMux.ServeHTTP(w, r)
		}
	})
	rootMux.Handle("/api/", apiRouter)

	// WebDAV Handler
	rootMux.Handle("/webdav/", auth.BasicAuthMiddleware(http.StripPrefix("/webdav", webdavHandler)))

	// Root path handler for the server itself
	rootMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			logger.Info("Root path / accessed by %s", r.RemoteAddr)
			w.Header().Set("Content-Type", "text/plain")
			w.Write([]byte("CineSync Server is active.\nAPI access at /api/\nWebDAV access at /webdav/\n"))
			return
		}
		http.NotFound(w, r)
	})



	// Add shutdown handler to checkpoint WAL
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-shutdown
		logger.Info("Shutting down: stopping job manager and checkpointing SQLite WAL...")
		api.StopJobManager()
		if db.DB() != nil {
			db.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
			db.DB().Exec("PRAGMA optimize;")
			db.DB().Exec("VACUUM;")
		}
		os.Exit(0)
	}()

	// Start server
	addr := fmt.Sprintf("%s:%d", *ip, *port)
	rootInfo := *dir
	if effectiveRootDir != *dir {
		rootInfo = fmt.Sprintf("%s (using CineSync folder as root)", *dir)
	}

	logger.Info("Starting CineSync server on http://%s", addr)
	logger.Info("WebDAV access available at http://%s/webdav/ for WebDAV clients", addr)
	logger.Info("Serving content from: %s", rootInfo)
	logger.Info("API available at http://%s/api/", addr)
	logger.Info("Server Dashboard http://%s/", addr)

	// In your main function, add this information after starting the server
	if env.IsBool("WEBDAV_AUTH_ENABLED", true) {
		credentials := auth.GetCredentials()
		logger.Info("WebDAV authentication enabled (username: %s)", credentials.Username)
		logger.Info("To disable authentication, set WEBDAV_AUTH_ENABLED=false in your .env file")
	} else {
		logger.Warn("WebDAV authentication is disabled")
	}

	logger.Info("WebDAV server running at http://localhost:%d (serving %s)\n", *port, rootDir)

	log.Fatal(http.ListenAndServe(addr, rootMux))
}
