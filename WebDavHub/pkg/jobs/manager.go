package jobs

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/google/uuid"
	"cinesync/pkg/logger"
	"cinesync/pkg/env"
)

// fileExists checks if a file or directory exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

// getPythonCommand determines the correct Python executable based on the OS and environment
func getPythonCommand() string {
	if customPython := env.GetString("PYTHON_COMMAND", ""); customPython != "" {
		return customPython
	}

	// Default platform-specific behavior
	if runtime.GOOS == "windows" {
		return "python"
	}
	return "python3"
}

// JobStatusUpdate represents a job status change event
type JobStatusUpdate struct {
	JobID     string    `json:"jobId"`
	Status    JobStatus `json:"status"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

// Manager handles job scheduling and execution
type Manager struct {
	jobs        map[string]*Job
	executions  map[string]*JobExecution
	running     map[string]*exec.Cmd
	timers      map[string]*time.Timer
	mutex       sync.RWMutex
	ctx         context.Context
	cancel      context.CancelFunc
	pythonCmd   string
	mediaHubDir string
	// Channel for broadcasting job status updates
	statusUpdates chan JobStatusUpdate
	subscribers   map[chan JobStatusUpdate]bool
	subMutex      sync.RWMutex
}

// NewManager creates a new job manager
func NewManager() *Manager {
	ctx, cancel := context.WithCancel(context.Background())

	// Determine Python command based on OS and MediaHub directory
	pythonCmd := getPythonCommand()

	// Get MediaHub directory
	currentDir, _ := os.Getwd()
	mediaHubDir := filepath.Join(filepath.Dir(currentDir), "MediaHub")

	manager := &Manager{
		jobs:          make(map[string]*Job),
		executions:    make(map[string]*JobExecution),
		running:       make(map[string]*exec.Cmd),
		timers:        make(map[string]*time.Timer),
		ctx:           ctx,
		cancel:        cancel,
		pythonCmd:     pythonCmd,
		mediaHubDir:   mediaHubDir,
		statusUpdates: make(chan JobStatusUpdate, 100),
		subscribers:   make(map[chan JobStatusUpdate]bool),
	}

	manager.initializeDefaultJobs()
	manager.startJobTimers()
	manager.startBroadcaster()

	return manager
}

// initializeDefaultJobs creates the default CineSync jobs
func (m *Manager) initializeDefaultJobs() {
	// Get symlink cleanup interval from environment variable
	symlinkCleanupInterval := env.GetInt("SYMLINK_CLEANUP_INTERVAL", 600) // Default to 10 minutes if not set
	logger.Info("Symlink cleanup interval set to %d seconds", symlinkCleanupInterval)

	defaultJobs := []*Job{
		{
			ID:           "missing-files-check",
			Name:         "Missing Files Check",
			Description:  "Scan for missing source files and automatically trigger broken symlinks cleanup when source files no longer exist",
			Type:         JobTypeProcess,
			Status:       JobStatusIdle,
			ScheduleType: ScheduleTypeInterval,
			IntervalSeconds: symlinkCleanupInterval,
			Command:      m.pythonCmd,
			Arguments:    []string{filepath.Join(m.mediaHubDir, "utils", "Jobs", "database_maintenance_job.py"), "missing-files"},
			WorkingDir:   m.mediaHubDir,
			Enabled:      true,
			Category:     "Maintenance",
			Tags:         []string{"files", "validation", "database", "symlinks"},
			MaxRetries:   3,
			LogOutput:    true,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		},
		{
			ID:           "database-optimize",
			Name:         "Database Optimize",
			Description:  "Optimize database indexes and analyze tables for better performance",
			Type:         JobTypeProcess,
			Status:       JobStatusIdle,
			ScheduleType: ScheduleTypeManual,
			Command:      m.pythonCmd,
			Arguments:    []string{filepath.Join(m.mediaHubDir, "utils", "Jobs", "database_maintenance_job.py"), "optimize"},
			WorkingDir:   m.mediaHubDir,
			Enabled:      true,
			Category:     "Database",
			Tags:         []string{"database", "archive"},
			MaxRetries:   2,
			LogOutput:    true,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		},

		{
			ID:           "source-files-scan",
			Name:         "Source Files Scan",
			Description:  "Scan source directories for new and updated media files",
			Type:         JobTypeProcess,
			Status:       JobStatusIdle,
			ScheduleType: ScheduleTypeInterval,
			IntervalSeconds: 24 * 60 * 60, // 24 hours
			Command:      m.pythonCmd,
			Arguments:    []string{filepath.Join(m.mediaHubDir, "utils", "Jobs", "source_scan_job.py")},
			WorkingDir:   m.mediaHubDir,
			Enabled:      true,
			Category:     "Files",
			Tags:         []string{"source", "scan", "files", "discovery"},
			MaxRetries:   3,
			LogOutput:    true,
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		},
	}

	for _, job := range defaultJobs {
		m.jobs[job.ID] = job
	}
}

// startJobTimers starts individual timers for each interval job
func (m *Manager) startJobTimers() {

	for _, job := range m.jobs {
		if job.ScheduleType == ScheduleTypeInterval && job.Enabled {
			m.startJobTimer(job)
		}
	}
}

// startJobTimer starts a timer for a specific job
func (m *Manager) startJobTimer(job *Job) {
	if job.ScheduleType != ScheduleTypeInterval || !job.Enabled {
		return
	}

	duration := time.Duration(job.IntervalSeconds) * time.Second
	nextExecution := time.Now().Add(duration)

	timer := time.AfterFunc(duration, func() {
		m.executeJob(job.ID)
	})

	m.mutex.Lock()
	m.timers[job.ID] = timer
	job.NextExecution = &nextExecution
	m.mutex.Unlock()
}

// resetJobTimer resets the timer for a job after execution
func (m *Manager) resetJobTimer(jobID string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	job, exists := m.jobs[jobID]
	if !exists || job.ScheduleType != ScheduleTypeInterval || !job.Enabled {
		return
	}

	// Stop existing timer if any
	if timer, exists := m.timers[jobID]; exists {
		timer.Stop()
	}

	// Start new timer
	duration := time.Duration(job.IntervalSeconds) * time.Second
	nextExecution := time.Now().Add(duration)

	timer := time.AfterFunc(duration, func() {
		m.executeJob(jobID)
	})

	m.timers[jobID] = timer
	job.NextExecution = &nextExecution
}

// startBroadcaster starts the status update broadcaster
func (m *Manager) startBroadcaster() {
	go func() {
		for {
			select {
			case <-m.ctx.Done():
				return
			case update := <-m.statusUpdates:
				m.subMutex.RLock()
				for subscriber := range m.subscribers {
					select {
					case subscriber <- update:
					default:
					}
				}
				m.subMutex.RUnlock()
			}
		}
	}()
}

// Subscribe adds a new subscriber for job status updates
func (m *Manager) Subscribe() chan JobStatusUpdate {
	m.subMutex.Lock()
	defer m.subMutex.Unlock()

	subscriber := make(chan JobStatusUpdate, 10)
	m.subscribers[subscriber] = true
	return subscriber
}

func (m *Manager) Unsubscribe(subscriber chan JobStatusUpdate) {
	m.subMutex.Lock()
	defer m.subMutex.Unlock()

	delete(m.subscribers, subscriber)
	close(subscriber)
}

// broadcastStatusUpdate sends a status update to all subscribers
func (m *Manager) broadcastStatusUpdate(jobID string, status JobStatus, message string) {
	update := JobStatusUpdate{
		JobID:     jobID,
		Status:    status,
		Message:   message,
		Timestamp: time.Now(),
	}

	select {
	case m.statusUpdates <- update:
	default:
		logger.Warn("Status update channel is full, skipping update for job %s", jobID)
	}
}

// GetJobs returns all jobs
func (m *Manager) GetJobs() []Job {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	jobs := make([]Job, 0, len(m.jobs))
	for _, job := range m.jobs {
		// Update next execution time
		nextExec := job.GetNextExecutionTime()
		job.NextExecution = nextExec
		jobs = append(jobs, *job)
	}

	return jobs
}

// GetJob returns a specific job by ID
func (m *Manager) GetJob(id string) (*Job, error) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	job, exists := m.jobs[id]
	if !exists {
		return nil, fmt.Errorf("job not found: %s", id)
	}

	// Update next execution time
	nextExec := job.GetNextExecutionTime()
	job.NextExecution = nextExec

	return job, nil
}

// RunJob executes a job manually
func (m *Manager) RunJob(id string, force bool) error {
	m.mutex.RLock()
	job, exists := m.jobs[id]
	m.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("job not found: %s", id)
	}

	if !force && job.IsRunning() {
		return fmt.Errorf("job is already running: %s", id)
	}

	if !job.CanRun() && !force {
		return fmt.Errorf("job cannot be run: %s (status: %s, enabled: %t)", id, job.Status, job.Enabled)
	}

	go m.executeJob(id)
	return nil
}

// executeJob executes a job
func (m *Manager) executeJob(jobID string) {
	m.mutex.Lock()
	job, exists := m.jobs[jobID]
	if !exists {
		m.mutex.Unlock()
		return
	}

	// Create execution record
	execution := &JobExecution{
		ID:        uuid.New().String(),
		JobID:     jobID,
		Status:    JobStatusRunning,
		StartTime: time.Now(),
	}

	m.executions[execution.ID] = execution
	job.UpdateStatus(JobStatusRunning, nil)
	job.NextExecution = nil
	m.mutex.Unlock()

	logger.Debug("Starting job execution: %s (%s)", job.Name, jobID)
	m.broadcastStatusUpdate(jobID, JobStatusRunning, fmt.Sprintf("Job %s started", job.Name))

	// Create command
	cmd := exec.CommandContext(m.ctx, job.Command, job.Arguments...)
	if job.WorkingDir != "" {
		cmd.Dir = job.WorkingDir
	}

	// Set environment variables for the command
	cmd.Env = os.Environ()

	// Store running command
	m.mutex.Lock()
	m.running[jobID] = cmd
	m.mutex.Unlock()

	// Execute command
	startTime := time.Now()

	output, err := cmd.CombinedOutput()
	endTime := time.Now()
	duration := endTime.Sub(startTime)

	// Update execution record
	m.mutex.Lock()
	execution.EndTime = &endTime
	execution.Duration = duration
	execution.Output = string(output)

	if err != nil {
		execution.Status = JobStatusFailed
		execution.Error = err.Error()
		if exitError, ok := err.(*exec.ExitError); ok {
			execution.ExitCode = exitError.ExitCode()
		} else {
			execution.ExitCode = 1
		}
		job.UpdateStatus(JobStatusFailed, err)
		// Broadcast job failed
		m.broadcastStatusUpdate(jobID, JobStatusFailed, fmt.Sprintf("Job %s failed: %v", job.Name, err))
	} else {
		execution.Status = JobStatusCompleted
		execution.ExitCode = 0
		job.UpdateStatus(JobStatusCompleted, nil)
		// Broadcast job completed
		m.broadcastStatusUpdate(jobID, JobStatusCompleted, fmt.Sprintf("Job %s completed successfully", job.Name))
	}

	// Set LastExecution to completion time for proper interval scheduling
	job.LastExecution = &endTime
	job.LastDuration = &duration
	delete(m.running, jobID)

	m.mutex.Unlock()

	// Reset timer for interval jobs
	if job.ScheduleType == ScheduleTypeInterval && job.Enabled {
		logger.Debug("Job %s completed. Resetting timer for next execution in %d seconds", job.Name, job.IntervalSeconds)
		m.resetJobTimer(jobID)
	} else {
		logger.Debug("Job %s completed. No next execution scheduled (manual job)", job.Name)
	}
}

// CancelJob cancels a running job
func (m *Manager) CancelJob(id string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	job, exists := m.jobs[id]
	if !exists {
		return fmt.Errorf("job not found: %s", id)
	}

	cmd, isRunning := m.running[id]
	if !isRunning {
		return fmt.Errorf("job is not running: %s", id)
	}

	if cmd.Process != nil {
		err := cmd.Process.Kill()
		if err != nil {
			return fmt.Errorf("failed to cancel job: %v", err)
		}
	}

	job.UpdateStatus(JobStatusCancelled, nil)
	delete(m.running, id)

	logger.Info("Job cancelled: %s (%s)", job.Name, id)
	return nil
}

// GetJobExecutions returns executions for a job
func (m *Manager) GetJobExecutions(jobID string, limit int) []JobExecution {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	executions := make([]JobExecution, 0)
	for _, execution := range m.executions {
		if execution.JobID == jobID {
			executions = append(executions, *execution)
		}
	}

	// Sort by start time
	if len(executions) > limit && limit > 0 {
		executions = executions[:limit]
	}

	return executions
}

// Stop stops the job manager
func (m *Manager) Stop() {
	logger.Info("Stopping job manager...")
	m.cancel()

	// Cancel all running jobs and stop timers
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// Stop all timers
	for jobID, timer := range m.timers {
		timer.Stop()
		logger.Debug("Stopped timer for job %s", jobID)
	}

	// Cancel all running jobs
	for jobID, cmd := range m.running {
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		if job, exists := m.jobs[jobID]; exists {
			job.UpdateStatus(JobStatusCancelled, nil)
		}
	}
}
