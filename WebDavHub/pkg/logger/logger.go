package logger

import (
	"fmt"
	"log"
	"os"
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
)

// Init initializes the logger with the specified log level from environment
func Init() {
	logLevel := os.Getenv("LOG_LEVEL")
        log.SetFlags(0)
	if logLevel == "" {
		// Default to INFO if not specified
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
