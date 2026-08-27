import sqlite3
import os
import shutil

def get_user_data_dir():
    """Returns the path to the user's Documents/VANT YT Downloader directory."""
    docs_dir = os.path.join(os.path.expanduser('~'), 'Documents')
    if not os.path.exists(docs_dir):
        docs_dir = os.path.join(os.environ.get('USERPROFILE', os.path.expanduser('~')), 'Documents')
    
    if not os.path.exists(docs_dir):
        docs_dir = os.path.expanduser('~')
        
    app_data_dir = os.path.join(docs_dir, 'VANT YT Downloader')
    os.makedirs(app_data_dir, exist_ok=True)
    return app_data_dir

DATA_DIR = get_user_data_dir()
DB_PATH = os.path.join(DATA_DIR, "app.db")

def get_connection():
    return sqlite3.connect(DB_PATH)

def init_db():
    # Seamless migration: If old app.db exists in project directory and not in Documents, copy it over
    legacy_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.db")
    if os.path.exists(legacy_db) and not os.path.exists(DB_PATH):
        try:
            shutil.copy2(legacy_db, DB_PATH)
            print(f"Migrated legacy database from {legacy_db} to {DB_PATH}")
        except Exception as e:
            print(f"Error migrating legacy database: {e}")

    conn = get_connection()
    cursor = conn.cursor()
    
    # Create library table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE NOT NULL,
            title TEXT,
            type TEXT NOT NULL,
            thumbnail TEXT,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Migrate: add thumbnail column to library if missing
    try:
        cursor.execute("ALTER TABLE library ADD COLUMN thumbnail TEXT")
    except Exception:
        pass  # Column already exists
    
    # Create downloads table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            format TEXT NOT NULL,
            resolution TEXT,
            status TEXT NOT NULL,
            progress REAL DEFAULT 0.0,
            path TEXT,
            file_size INTEGER DEFAULT 0,
            thumbnail TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Migrate: add file_size column if missing (for existing databases)
    try:
        cursor.execute("ALTER TABLE downloads ADD COLUMN file_size INTEGER DEFAULT 0")
    except Exception:
        pass  # Column already exists
        
    # Migrate: add thumbnail column if missing
    try:
        cursor.execute("ALTER TABLE downloads ADD COLUMN thumbnail TEXT")
    except Exception:
        pass  # Column already exists

    # Create settings table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    
    conn.commit()
    conn.close()

def get_setting(key, default=None):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row[0] if row else default
    except Exception as e:
        print(f"Error getting setting {key}: {e}")
        return default
    finally:
        conn.close()

def set_setting(key, value):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
        conn.commit()
        return True
    except Exception as e:
        print(f"Error setting {key}: {e}")
        return False
    finally:
        conn.close()


# Library Operations
def add_to_library(url, title, item_type, thumbnail=None):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT OR REPLACE INTO library (url, title, type, thumbnail) VALUES (?, ?, ?, ?)",
            (url, title, item_type, thumbnail)
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Error adding to library: {e}")
        return False
    finally:
        conn.close()

def remove_from_library(item_id):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM library WHERE id = ?", (item_id,))
        conn.commit()
        return True
    except Exception as e:
        print(f"Error removing from library: {e}")
        return False
    finally:
        conn.close()

def get_library():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM library ORDER BY added_at DESC")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        print(f"Error fetching library: {e}")
        return []
    finally:
        conn.close()

# Download Operations
def add_download(url, title, file_format, resolution, path, thumbnail=None):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO downloads (url, title, format, resolution, status, progress, path, thumbnail) VALUES (?, ?, ?, ?, 'downloading', 0.0, ?, ?)",
            (url, title, file_format, resolution, path, thumbnail)
        )
        conn.commit()
        return cursor.lastrowid
    except Exception as e:
        print(f"Error adding download: {e}")
        return None
    finally:
        conn.close()

def update_download_status(download_id, status, progress, path=None, file_size=0):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if path:
            cursor.execute(
                "UPDATE downloads SET status = ?, progress = ?, path = ?, file_size = ? WHERE id = ?",
                (status, progress, path, file_size, download_id)
            )
        else:
            cursor.execute(
                "UPDATE downloads SET status = ?, progress = ?, file_size = ? WHERE id = ?",
                (status, progress, file_size, download_id)
            )
        conn.commit()
        return True
    except Exception as e:
        print(f"Error updating download: {e}")
        return False
    finally:
        conn.close()

def get_downloads():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM downloads ORDER BY created_at DESC")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    except Exception as e:
        print(f"Error fetching downloads: {e}")
        return []
    finally:
        conn.close()

def clear_downloads_history():
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Clear only finished or failed, keep downloading ones?
        # Actually, let's clear all completed/failed ones, and leave active if any, 
        # or just delete everything. Let's delete all completed/failed.
        cursor.execute("DELETE FROM downloads WHERE status IN ('completed', 'failed')")
        conn.commit()
        return True
    except Exception as e:
        print(f"Error clearing history: {e}")
        return False
    finally:
        conn.close()

def delete_download(download_id):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Get the file path on disk before deleting the database record
        cursor.execute("SELECT path FROM downloads WHERE id = ?", (download_id,))
        row = cursor.fetchone()
        file_path = row[0] if row else None

        cursor.execute("DELETE FROM downloads WHERE id = ?", (download_id,))
        conn.commit()

        # Delete the file from the disk if it exists
        if file_path and os.path.isfile(file_path):
            try:
                os.remove(file_path)
            except Exception as file_err:
                print(f"Error removing file from disk: {file_err}")
                
        return True
    except Exception as e:
        print(f"Error deleting download: {e}")
        return False
    finally:
        conn.close()

def clear_all_data():
    """Clears all saved library items, downloads history, and user settings from database."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM library")
        cursor.execute("DELETE FROM downloads")
        cursor.execute("DELETE FROM settings")
        conn.commit()
        return True
    except Exception as e:
        print(f"Error clearing all data: {e}")
        return False
    finally:
        conn.close()

