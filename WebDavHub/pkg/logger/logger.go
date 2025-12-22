package logger

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LogLevel represents the severity of a log message
type LogLevel int

const (
	// DEBUG level for detailed troubleshooting information
	DEBUG LogLevel = iota
	// INFO level for general operational information
	INFO
	// WARN level for potentially harmful situations
	WARN
	// ERROR level for error events that might still allow the application to continue
	ERROR
	// FATAL level for severe error events that will lead the application to abort
	FATAL
)

var (
	// currentLevel is the current logging level
	currentLevel LogLevel = INFO
	// levelNames maps log levels to their string representations
	levelNames = map[LogLevel]string{
		DEBUG: "DEBUG",
		INFO:  "INFO",
		WARN:  "WARN",
		ERROR: "ERROR",
		FATAL: "FATAL",
	}
	// levelMap maps string representations to log levels
	levelMap = map[string]LogLevel{
		"DEBUG": DEBUG,
		"INFO":  INFO,
		"WARN":  WARN,
		"ERROR": ERROR,
		"FATAL": FATAL,
	}
	logFile *os.File
)

// Init initializes the logger with the specified log level from environment
func Init() {
	if err := setupLogFile(); err != nil {
		log.Printf("Failed to setup log file: %v, logging to stdout only", err)
	}

	logLevel := os.Getenv("LOG_LEVEL")
	log.SetFlags(0)
	if logLevel == "" {
		currentLevel = INFO
		return
	}

	level, exists := levelMap[strings.ToUpper(logLevel)]
	if !exists {
		log.Printf("Invalid LOG_LEVEL: %s, defaulting to INFO", logLevel)
		currentLevel = INFO
		return
	}

	currentLevel = level
}

// GetCurrentLevel returns the current logging level
func GetCurrentLevel() LogLevel {
	return currentLevel
}

// formatMessage formats a log message with timestamp and level
func formatMessage(level LogLevel, format string, args ...interface{}) string {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	levelStr := levelNames[level]
	message := fmt.Sprintf(format, args...)
	return fmt.Sprintf("%s [%s] %s", timestamp, levelStr, message)
}

// Debug logs a message at DEBUG level
func Debug(format string, args ...interface{}) {
	if currentLevel <= DEBUG {
		log.Println(formatMessage(DEBUG, format, args...))
	}
}

// Info logs a message at INFO level
func Info(format string, args ...interface{}) {
	if currentLevel <= INFO {
		log.Println(formatMessage(INFO, format, args...))
	}
}

// Warn logs a message at WARN level
func Warn(format string, args ...interface{}) {
	if currentLevel <= WARN {
		log.Println(formatMessage(WARN, format, args...))
	}
}

// Error logs a message at ERROR level
func Error(format string, args ...interface{}) {
	if currentLevel <= ERROR {
		log.Println(formatMessage(ERROR, format, args...))
	}
}

// Fatal logs a message at FATAL level and then exits the application
func Fatal(format string, args ...interface{}) {
	log.Fatalln(formatMessage(FATAL, format, args...))
}

// setupLogFile creates and configures the log file
func setupLogFile() error {
	var logsDir string
	if _, err := os.Stat("/.dockerenv"); err == nil || os.Getenv("CONTAINER") == "docker" {
		logsDir = "/app/logs"
	} else {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("failed to get current directory: %v", err)
		}

		basename := filepath.Base(cwd)
		if basename == "WebDavHub" {
			logsDir = filepath.Join(filepath.Dir(cwd), "logs")
		} else {
			logsDir = filepath.Join(cwd, "logs")
		}
	}

	if err := os.MkdirAll(logsDir, 0755); err != nil {
		return fmt.Errorf("failed to create logs directory: %v", err)
	}

	logPath := filepath.Join(logsDir, "cinesync.log")

	file, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %v", err)
	}

	logFile = file
	multiWriter := io.MultiWriter(file, os.Stdout)
	log.SetOutput(multiWriter)
	return nil
}

func Close() {
	if logFile != nil {
		logFile.Close()
	}
}