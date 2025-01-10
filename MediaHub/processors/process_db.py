import sqlite3
import os
import time
import threading
import sys
import concurrent.futures
import csv
import sqlite3
from typing import List, Tuple, Optional
from sqlite3 import DatabaseError
from functools import wraps
from dotenv import load_dotenv, find_dotenv
from MediaHub.utils.logging_utils import log_message

# Load environment variables
dotenv_path = find_dotenv('../.env')
if not dotenv_path:
    print(RED_COLOR + "Error: .env file not found in the parent directory." + RESET_COLOR)
    exit(1)

load_dotenv(dotenv_path)

DB_DIR = "db"
PROCESS_DB = os.path.join(DB_DIR, "file_database.db")

def initialize_file_database():
    with sqlite3.connect(PROCESS_DB) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS file_index (
                path TEXT PRIMARY KEY,
                is_symlink BOOLEAN,
                target_path TEXT,
                last_modified TIMESTAMP
            )
        ''')
        conn.commit()

def update_file_index(dest_dir):
    with sqlite3.connect(PROCESS_DB) as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM file_index')

        for root, _, files in os.walk(dest_dir):
            for file in files:
                full_path = os.path.join(root, file)
                is_symlink = os.path.islink(full_path)
                target_path = os.readlink(full_path) if is_symlink else None
                last_modified = os.path.getmtime(full_path)

                cursor.execute('''
                    INSERT INTO file_index (path, is_symlink, target_path, last_modified)
                    VALUES (?, ?, ?, ?)
                ''', (full_path, is_symlink, target_path, last_modified))

        conn.commit()

def get_dest_index_from_db():
    with sqlite3.connect(PROCESS_DB) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT path FROM file_index')
        return [row[0] for row in cursor.fetchall()]

def update_single_file_index(dest_file, is_symlink, target_path):
    """Update a single file entry in the database."""
    with sqlite3.connect(PROCESS_DB) as conn:
        cursor = conn.cursor()
        last_modified = os.path.getmtime(dest_file)
        cursor.execute('''
            INSERT OR REPLACE INTO file_index (path, is_symlink, target_path, last_modified)
            VALUES (?, ?, ?, ?)
        ''', (dest_file, is_symlink, target_path, last_modified))
        conn.commit()
