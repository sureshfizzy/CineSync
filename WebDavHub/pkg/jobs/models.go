package jobs

import (
	"fmt"
	"time"
)

// JobType represents the type of job
type JobType string

const (
	JobTypeProcess JobType = "process"
	JobTypeService JobType = "service"
	JobTypeCommand JobType = "command"
)

// JobStatus represents the current status of a job
type JobStatus string

const (
	JobStatusIdle      JobStatus = "idle"
	JobStatusRunning   JobStatus = "running"
	JobStatusCompleted JobStatus = "completed"
	JobStatusFailed    JobStatus = "failed"
	JobStatusCancelled JobStatus = "cancelled"
	JobStatusDisabled  JobStatus = "disabled"
)

// ScheduleType represents how a job is scheduled
type ScheduleType string

const (
	ScheduleTypeManual   ScheduleType = "manual"
	ScheduleTypeInterval ScheduleType = "interval"
	ScheduleTypeCron     ScheduleType = "cron"
	ScheduleTypeStartup  ScheduleType = "startup"
)

// Job represents a scheduled job
type Job struct {
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Description     string        `json:"description"`
	Type            JobType       `json:"type"`
	Status          JobStatus     `json:"status"`
	ScheduleType    ScheduleType  `json:"scheduleType"`
	IntervalSeconds int           `json:"intervalSeconds,omitempty"`
	CronExpression  string        `json:"cronExpression,omitempty"`
	Command         string        `json:"command"`
	Arguments       []string      `json:"arguments"`
	WorkingDir      string        `json:"workingDir"`
	Enabled         bool          `json:"enabled"`
	Category        string        `json:"category"`
	Tags            []string      `json:"tags"`
	Dependencies    []string      `json:"dependencies,omitempty"`
	Timeout         *time.Duration `json:"timeout,omitempty"`
	MaxRetries      int           `json:"maxRetries"`
	LogOutput       bool          `json:"logOutput"`
	NotifyOnFailure bool          `json:"notifyOnFailure,omitempty"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
	LastExecution   *time.Time    `json:"lastExecution,omitempty"`
	LastDuration    *time.Duration `json:"lastDuration,omitempty"`
	NextExecution   *time.Time    `json:"nextExecution,omitempty"`
	LastError       error         `json:"lastError,omitempty"`
}

// JobExecution represents a single execution of a job
type JobExecution struct {
	ID        string        `json:"id"`
	JobID     string        `json:"jobId"`
	Status    JobStatus     `json:"status"`
	StartTime time.Time     `json:"startTime"`
	EndTime   *time.Time    `json:"endTime,omitempty"`
	Duration  time.Duration `json:"duration,omitempty"`
	Output    string        `json:"output,omitempty"`
	Error     string        `json:"error,omitempty"`
	ExitCode  int           `json:"exitCode,omitempty"`
}

// UpdateJobRequest represents a request to update a job
type UpdateJobRequest struct {
	Name            string        `json:"name"`
	Description     string        `json:"description"`
	Type            JobType       `json:"type"`
	ScheduleType    ScheduleType  `json:"scheduleType"`
	IntervalSeconds int           `json:"intervalSeconds,omitempty"`
	CronExpression  string        `json:"cronExpression,omitempty"`
	Command         string        `json:"command"`
	Arguments       []string      `json:"arguments"`
	WorkingDir      string        `json:"workingDir"`
	Enabled         bool          `json:"enabled"`
	Category        string        `json:"category"`
	Tags            []string      `json:"tags"`
	Dependencies    []string      `json:"dependencies,omitempty"`
	Timeout         *time.Duration `json:"timeout,omitempty"`
	MaxRetries      int           `json:"maxRetries"`
	LogOutput       bool          `json:"logOutput"`
	NotifyOnFailure bool          `json:"notifyOnFailure,omitempty"`
}

// IsRunning returns true if the job is currently running
func (j *Job) IsRunning() bool {
	return j.Status == JobStatusRunning
}

// CanRun returns true if the job can be executed
func (j *Job) CanRun() bool {
	return j.Enabled && (j.Status == JobStatusIdle || j.Status == JobStatusCompleted || j.Status == JobStatusFailed)
}

// UpdateStatus updates the job status and last error
func (j *Job) UpdateStatus(status JobStatus, err error) {
	j.Status = status
	j.LastError = err
	j.UpdatedAt = time.Now()
}

// GetNextExecutionTime returns the stored next execution time
func (j *Job) GetNextExecutionTime() *time.Time {
	if !j.Enabled {
		return nil
	}

	if j.ScheduleType == ScheduleTypeManual {
		return nil
	}

	// For interval jobs, return the stored NextExecution time (set by timer)
	// For other job types, calculate as before
	switch j.ScheduleType {
	case ScheduleTypeInterval:
		return j.NextExecution
	case ScheduleTypeStartup:
		// Startup jobs run once at startup
		if j.LastExecution == nil {
			now := time.Now()
			return &now
		} else {
			return nil
		}
	default:
		return nil
	}
}

// Validate validates the job configuration
func (j *Job) Validate() error {
	if j.Name == "" {
		return fmt.Errorf("job name is required")
	}
	if j.Command == "" {
		return fmt.Errorf("job command is required")
	}
	if j.ScheduleType == ScheduleTypeInterval && j.IntervalSeconds <= 0 {
		return fmt.Errorf("interval seconds must be greater than 0 for interval jobs")
	}
	if j.ScheduleType == ScheduleTypeCron && j.CronExpression == "" {
		return fmt.Errorf("cron expression is required for cron jobs")
	}
	if j.MaxRetries < 0 {
		return fmt.Errorf("max retries cannot be negative")
	}
	return nil
}

// JobsResponse represents the response for listing jobs
type JobsResponse struct {
	Jobs   []Job  `json:"jobs"`
	Status string `json:"status"`
}

// JobExecutionResponse represents the response for job executions
type JobExecutionResponse struct {
	Executions []JobExecution `json:"executions"`
	Status     string         `json:"status"`
}
