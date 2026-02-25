package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/jobs"
	"cinesync/pkg/logger"
)

var jobManager *jobs.Manager

// InitJobManager initializes the global job manager
func InitJobManager() {
	if jobManager == nil {
		jobManager = jobs.NewManager()
		logger.Info("Job manager initialized")
	}
}

// StopJobManager stops the global job manager
func StopJobManager() {
	if jobManager != nil {
		jobManager.Stop()
		logger.Info("Job manager stopped")
	}
}

// HandleJobs handles GET /api/jobs - list all jobs
func HandleJobs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if jobManager == nil {
		http.Error(w, "Job manager not initialized", http.StatusInternalServerError)
		return
	}

	jobsList := jobManager.GetJobs()

	response := jobs.JobsResponse{
		Jobs:   jobsList,
		Status: "success",
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Error("Failed to encode jobs response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// HandleJobDetails handles GET /api/jobs/{id} - get specific job details
func HandleJobDetails(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if jobManager == nil {
		http.Error(w, "Job manager not initialized", http.StatusInternalServerError)
		return
	}

	parts := getPathSegments(r, "/api/jobs")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Job ID is required", http.StatusBadRequest)
		return
	}
	jobID := parts[0]

	job, err := jobManager.GetJob(jobID)
	if err != nil {
		logger.Error("Failed to get job %s: %v", jobID, err)
		http.Error(w, fmt.Sprintf("Job not found: %s", jobID), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(job); err != nil {
		logger.Error("Failed to encode job response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// HandleJobUpdate handles PUT /api/jobs/{id} - update job configuration
func HandleJobUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if jobManager == nil {
		http.Error(w, "Job manager not initialized", http.StatusInternalServerError)
		return
	}

	parts := getPathSegments(r, "/api/jobs")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Job ID is required", http.StatusBadRequest)
		return
	}
	jobID := parts[0]

	// Parse request body
	var updateReq jobs.UpdateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&updateReq); err != nil {
		logger.Error("Failed to decode job update request: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Update the job
	err := jobManager.UpdateJob(jobID, updateReq)
	if err != nil {
		logger.Error("Failed to update job %s: %v", jobID, err)
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else if strings.Contains(err.Error(), "running job") {
			http.Error(w, err.Error(), http.StatusConflict)
		} else if strings.Contains(err.Error(), "invalid job configuration") {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	logger.Info("Job %s updated successfully", jobID)

	response := map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Job %s updated successfully", jobID),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleJobRun handles POST /api/jobs/{id}/run - run a job manually
func HandleJobRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if jobManager == nil {
		http.Error(w, "Job manager not initialized", http.StatusInternalServerError)
		return
	}

	parts := getPathSegments(r, "/api/jobs")
	if len(parts) < 2 || parts[1] != "run" {
		http.Error(w, "Invalid URL path", http.StatusBadRequest)
		return
	}
	jobID := parts[0]
	
	if jobID == "" {
		http.Error(w, "Job ID is required", http.StatusBadRequest)
		return
	}

	// Parse query parameters
	force := r.URL.Query().Get("force") == "true"

	err := jobManager.RunJob(jobID, force)
	if err != nil {
		logger.Error("Failed to run job %s: %v", jobID, err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	logger.Info("Job %s started manually", jobID)
	
	response := map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Job %s started successfully", jobID),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleJobCancel handles POST /api/jobs/{id}/cancel - cancel a running job
func HandleJobCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if jobManager == nil {
		http.Error(w, "Job manager not initialized", http.StatusInternalServerError)
		return
	}

	parts := getPathSegments(r, "/api/jobs")
	if len(parts) < 2 || parts[1] != "cancel" {
		http.Error(w, "Invalid URL path", http.StatusBadRequest)
		return
	}
	jobID := parts[0]
	
	if jobID == "" {
		http.Error(w, "Job ID is required", http.StatusBadRequest)
		return
	}

	err := jobManager.CancelJob(jobID)
	if err != nil {
		logger.Error("Failed to cancel job %s: %v", jobID, err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	logger.Info("Job %s cancelled", jobID)
	
	response := map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Job %s cancelled successfully", jobID),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleJobExecutions handles GET /api/jobs/{id}/executions - get job execution history
func HandleJobExecutions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if jobManager == nil {
		http.Error(w, "Job manager not initialized", http.StatusInternalServerError)
		return
	}

	parts := getPathSegments(r, "/api/jobs")
	if len(parts) < 2 || parts[1] != "executions" {
		http.Error(w, "Invalid URL path", http.StatusBadRequest)
		return
	}
	jobID := parts[0]
	
	if jobID == "" {
		http.Error(w, "Job ID is required", http.StatusBadRequest)
		return
	}

	// Parse limit parameter
	limit := 10 // default limit
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	executions := jobManager.GetJobExecutions(jobID, limit)
	
	response := jobs.JobExecutionResponse{
		Executions: executions,
		Status:     "success",
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Error("Failed to encode job executions response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// HandleJobsRouter routes job-related requests to appropriate handlers
func HandleJobsRouter(w http.ResponseWriter, r *http.Request) {
	parts := getPathSegments(r, "/api/jobs")

	// Handle /api/jobs (list all jobs)
	if len(parts) == 0 {
		HandleJobs(w, r)
		return
	}

	// Handle /api/jobs/{id}
	if len(parts) == 1 {
		if r.Method == http.MethodPut {
			HandleJobUpdate(w, r)
		} else {
			HandleJobDetails(w, r)
		}
		return
	}
	
	// Handle /api/jobs/{id}/action
	if len(parts) == 2 {
		action := parts[1]
		switch action {
		case "run":
			HandleJobRun(w, r)
		case "cancel":
			HandleJobCancel(w, r)
		case "executions":
			HandleJobExecutions(w, r)
		default:
			http.Error(w, fmt.Sprintf("Unknown action: %s", action), http.StatusBadRequest)
		}
		return
	}
	
	http.Error(w, "Invalid URL path", http.StatusBadRequest)
}

// HandleJobEvents handles GET /api/jobs/events - Server-Sent Events for job status updates
func HandleJobEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if jobManager == nil {
		http.Error(w, "Job manager not initialized", http.StatusInternalServerError)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Cache-Control")

	// Subscribe to job status updates
	subscriber := jobManager.Subscribe()
	defer jobManager.Unsubscribe(subscriber)

	// Send initial connection event
	fmt.Fprintf(w, "data: {\"type\":\"connected\",\"timestamp\":\"%s\"}\n\n", time.Now().Format(time.RFC3339))
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	// Listen for updates or client disconnect
	for {
		select {
		case <-r.Context().Done():
			return
		case update := <-subscriber:
			data, err := json.Marshal(map[string]interface{}{
				"type":      "job_update",
				"jobId":     update.JobID,
				"status":    update.Status,
				"message":   update.Message,
				"timestamp": update.Timestamp.Format(time.RFC3339),
			})
			if err != nil {
				logger.Error("Failed to marshal job update: %v", err)
				continue
			}

			fmt.Fprintf(w, "data: %s\n\n", string(data))
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		case <-time.After(30 * time.Second):
			fmt.Fprintf(w, "data: {\"type\":\"ping\",\"timestamp\":\"%s\"}\n\n", time.Now().Format(time.RFC3339))
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

