package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"cinesync/pkg/api"
	"cinesync/pkg/auth"
	"cinesync/pkg/config"
	"cinesync/pkg/db"
	"cinesync/pkg/env"
	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
	"cinesync/pkg/server"
	"cinesync/pkg/spoofing"
	"cinesync/pkg/webdav"

	"github.com/joho/godotenv"
)

//go:embed frontend/dist
var frontendFS embed.FS

// globalPanicRecoveryMiddleware provides top-level panic recovery for the entire server
func globalPanicRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				logger.Error("Global panic recovered for %s %s: %v", r.Method, r.URL.Path, err)

				buf := make([]byte, 1024)
				for {
					n := runtime.Stack(buf, false)
					if n < len(buf) {
						buf = buf[:n]
						break
					}
					buf = make([]byte, 2*len(buf))
				}
				logger.Error("Stack trace: %s", string(buf))

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				response := map[string]interface{}{
					"error":   "Internal Server Error",
					"message": "Service temporarily unavailable",
					"status":  500,
				}
				json.NewEncoder(w).Encode(response)
			}
		}()

		next.ServeHTTP(w, r)
	})
}

// getNetworkIP returns the local network IP address
func getNetworkIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "localhost"
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String()
}

// handleMediaCover serves poster and fanart images from the MediaCover directory
func handleMediaCover(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/MediaCover/")
	if path == "" {
		http.NotFound(w, r)
		return
	}

	// Construct the full file path
	filePath := filepath.Join("../db", "MediaCover", path)

	// Security check: ensure the path doesn't escape the MediaCover directory
	absMediaCoverDir, _ := filepath.Abs(filepath.Join("../db", "MediaCover"))
	absFilePath, _ := filepath.Abs(filePath)
	if !strings.HasPrefix(absFilePath, absMediaCoverDir) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	// Set appropriate content type based on file extension
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".webp":
		w.Header().Set("Content-Type", "image/webp")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
	}

	// Set cache headers for better performance
	w.Header().Set("Cache-Control", "public, max-age=86400") // Cache for 24 hours

	// Serve the file
	http.ServeFile(w, r, filePath)
}

// createFrontendHandler creates an HTTP handler for serving the embedded frontend
func createFrontendHandler() http.Handler {
	distFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		logger.Fatal("Failed to access embedded frontend: %v", err)
	}

	fileServer := http.FileServer(http.FS(distFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		lookupPath := strings.TrimPrefix(path, "/")
		file, err := distFS.Open(lookupPath)
		if err == nil {
			stat, err := file.Stat()
			file.Close()
			if err == nil && !stat.IsDir() {
				if strings.HasSuffix(lookupPath, ".html") || lookupPath == "index.html" || path == "/" {
					w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
					w.Header().Set("Pragma", "no-cache")
					w.Header().Set("Expires", "0")
				} else if strings.HasPrefix(lookupPath, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					w.Header().Set("Cache-Control", "public, max-age=86400")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		// Return 404 for missing assets instead of serving index.html
		if strings.HasPrefix(path, "/assets/") {
			http.NotFound(w, r)
			return
		}

		r.URL.Path = "/"
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		fileServer.ServeHTTP(w, r)
	})
}

func main() {
	// Load .env from db directory
	dotenvPath := config.GetEnvFilePath()
	_ = godotenv.Load(dotenvPath)

	// Initialize logger early so we can use it for warnings
	logger.Init()
	defer logger.Close()

	if err := env.LoadEnv(); err != nil {
	}

	// Initialize spoofing configuration
	if err := spoofing.InitializeConfig(); err != nil {
		logger.Error("Failed to initialize spoofing configuration: %v", err)
		os.Exit(1)
	}

	rootDir := env.GetString("DESTINATION_DIR", "")
	configMissing := false
	if rootDir == "" {
		configMissing = true
		logger.Info("DESTINATION_DIR not set. Awaiting configuration via /setup; server will start in limited mode.")
	}

	// Define command-line flags with fallbacks from .env or hardcoded defaults
	dir := flag.String("dir", env.GetString("DESTINATION_DIR", ""), "Directory to serve over WebDAV")
	port := flag.Int("port", env.GetInt("CINESYNC_PORT", 8082), "Port to run the CineSync server on (serves both API and UI)")
	ip := flag.String("ip", env.GetString("CINESYNC_IP", "0.0.0.0"), "IP address to bind the server to")
	flag.Parse()

	logger.Debug("Starting with configuration: dir=%s, port=%d, ip=%s", *dir, *port, *ip)

	// Ensure the directory exists and is accessible
	if *dir != "" {
		if _, err := os.Stat(*dir); os.IsNotExist(err) {
			// Check if this is a placeholder path
			if *dir == "/path/to/destination" || *dir == "\\path\\to\\destination" {
				logger.Warn("DESTINATION_DIR is set to placeholder value: %s", *dir)
				configMissing = true
			} else {
				logger.Info("Directory %s does not exist, attempting to create it", *dir)
				if err := os.MkdirAll(*dir, 0755); err != nil {
					logger.Warn("Failed to create directory %s: %v", *dir, err)
					configMissing = true
				} else {
					logger.Info("Successfully created directory: %s", *dir)
				}
			}
		}
	}

	if configMissing && *dir == "" {
		logger.Warn("No valid DESTINATION_DIR set. Running in configuration-only mode until setup is completed.")
	}

	// Always use DESTINATION_DIR as the effective root
	effectiveRootDir := *dir
	if effectiveRootDir == "" {
		effectiveRootDir = "."
	}

	// Initialize the server
	srv := server.NewServer(effectiveRootDir)
	if err := srv.Initialize(); err != nil {
		logger.Fatal("Failed to initialize server: %v", err)
	}

	// Set the root directory for file operations
	api.SetRootDir(effectiveRootDir)

	// Set up callback for updating root directory when configuration changes
	config.SetUpdateRootDirCallback(api.UpdateRootDir)

	projectDir := ".."
	api.InitializeImageCache(projectDir)

	// Initialize job manager
	if !configMissing {
		api.InitJobManager()
	} else {
		logger.Warn("Skipping job manager initialization until configuration is completed in /setup")
	}

	// Create a new mux for API routes
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("/api/health", api.HandleHealth)
	apiMux.HandleFunc("/api/config-status", api.HandleConfigStatus)
	apiMux.HandleFunc("/api/files/", api.HandleFiles)
	apiMux.HandleFunc("/api/browse", api.HandleBrowse)
	apiMux.HandleFunc("/api/scan-for-import", api.HandleScanForImport)
	apiMux.HandleFunc("/api/source-browse/", api.HandleSourceFiles)
	apiMux.HandleFunc("/api/stream/", api.HandleStream)
	apiMux.HandleFunc("/api/stats", api.HandleStats)
	apiMux.HandleFunc("/api/auth/test", api.HandleAuthTest)
	apiMux.HandleFunc("/api/auth/enabled", api.HandleAuthEnabled)
	apiMux.HandleFunc("/api/auth/login", auth.HandleLogin)
	apiMux.HandleFunc("/api/auth/check", auth.HandleAuthCheck)
	apiMux.HandleFunc("/api/readlink", api.HandleReadlink)
	apiMux.HandleFunc("/api/delete", api.HandleDelete)
	apiMux.HandleFunc("/api/restore-symlinks", api.HandleRestoreSymlinks)
	apiMux.HandleFunc("/api/rename", api.HandleRename)
	apiMux.HandleFunc("/api/move", api.HandleMove)
	apiMux.HandleFunc("/api/download", api.HandleDownload)
	apiMux.HandleFunc("/api/me", auth.HandleMe)
	apiMux.HandleFunc("/api/tmdb/search", api.WithTmdbValidation(api.HandleTmdbProxy))
	apiMux.HandleFunc("/api/tmdb/details", api.WithTmdbValidation(api.HandleTmdbDetails))
	apiMux.HandleFunc("/api/tmdb/category-content", api.WithTmdbValidation(api.HandleTmdbCategoryContent))
	apiMux.HandleFunc("/api/file-details", api.HandleFileDetails)
	apiMux.HandleFunc("/api/media-files", api.HandleMediaFiles)
	apiMux.HandleFunc("/api/tmdb-cache", api.HandleTmdbCache)
	apiMux.HandleFunc("/api/image-cache", api.HandleImageCache)
	apiMux.HandleFunc("/api/MediaCover/", spoofing.HandleMediaCover)

	apiMux.HandleFunc("/api/scan", api.HandleScan)
	apiMux.HandleFunc("/api/python-bridge", api.HandlePythonBridge)
	apiMux.HandleFunc("/api/python-bridge/input", api.HandlePythonBridgeInput)
	apiMux.HandleFunc("/api/python-bridge/message", api.HandlePythonMessage)
	apiMux.HandleFunc("/api/python-bridge/terminate", api.HandlePythonBridgeTerminate)
	apiMux.HandleFunc("/api/mediahub/message", api.HandleMediaHubMessage)
	apiMux.HandleFunc("/api/mediahub/events", api.HandleMediaHubEvents)
	apiMux.HandleFunc("/api/recent-media", api.HandleRecentMedia)
	apiMux.HandleFunc("/api/file-operations", db.HandleFileOperations)
	apiMux.HandleFunc("/api/file-operations/bulk", db.HandleFileOperations)
	apiMux.HandleFunc("/api/file-operations/failed", db.HandleFailedFileOperations)
	apiMux.HandleFunc("/api/file-operations/failed/export", db.HandleFailedFileOperationsExport)
	apiMux.HandleFunc("/api/file-operations/events", db.HandleFileOperationEvents)
	apiMux.HandleFunc("/api/database/source-files", db.HandleSourceFiles)
	apiMux.HandleFunc("/api/database/source-scans", db.HandleSourceScans)
	apiMux.HandleFunc("/api/dashboard/events", db.HandleDashboardEvents)
	apiMux.HandleFunc("/api/database/search", db.HandleDatabaseSearch)
	apiMux.HandleFunc("/api/database/stats", db.HandleDatabaseStats)
	apiMux.HandleFunc("/api/database/export", db.HandleDatabaseExport)
	apiMux.HandleFunc("/api/database/update", db.HandleDatabaseUpdate)
	apiMux.HandleFunc("/api/series", api.HandleSeries)
	apiMux.HandleFunc("/api/library/movie", api.HandleAddMovie)
	apiMux.HandleFunc("/api/library/series", api.HandleAddSeries)
	apiMux.HandleFunc("/api/library", api.HandleGetLibrary)
	apiMux.HandleFunc("/api/library/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			api.HandleUpdateLibraryItem(w, r)
		} else if r.Method == http.MethodDelete {
			api.HandleDeleteLibraryItem(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Root folders management endpoints
	apiMux.HandleFunc("/api/root-folders", api.HandleRootFolders)
	apiMux.HandleFunc("/api/root-folders/", api.HandleRootFolders)

	// Indexer management endpoints
	apiMux.HandleFunc("/api/indexers", api.HandleIndexers)
	apiMux.HandleFunc("/api/indexers/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/test") {
			api.HandleIndexerTest(w, r)
		} else if strings.HasSuffix(path, "/search") {
			api.HandleIndexerSearch(w, r)
		} else if strings.HasSuffix(path, "/caps") {
			api.HandleIndexerCaps(w, r)
		} else {
			api.HandleIndexerByID(w, r)
		}
	})

	apiMux.HandleFunc("/api/indexers/test-config", api.HandleIndexerTestConfig)
	apiMux.HandleFunc("/api/indexers/caps", api.HandleIndexerCaps)

	apiMux.HandleFunc("/api/config", config.HandleGetConfig)
	apiMux.HandleFunc("/api/config/update", config.HandleUpdateConfig)
	apiMux.HandleFunc("/api/config/update-silent", config.HandleUpdateConfigSilent)
	apiMux.HandleFunc("/api/config/events", config.HandleConfigEvents)
	apiMux.HandleFunc("/api/config/defaults", config.HandleGetDefaultConfig)
	apiMux.HandleFunc("/api/restart", api.HandleRestart)

	// Processing endpoints
	apiMux.HandleFunc("/api/processing/skip", api.HandleSkipProcessing)

	// MediaHub service endpoints
	apiMux.HandleFunc("/api/mediahub/status", api.HandleMediaHubStatus)
	apiMux.HandleFunc("/api/mediahub/start", api.HandleMediaHubStart)
	apiMux.HandleFunc("/api/mediahub/stop", api.HandleMediaHubStop)
	apiMux.HandleFunc("/api/mediahub/restart", api.HandleMediaHubRestart)
	apiMux.HandleFunc("/api/mediahub/logs", api.HandleMediaHubLogs)
	apiMux.HandleFunc("/api/mediahub/logs/export", api.HandleMediaHubLogsExport)
	apiMux.HandleFunc("/api/mediahub/monitor/start", api.HandleMediaHubMonitorStart)
	apiMux.HandleFunc("/api/mediahub/monitor/stop", api.HandleMediaHubMonitorStop)

	// Job management endpoints
	apiMux.HandleFunc("/api/jobs/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/jobs/events" {
			api.HandleJobEvents(w, r)
			return
		}
		api.HandleJobsRouter(w, r)
	})

	// Spoofing configuration endpoints with mux in context
	apiMux.HandleFunc("/api/spoofing/config", func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), "mux", apiMux)
		api.HandleSpoofingConfig(w, r.WithContext(ctx))
	})
	apiMux.HandleFunc("/api/spoofing/switch", func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), "mux", apiMux)
		api.HandleSpoofingSwitch(w, r.WithContext(ctx))
	})
	apiMux.HandleFunc("/api/spoofing/regenerate-key", func(w http.ResponseWriter, r *http.Request) {
		api.HandleRegenerateAPIKey(w, r)
	})

	// Real-Debrid configuration endpoints
	apiMux.HandleFunc("/api/realdebrid/config", api.HandleRealDebridConfig)
	apiMux.HandleFunc("/api/realdebrid/test", api.HandleRealDebridTest)
	apiMux.HandleFunc("/api/realdebrid/httpdav/test", api.HandleRealDebridHttpDavTest)
	apiMux.HandleFunc("/api/realdebrid/httpdav/", api.HandleRealDebridHttpDav)
	apiMux.HandleFunc("/api/realdebrid/status", api.HandleRealDebridStatus)
	apiMux.HandleFunc("/api/realdebrid/refresh", api.HandleRealDebridRefresh)
	apiMux.HandleFunc("/api/realdebrid/refresh-control", api.HandleRealDebridRefreshControl)
	apiMux.HandleFunc("/api/realdebrid/webdav/", api.HandleRealDebridWebDAV)
	apiMux.HandleFunc("/api/realdebrid/downloads", api.HandleRealDebridDownloads)
	apiMux.HandleFunc("/api/realdebrid/torrent-files", api.HandleRealDebridTorrentFiles)
	apiMux.HandleFunc("/api/realdebrid/unrestrict-file", api.HandleRealDebridUnrestrictFile)
	apiMux.HandleFunc("/api/realdebrid/rclone/mount", api.HandleRcloneMount)
	apiMux.HandleFunc("/api/realdebrid/rclone/unmount", api.HandleRcloneUnmount)
	apiMux.HandleFunc("/api/realdebrid/rclone/status", api.HandleRcloneStatus)
	apiMux.HandleFunc("/api/realdebrid/dashboard-stats", api.HandleDebridDashboardStats)
	apiMux.HandleFunc("/api/realdebrid/torrent-manager-stats", api.HandleTorrentManagerStats)
	apiMux.HandleFunc("/api/realdebrid/repair-status", api.HandleRepairStatus)
	apiMux.HandleFunc("/api/realdebrid/repair-queue", api.HandleRepairQueue)
	apiMux.HandleFunc("/api/realdebrid/repair-queue/delete", api.HandleRepairQueueDelete)
	apiMux.HandleFunc("/api/realdebrid/repair-all", api.HandleRepairAllFiltered)
	apiMux.HandleFunc("/api/realdebrid/repair-stats", api.HandleRepairStats)
	apiMux.HandleFunc("/api/realdebrid/repair-start", api.HandleRepairStart)
	apiMux.HandleFunc("/api/realdebrid/repair-stop", api.HandleRepairStop)
	apiMux.HandleFunc("/api/realdebrid/repair-torrent", api.HandleRepairTorrent)
	apiMux.HandleFunc("/api/realdebrid/repair-delete", api.HandleRepairDelete)

	// Register spoofing routes using the new spoofing package
	spoofing.RegisterRoutes(apiMux)

	// Use the new WebDAV handler from pkg/webdav
	webdavHandler := webdav.NewWebDAVHandler(effectiveRootDir)
	// Create a new mux for the main server
	rootMux := http.NewServeMux()

	// API handling
	apiRouter := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// For all /api/ paths, apply JWT middleware if CINESYNC_AUTH_ENABLED is true
		authRequired := env.IsBool("CINESYNC_AUTH_ENABLED", true)
		if authRequired {
			auth.JWTMiddleware(apiMux).ServeHTTP(w, r) // JWTMiddleware wraps the entire apiMux for protected routes
		} else {
			apiMux.ServeHTTP(w, r)
		}
	})
	rootMux.Handle("/api/", apiRouter)

	// SignalR Handler (for spoofing endpoints)
	signalrRouter := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiMux.ServeHTTP(w, r)
	})
	rootMux.Handle("/signalr/", signalrRouter)

	// WebDAV Handler
	rootMux.Handle("/webdav/", auth.BasicAuthMiddleware(http.StripPrefix("/webdav", webdavHandler)))

	// MediaCover Handler (no authentication required for poster images)
	rootMux.HandleFunc("/MediaCover/", handleMediaCover)

	// Serve embedded frontend files
	frontendHandler := createFrontendHandler()

	// Root path handler
	rootMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") ||
			strings.HasPrefix(r.URL.Path, "/webdav/") ||
			strings.HasPrefix(r.URL.Path, "/MediaCover/") ||
			strings.HasPrefix(r.URL.Path, "/signalr/") {
			http.NotFound(w, r)
			return
		}
		frontendHandler.ServeHTTP(w, r)
	})

	// Auto-mount rclone
	go func() {
		cfgMgr := realdebrid.GetConfigManager()
		cfg := cfgMgr.GetConfig()
		if !cfg.Enabled {
			return
		}
		rc := cfg.RcloneSettings
		if !rc.Enabled || !rc.AutoMountOnStart || rc.MountPath == "" {
			return
		}

		rcloneManager := realdebrid.GetRcloneManager()
		status := rcloneManager.GetStatus(rc.MountPath)
		if status != nil && status.Mounted {
			logger.Info("Rclone already mounted at startup on %s", rc.MountPath)
			realdebrid.SetMountReady()
			return
		}

		logger.Info("Auto-mounting rclone at startup: %s", rc.MountPath)
		if _, err := rcloneManager.Mount(rc, cfg.APIKey); err != nil {
			logger.Error("Auto-mount rclone failed: %v", err)
		}
	}()

	// Auto-start MediaHub service if enabled (delayed to appear after startup summary)
	if env.IsBool("MEDIAHUB_AUTO_START", true) {
		go func() {
			// Wait longer for the server to fully initialize and startup summary to display
			time.Sleep(10 * time.Second)

			// If inbuilt mount is configured, wait for it to be ready before starting MediaHub
			if realdebrid.IsMountConfigured() {
				logger.Info("Inbuilt mount is configured, waiting for mount to be ready before starting MediaHub...")

				for !realdebrid.IsMountReady() {
					time.Sleep(1 * time.Second)
				}
				logger.Info("Mount is ready, proceeding with MediaHub auto-start")
			}

			logger.Info("Auto-starting MediaHub service (includes built-in RTM)...")

			// Check if MediaHub is already running
			status, err := api.GetMediaHubStatus()
			if err != nil {
				logger.Warn("Failed to check MediaHub status for auto-start: %v", err)
				return
			}

			if !status.IsRunning {
				logger.Info("Starting MediaHub service automatically...")
				if err := api.StartMediaHubService(); err != nil {
					logger.Error("Failed to auto-start MediaHub service: %v", err)
				} else {
					logger.Info("MediaHub service auto-started successfully")
				}
			} else {
				logger.Info("MediaHub service is already running")
			}
		}()
	}

	// Auto-start standalone RTM if enabled (only when MediaHub service is not running)
	if env.IsBool("RTM_AUTO_START", false) {
		go func() {
			// Wait for server initialization
			time.Sleep(10 * time.Second)

			// Wait for mount to be ready if configured
			if realdebrid.IsMountConfigured() {
				for !realdebrid.IsMountReady() {
					time.Sleep(1 * time.Second)
				}
			}

			status, err := api.GetMediaHubStatus()
			if err != nil {
				logger.Error("Failed to check MediaHub status for RTM auto-start: %v", err)
				return
			}

			// Skip if MediaHub is running (it includes RTM)
			if status.IsRunning {
				return
			}

			if !status.MonitorRunning {
				logger.Info("Starting standalone RTM automatically...")
				if err := api.StartMediaHubMonitorService(); err != nil {
					logger.Error("Failed to auto-start standalone RTM: %v", err)
				}
			}
		}()
	}

	// Add shutdown handler to checkpoint WAL
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-shutdown
		logger.Info("Shutting down: cleaning up rclone mounts, stopping job manager and checkpointing SQLite WAL...")

		// Cleanup all rclone mounts
		rcloneManager := realdebrid.GetRcloneManager()
		rcloneManager.CleanupAllMounts()

		// Stop job manager and cleanup databases
		api.StopJobManager()
		if db.DB() != nil {
			db.DB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
			db.DB().Exec("PRAGMA optimize;")
			db.DB().Exec("VACUUM;")
		}
		if db.GetSourceDB() != nil {
			db.GetSourceDB().Exec("PRAGMA wal_checkpoint(TRUNCATE);")
			db.GetSourceDB().Exec("PRAGMA optimize;")
			db.CloseSourceDB()
		}
		if debridDB := db.GetDebridDB(); debridDB != nil {
			debridDB.Close()
		}
		os.Exit(0)
	}()

	// Start server
	addr := fmt.Sprintf("%s:%d", *ip, *port)

	logger.Info("CineSync server started on %s", addr)

	// Authentication status
	if env.IsBool("CINESYNC_AUTH_ENABLED", true) {
		credentials := auth.GetCredentials()
		logger.Info("Authentication enabled (username: %s)", credentials.Username)
	} else {
		logger.Warn("Authentication is disabled")
	}

	// Kick RD prefetch if configured
	go func() {
		time.Sleep(2 * time.Second)
		api.PrefetchRealDebridData()
	}()

	// Wrap the root mux with global panic recovery
	// HTTP server with no timeouts
	server := &http.Server{
		Addr:           addr,
		Handler:        globalPanicRecoveryMiddleware(rootMux),
		ReadTimeout:    0,
		WriteTimeout:   0,
		IdleTimeout:    300 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}

	log.Fatal(server.ListenAndServe())
}
