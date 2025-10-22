package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
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
	"cinesync/pkg/config"
	"cinesync/pkg/auth"
	"cinesync/pkg/db"
	"cinesync/pkg/env"
	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
	"cinesync/pkg/server"
	"cinesync/pkg/spoofing"
	"cinesync/pkg/webdav"

	"github.com/joho/godotenv"
)

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

func main() {
	// Load .env from db directory
	dotenvPath := config.GetEnvFilePath()
	_ = godotenv.Load(dotenvPath)

	// Initialize logger early so we can use it for warnings
	logger.Init()
	env.LoadEnv()

	// Initialize spoofing configuration
	if err := spoofing.InitializeConfig(); err != nil {
		logger.Error("Failed to initialize spoofing configuration: %v", err)
		os.Exit(1)
	}

	rootDir := env.GetString("DESTINATION_DIR", "")
	if rootDir == "" {
		logger.Warn("DESTINATION_DIR not set in .env file")
		logger.Warn("Using current directory as fallback. Some functionality may not work properly.")
		logger.Warn("Consider setting DESTINATION_DIR in your .env file")
		rootDir = "."
	}

	// Define command-line flags with fallbacks from .env or hardcoded defaults
	dir := flag.String("dir", env.GetString("DESTINATION_DIR", "."), "Directory to serve over WebDAV")
	port := flag.Int("port", env.GetInt("CINESYNC_API_PORT", 8082), "Port to run the CineSync API server on")
	ip := flag.String("ip", env.GetString("CINESYNC_IP", "0.0.0.0"), "IP address to bind the server to")
	flag.Parse()

	logger.Debug("Starting with configuration: dir=%s, port=%d, ip=%s", *dir, *port, *ip)

	// Ensure the directory exists and is accessible
	if _, err := os.Stat(*dir); os.IsNotExist(err) {
		// Check if this is a placeholder path
		if *dir == "/path/to/destination" || *dir == "\\path\\to\\destination" {
			logger.Warn("DESTINATION_DIR is set to placeholder value: %s", *dir)
			logger.Warn("Using current directory as fallback. Some functionality may not work properly.")
			logger.Warn("Please set DESTINATION_DIR to a valid path in your .env file")
			*dir = "."
		} else {
			// Try to create the directory
			logger.Info("Directory %s does not exist, attempting to create it", *dir)
			if err := os.MkdirAll(*dir, 0755); err != nil {
				logger.Warn("Failed to create directory %s: %v", *dir, err)
				logger.Warn("Using current directory as fallback. Some functionality may not work properly.")
				logger.Warn("Please ensure DESTINATION_DIR is set to a valid path in your .env file")
				*dir = "."
			} else {
				logger.Info("Successfully created directory: %s", *dir)
			}
		}
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

	// Set up callback for updating root directory when configuration changes
	config.SetUpdateRootDirCallback(api.UpdateRootDir)

	projectDir := ".."
	api.InitializeImageCache(projectDir)

	// Initialize job manager
	api.InitJobManager()

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
	apiMux.HandleFunc("/api/realdebrid/status", api.HandleRealDebridStatus)
	apiMux.HandleFunc("/api/realdebrid/refresh", api.HandleRealDebridRefresh)
	apiMux.HandleFunc("/api/realdebrid/webdav/", api.HandleRealDebridWebDAV)
	apiMux.HandleFunc("/api/realdebrid/downloads", api.HandleRealDebridDownloads)
	apiMux.HandleFunc("/api/realdebrid/rclone/mount", api.HandleRcloneMount)
	apiMux.HandleFunc("/api/realdebrid/rclone/unmount", api.HandleRcloneUnmount)
	apiMux.HandleFunc("/api/realdebrid/rclone/status", api.HandleRcloneStatus)
	apiMux.HandleFunc("/api/realdebrid/rclone/test", api.HandleRcloneTest)

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

	// Auto-start MediaHub service if enabled (delayed to appear after startup summary)
	if env.IsBool("MEDIAHUB_AUTO_START", true) {
		go func() {
			// Wait longer for the server to fully initialize and startup summary to display
			time.Sleep(10 * time.Second)

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
		// Check if MediaHub auto-start is also enabled
		if env.IsBool("MEDIAHUB_AUTO_START", true) {
			logger.Warn("Both MEDIAHUB_AUTO_START and RTM_AUTO_START are enabled. MediaHub service includes RTM, so standalone RTM auto-start will be skipped.")
		}

		go func() {
			// Wait longer to ensure startup summary displays first
			time.Sleep(12 * time.Second)

			logger.Info("Auto-starting standalone Real-Time Monitor...")

			// Check multiple times to ensure MediaHub has had time to start
			for i := 0; i < 3; i++ {
				status, err := api.GetMediaHubStatus()
				if err != nil {
					logger.Warn("Failed to check MediaHub status for standalone RTM auto-start (attempt %d): %v", i+1, err)
					time.Sleep(2 * time.Second)
					continue
				}

				// Only start standalone RTM if MediaHub service is not running
				if status.IsRunning {
					logger.Info("MediaHub service is running, skipping standalone RTM auto-start")
					return
				}

				// If MediaHub auto-start is enabled, wait a bit more for it to start
				if env.IsBool("MEDIAHUB_AUTO_START", true) && i < 2 {
					logger.Debug("MediaHub auto-start is enabled but service not running yet, waiting...")
					time.Sleep(3 * time.Second)
					continue
				}

				break
			}

			// Final check and start RTM if needed
			status, err := api.GetMediaHubStatus()
			if err != nil {
				logger.Error("Failed final MediaHub status check for RTM auto-start: %v", err)
				return
			}

			if status.IsRunning {
				logger.Info("MediaHub service is running, standalone RTM auto-start cancelled")
				return
			}

			if !status.MonitorRunning {
				logger.Info("Starting standalone RTM automatically...")
				if err := api.StartMediaHubMonitorService(); err != nil {
					logger.Error("Failed to auto-start standalone RTM: %v", err)
				} else {
					logger.Info("Standalone RTM auto-started successfully")
				}
			} else {
				logger.Info("Standalone RTM is already running")
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
		os.Exit(0)
	}()

	// Start server
	addr := fmt.Sprintf("%s:%d", *ip, *port)
	rootInfo := *dir
	if effectiveRootDir != *dir {
		rootInfo = fmt.Sprintf("%s (using CineSync folder as root)", *dir)
	}

	logger.Info("CineSync server started on %s", addr)
	logger.Info("Serving content from: %s", rootInfo)

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
	server := &http.Server{
		Addr:         addr,
		Handler:      globalPanicRecoveryMiddleware(rootMux),
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  300 * time.Second,
	}

	log.Fatal(server.ListenAndServe())
}
