#!/usr/bin/env python3
"""
Script to populate file_size column for existing records in MediaHub database.
This will make storage calculations instant and accurate.
"""

import os
import sys
import sqlite3
import time
from pathlib import Path

# Add the project root directory to the path so we can import from MediaHub
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, project_root)

from MediaHub.processors.db_utils import main_pool, log_message, initialize_db
from MediaHub.processors.db_utils import with_connection, throttle, retry_on_db_lock

@throttle
@retry_on_db_lock
@with_connection(main_pool)
def populate_file_sizes(conn):
    """Populate file_size column for existing records"""
    try:
        cursor = conn.cursor()

        # Check if file_size column exists
        cursor.execute("PRAGMA table_info(processed_files)")
        columns = [column[1] for column in cursor.fetchall()]

        if "file_size" not in columns:
            log_message("file_size column does not exist. Adding it now...", level="INFO")
            cursor.execute("ALTER TABLE processed_files ADD COLUMN file_size INTEGER")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_size ON processed_files(file_size)")
            conn.commit()
            log_message("Added file_size column to processed_files table.", level="INFO")

        # Get all records that don't have file_size set
        cursor.execute("""
            SELECT file_path, destination_path
            FROM processed_files
            WHERE file_size IS NULL AND file_path IS NOT NULL
        """)
        
        records = cursor.fetchall()
        total_records = len(records)
        
        if total_records == 0:
            log_message("All records already have file sizes populated.", level="INFO")
            return
        
        log_message(f"Found {total_records} records without file sizes. Starting population...", level="INFO")
        
        updated_count = 0
        error_count = 0
        
        for i, (file_path, dest_path) in enumerate(records):
            if i % 100 == 0:
                log_message(f"Progress: {i}/{total_records} ({(i/total_records)*100:.1f}%)", level="INFO")
            
            file_size = None
            
            # Try to get size from source file first
            if file_path and os.path.exists(file_path):
                try:
                    file_size = os.path.getsize(file_path)
                except (OSError, IOError) as e:
                    log_message(f"Could not get size for source file {file_path}: {e}", level="DEBUG")
            
            # If source doesn't exist or failed, try destination
            if file_size is None and dest_path and os.path.exists(dest_path):
                try:
                    # For symlinks, get the size of the target file
                    if os.path.islink(dest_path):
                        target = os.readlink(dest_path)
                        if os.path.exists(target):
                            file_size = os.path.getsize(target)
                    else:
                        file_size = os.path.getsize(dest_path)
                except (OSError, IOError) as e:
                    log_message(f"Could not get size for destination file {dest_path}: {e}", level="DEBUG")
            
            # Update the record if we got a file size
            if file_size is not None:
                try:
                    cursor.execute("""
                        UPDATE processed_files 
                        SET file_size = ? 
                        WHERE file_path = ?
                    """, (file_size, file_path))
                    updated_count += 1
                    
                    if updated_count <= 5:  # Log first few for verification
                        log_message(f"Updated {os.path.basename(file_path)}: {file_size} bytes ({file_size/(1024*1024):.2f} MB)", level="INFO")
                        
                except sqlite3.Error as e:
                    log_message(f"Database error updating {file_path}: {e}", level="ERROR")
                    error_count += 1
            else:
                error_count += 1
                if error_count <= 5:  # Log first few errors
                    log_message(f"Could not determine size for {file_path}", level="WARNING")
        
        # Commit all changes
        conn.commit()
        
        log_message(f"File size population completed:", level="INFO")
        log_message(f"  - Total records processed: {total_records}", level="INFO")
        log_message(f"  - Successfully updated: {updated_count}", level="INFO")
        log_message(f"  - Errors/missing files: {error_count}", level="INFO")
        log_message(f"  - Success rate: {(updated_count/total_records)*100:.1f}%", level="INFO")
        
        # Show storage summary
        cursor.execute("SELECT SUM(file_size) FROM processed_files WHERE file_size IS NOT NULL")
        total_size = cursor.fetchone()[0] or 0
        log_message(f"Total storage calculated: {total_size} bytes ({total_size/(1024*1024*1024):.2f} GB)", level="INFO")
        
        return updated_count, error_count
        
    except Exception as e:
        log_message(f"Error in populate_file_sizes: {e}", level="ERROR")
        conn.rollback()
        return 0, 0

def main():
    """Main function to run the file size population"""
    log_message("Starting file size population script...", level="INFO")
    start_time = time.time()

    try:
        # Initialize database first to ensure file_size column exists
        log_message("Initializing database schema...", level="INFO")
        initialize_db()

        updated, errors = populate_file_sizes()
        duration = time.time() - start_time

        log_message(f"Script completed in {duration:.2f} seconds", level="INFO")
        log_message(f"Updated {updated} records, {errors} errors", level="INFO")

        if updated > 0:
            log_message("File sizes have been populated! Storage calculations will now be instant and accurate.", level="INFO")

    except Exception as e:
        log_message(f"Script failed: {e}", level="ERROR")
        return 1

    return 0

if __name__ == "__main__":
    exit(main())
