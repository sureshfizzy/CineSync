package jobs

import (
	"encoding/json"
	"fmt"
	"time"

	"cinesync/pkg/db"
	"cinesync/pkg/logger"
)

// initJobsTable creates the jobs table if it doesn't exist
func initJobsTable() error {
	database, err := db.GetDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %v", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS jobs (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT,
		type TEXT NOT NULL,
		status TEXT NOT NULL,
		schedule_type TEXT NOT NULL,
		interval_seconds INTEGER,
		cron_expression TEXT,
		command TEXT NOT NULL,
		arguments TEXT, -- JSON array
		working_dir TEXT,
		enabled BOOLEAN NOT NULL DEFAULT 1,
		category TEXT,
		tags TEXT, -- JSON array
		dependencies TEXT, -- JSON array
		timeout_seconds INTEGER,
		max_retries INTEGER NOT NULL DEFAULT 0,
		log_output BOOLEAN NOT NULL DEFAULT 1,
		notify_on_failure BOOLEAN NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		last_execution DATETIME,
		last_duration INTEGER,
		next_execution DATETIME
	);`

	if _, err := database.Exec(createTableSQL); err != nil {
		return fmt.Errorf("failed to create jobs table: %v", err)
	}

	logger.Info("Jobs table initialized successfully")
	return nil
}

// saveJobToDB saves a job to the database
func saveJobToDB(job *Job) error {
	database, err := db.GetDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %v", err)
	}

	// Convert slices to JSON
	argumentsJSON, _ := json.Marshal(job.Arguments)
	tagsJSON, _ := json.Marshal(job.Tags)
	dependenciesJSON, _ := json.Marshal(job.Dependencies)

	var timeoutSeconds *int
	if job.Timeout != nil {
		seconds := int(job.Timeout.Seconds())
		timeoutSeconds = &seconds
	}

	var lastExecution, nextExecution *string
	if job.LastExecution != nil {
		lastExecStr := job.LastExecution.Format(time.RFC3339)
		lastExecution = &lastExecStr
	}
	if job.NextExecution != nil {
		nextExecStr := job.NextExecution.Format(time.RFC3339)
		nextExecution = &nextExecStr
	}

	var lastDuration *int
	if job.LastDuration != nil {
		duration := int(job.LastDuration.Seconds())
		lastDuration = &duration
	}

	insertSQL := `
	INSERT OR REPLACE INTO jobs (
		id, name, description, type, status, schedule_type, interval_seconds, cron_expression,
		command, arguments, working_dir, enabled, category, tags, dependencies,
		timeout_seconds, max_retries, log_output, notify_on_failure,
		created_at, updated_at, last_execution, last_duration, next_execution
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err = database.Exec(insertSQL,
		job.ID, job.Name, job.Description, job.Type, job.Status, job.ScheduleType,
		job.IntervalSeconds, job.CronExpression, job.Command, string(argumentsJSON),
		job.WorkingDir, job.Enabled, job.Category, string(tagsJSON), string(dependenciesJSON),
		timeoutSeconds, job.MaxRetries, job.LogOutput, job.NotifyOnFailure,
		job.CreatedAt.Format(time.RFC3339), job.UpdatedAt.Format(time.RFC3339),
		lastExecution, lastDuration, nextExecution,
	)

	if err != nil {
		return fmt.Errorf("failed to save job to database: %v", err)
	}

	return nil
}

// loadJobsFromDB loads all jobs from the database
func loadJobsFromDB() ([]*Job, error) {
	database, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection: %v", err)
	}

	selectSQL := `
	SELECT id, name, description, type, status, schedule_type, interval_seconds, cron_expression,
		   command, arguments, working_dir, enabled, category, tags, dependencies,
		   timeout_seconds, max_retries, log_output, notify_on_failure,
		   created_at, updated_at, last_execution, last_duration, next_execution
	FROM jobs`

	rows, err := database.Query(selectSQL)
	if err != nil {
		return nil, fmt.Errorf("failed to query jobs: %v", err)
	}
	defer rows.Close()

	var jobs []*Job
	for rows.Next() {
		job := &Job{}
		var argumentsJSON, tagsJSON, dependenciesJSON string
		var timeoutSeconds *int
		var lastExecution, nextExecution *string
		var lastDuration *int
		var createdAtStr, updatedAtStr string

		err := rows.Scan(
			&job.ID, &job.Name, &job.Description, &job.Type, &job.Status, &job.ScheduleType,
			&job.IntervalSeconds, &job.CronExpression, &job.Command, &argumentsJSON,
			&job.WorkingDir, &job.Enabled, &job.Category, &tagsJSON, &dependenciesJSON,
			&timeoutSeconds, &job.MaxRetries, &job.LogOutput, &job.NotifyOnFailure,
			&createdAtStr, &updatedAtStr, &lastExecution, &lastDuration, &nextExecution,
		)
		if err != nil {
			logger.Error("Failed to scan job row: %v", err)
			continue
		}

		// Parse JSON fields
		json.Unmarshal([]byte(argumentsJSON), &job.Arguments)
		json.Unmarshal([]byte(tagsJSON), &job.Tags)
		json.Unmarshal([]byte(dependenciesJSON), &job.Dependencies)

		// Parse timeout
		if timeoutSeconds != nil {
			timeout := time.Duration(*timeoutSeconds) * time.Second
			job.Timeout = &timeout
		}

		// Parse timestamps
		if createdAt, err := time.Parse(time.RFC3339, createdAtStr); err == nil {
			job.CreatedAt = createdAt
		}
		if updatedAt, err := time.Parse(time.RFC3339, updatedAtStr); err == nil {
			job.UpdatedAt = updatedAt
		}
		if lastExecution != nil {
			if lastExec, err := time.Parse(time.RFC3339, *lastExecution); err == nil {
				job.LastExecution = &lastExec
			}
		}
		if nextExecution != nil {
			if nextExec, err := time.Parse(time.RFC3339, *nextExecution); err == nil {
				job.NextExecution = &nextExec
			}
		}
		if lastDuration != nil {
			duration := time.Duration(*lastDuration) * time.Second
			job.LastDuration = &duration
		}

		jobs = append(jobs, job)
	}

	return jobs, nil
}

// deleteJobFromDB removes a job from the database
func deleteJobFromDB(jobID string) error {
	database, err := db.GetDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %v", err)
	}

	deleteSQL := `DELETE FROM jobs WHERE id = ?`
	_, err = database.Exec(deleteSQL, jobID)
	if err != nil {
		return fmt.Errorf("failed to delete job from database: %v", err)
	}

	return nil
}
