package realdebrid

import (
    "database/sql"
    "encoding/json"
    "errors"
    "path"
	"strings"
    "time"

    _ "modernc.org/sqlite"
)

// TorrentStore is a lightweight SQLite-backed store for torrent metadata and details.
type TorrentStore struct {
    db *sql.DB
}

// DirEntry represents a directory-level entry for WebDAV
type DirEntry struct {
    ID       string
    Filename string
    Bytes    int64
    Files    int
    Status   string
    Added    string
    Modified int64
}

// OpenTorrentStore opens/creates the SQLite database at the given path and ensures schema.
func OpenTorrentStore(dbPath string) (*TorrentStore, error) {
    dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)"
    db, err := sql.Open("sqlite", dsn)
    if err != nil {
        return nil, err
    }

    db.SetMaxOpenConns(64)
    db.SetMaxIdleConns(32)

    // Checkpoint WAL immediately on open to prevent blocking
    if _, err := db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
        if _, err := db.Exec(`PRAGMA wal_checkpoint(RESTART)`); err != nil {
            _, _ = db.Exec(`PRAGMA wal_checkpoint(PASSIVE)`)
        }
    }

    // Performance-oriented pragmas
    _, _ = db.Exec(`PRAGMA synchronous=NORMAL`)
    _, _ = db.Exec(`PRAGMA cache_size=-20000`)
    _, _ = db.Exec(`PRAGMA temp_store=MEMORY`)
    _, _ = db.Exec(`PRAGMA journal_size_limit=67108864`)
    _, _ = db.Exec(`PRAGMA wal_autocheckpoint=1000`)
    _, _ = db.Exec(`PRAGMA mmap_size=134217728`)

    if err := initSchema(db); err != nil {
        _ = db.Close()
        return nil, err
    }

    return &TorrentStore{db: db}, nil
}

// BulkUpsertItems writes many TorrentItem rows in a single transaction.
func (s *TorrentStore) BulkUpsertItems(items []TorrentItem, onProgress func(int)) error {
    if s == nil { return errors.New("store not initialized") }
    if len(items) == 0 { return nil }
    tx, err := s.db.Begin()
    if err != nil { return err }
    defer func() { _ = tx.Rollback() }()

    stmt, err := tx.Prepare(`
        INSERT INTO torrents(id, filename, bytes, files, status, added, modified, updated_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          filename=excluded.filename,
          bytes=excluded.bytes,
          files=excluded.files,
          status=excluded.status,
          added=excluded.added,
          modified=COALESCE(torrents.modified, excluded.modified),
          updated_at=excluded.updated_at
    `)
    if err != nil { return err }
    defer stmt.Close()

    now := time.Now().Unix()
    wrote := 0
    for i := range items {
        it := items[i]
        normName := GetDirectoryName(it.Filename)
        if _, err := stmt.Exec(it.ID, normName, it.Bytes, it.Files, it.Status, it.Added, timeNowOr("", it.Added), now); err != nil {
            return err
        }
        wrote++
        if onProgress != nil && (wrote%2000 == 0 || wrote == len(items)) {
            onProgress(wrote)
        }
    }
    return tx.Commit()
}

func initSchema(db *sql.DB) error {
    // Create torrents table
    _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS torrents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    files INTEGER DEFAULT 0,
    status TEXT NOT NULL,
    added TEXT,
    hash TEXT,
    modified INTEGER,
    links TEXT,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_torrents_status ON torrents(status);
`)
    if err != nil {
        return err
    }

    // Create repair table to track broken/problematic torrents
    _, err = db.Exec(`
CREATE TABLE IF NOT EXISTS repair (
    torrent_id TEXT PRIMARY KEY,
    filename   TEXT,
    hash       TEXT,
    status     TEXT,
    progress   INTEGER,
    reason     TEXT,
    updated_at INTEGER NOT NULL
)`)
    if err != nil {
        return err
    }
    
    // Migrate: Add hash column if it doesn't exist (for existing databases)
    _, err = db.Exec(`ALTER TABLE repair ADD COLUMN hash TEXT`)
    if err != nil && !strings.Contains(err.Error(), "duplicate column") && !strings.Contains(err.Error(), "already exists") {
        _ = err
    }
    
    // Create repair_state table to track last check time for each torrent
    _, err = db.Exec(`
CREATE TABLE IF NOT EXISTS repair_state (
    torrent_id TEXT PRIMARY KEY,
    last_checked INTEGER NOT NULL,
    is_broken INTEGER NOT NULL DEFAULT 0,
    broken_count INTEGER DEFAULT 0,
    link_count INTEGER DEFAULT 0
)`)
    
    return err
}

func (s *TorrentStore) Close() error {
    if s == nil || s.db == nil {
        return nil
    }
    // Checkpoint WAL before closing
    _, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
    _, _ = s.db.Exec(`PRAGMA optimize`)
    return s.db.Close()
}

// UpsertItem inserts/updates a lightweight TorrentItem.
func (s *TorrentStore) UpsertItem(it TorrentItem) error {
    if s == nil { return errors.New("store not initialized") }
    now := time.Now().Unix()
    normName := GetDirectoryName(it.Filename)
    _, err := execWithRetry(s.db,
        `INSERT INTO torrents(id, filename, bytes, files, status, added, modified, updated_at)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           filename=excluded.filename,
           bytes=excluded.bytes,
           files=excluded.files,
           status=excluded.status,
           added=excluded.added,
           modified=COALESCE(torrents.modified, excluded.modified),
           updated_at=excluded.updated_at`,
        it.ID, normName, it.Bytes, it.Files, it.Status, it.Added, timeNowOr("", it.Added), now,
    )
    return err
}

// UpsertInfo inserts/updates full TorrentInfo summary (no payload) and links.
func (s *TorrentStore) UpsertInfo(info *TorrentInfo) error {
    if s == nil { return errors.New("store not initialized") }
    normName := GetDirectoryName(info.Filename)
    cloned := *info
    if len(info.Files) > 0 {
        files := make([]TorrentFile, len(info.Files))
        for i := range info.Files {
            f := info.Files[i]
            base := path.Base(f.Path)
            if base == "." || base == "" { base = f.Path }
            f.Path = "/" + ALL_TORRENTS + "/" + normName + "/" + base
            files[i] = f
        }
        cloned.Files = files
    }

    now := time.Now().Unix()
    linksJSON, _ := json.Marshal(info.Links)
    _, err := execWithRetry(s.db,
        `INSERT INTO torrents(id, filename, bytes, files, status, added, hash, modified, links, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           filename=excluded.filename,
           bytes=excluded.bytes,
           files=excluded.files,
           status=excluded.status,
           added=excluded.added,
           hash=excluded.hash,
           modified=COALESCE(torrents.modified, excluded.modified),
           links=excluded.links,
           updated_at=excluded.updated_at`,
        info.ID, normName, info.Bytes, len(info.Files), info.Status, info.Added, info.Hash, timeNowOr(info.Ended, info.Added), string(linksJSON), now,
    )
    return err
}

// Has returns whether an id exists in the store.
func (s *TorrentStore) Has(id string) (bool, error) {
    if s == nil { return false, errors.New("store not initialized") }
    var x int
    err := s.db.QueryRow(`SELECT 1 FROM torrents WHERE id=? LIMIT 1`, id).Scan(&x)
    if err == sql.ErrNoRows { return false, nil }
    return err == nil, err
}

// NeedsUpdate compares core fields and returns true if an item differs from the stored row.
func (s *TorrentStore) NeedsUpdate(it TorrentItem) (bool, error) {
    if s == nil { return true, errors.New("store not initialized") }
    var filename string
    var bytes int64
    var status string
    var files int
    var hash sql.NullString
    err := s.db.QueryRow(`SELECT filename, bytes, status, files, hash FROM torrents WHERE id=?`, it.ID).Scan(&filename, &bytes, &status, &files, &hash)
    if err == sql.ErrNoRows { return true, nil }
    if err != nil { return true, err }
    if !hash.Valid || hash.String == "" { return true, nil }
    if filename != it.Filename || bytes != it.Bytes || status != it.Status || files != it.Files { return true, nil }
    return false, nil
}

// GetAllItems returns all items currently in the store.
func (s *TorrentStore) GetAllItems() ([]TorrentItem, error) {
    rows, err := s.db.Query(`SELECT id, filename, bytes, files, status, added FROM torrents`)
    if err != nil { return nil, err }
    defer rows.Close()
    var items []TorrentItem
    for rows.Next() {
        var it TorrentItem
        if err := rows.Scan(&it.ID, &it.Filename, &it.Bytes, &it.Files, &it.Status, &it.Added); err != nil { return nil, err }
        items = append(items, it)
    }
    return items, rows.Err()
}

// GetItemByID returns a single torrent item by its ID
func (s *TorrentStore) GetItemByID(id string) (TorrentItem, error) {
    var it TorrentItem
    err := s.db.QueryRow(`SELECT id, filename, bytes, files, status, added FROM torrents WHERE id=?`, id).
        Scan(&it.ID, &it.Filename, &it.Bytes, &it.Files, &it.Status, &it.Added)
    if err != nil {
        return TorrentItem{}, err
    }
    return it, nil
}

// GetReadyDirs returns directory entries that are ready to serve.
// Each entry includes id, filename, bytes, files, status, added, modified.
func (s *TorrentStore) GetReadyDirs() ([]TorrentItem, error) {
    rows, err := s.db.Query(`SELECT id, filename, bytes, files, status, added FROM torrents WHERE links IS NOT NULL AND links<>'' AND links<>'[]'`)
    if err != nil { return nil, err }
    defer rows.Close()
    var items []TorrentItem
    for rows.Next() {
        var it TorrentItem
        if err := rows.Scan(&it.ID, &it.Filename, &it.Bytes, &it.Files, &it.Status, &it.Added); err != nil { return nil, err }
        items = append(items, it)
    }
    return items, rows.Err()
}

// GetAllDirs returns all directory entries from the DB.
func (s *TorrentStore) GetAllDirs() ([]TorrentItem, error) {
    rows, err := s.db.Query(`SELECT id, filename, bytes, files, status, added FROM torrents`)
    if err != nil { return nil, err }
    defer rows.Close()
    var items []TorrentItem
    for rows.Next() {
        var it TorrentItem
        if err := rows.Scan(&it.ID, &it.Filename, &it.Bytes, &it.Files, &it.Status, &it.Added); err != nil { return nil, err }
        items = append(items, it)
    }
    return items, rows.Err()
}

// GetDirs returns directory entries; when readyOnly is true, only entries with links are returned.
// It includes modified for human-readable listings.
func (s *TorrentStore) GetDirs(readyOnly bool) ([]DirEntry, error) {
    base := `SELECT id, filename, bytes, files, status, added, COALESCE(modified, 0) as modified FROM torrents`
    if readyOnly {
        base += ` WHERE links IS NOT NULL AND links<>'' AND links<>'[]'`
    }
    rows, err := s.db.Query(base)
    if err != nil { return nil, err }
    defer rows.Close()
    var items []DirEntry
    for rows.Next() {
        var it DirEntry
        if err := rows.Scan(&it.ID, &it.Filename, &it.Bytes, &it.Files, &it.Status, &it.Added, &it.Modified); err != nil {
            return nil, err
        }
        items = append(items, it)
    }
    return items, rows.Err()
}

// GetAllIDs returns all torrent IDs present in the DB.
func (s *TorrentStore) GetAllIDs() ([]string, error) {
    rows, err := s.db.Query(`SELECT id FROM torrents`)
    if err != nil { return nil, err }
    defer rows.Close()
    var ids []string
    for rows.Next() {
        var id string
        if err := rows.Scan(&id); err != nil { return nil, err }
        ids = append(ids, id)
    }
    return ids, rows.Err()
}

// GetModifiedUnix returns the stored modified unix time for a torrent id, or 0 if not found.
func (s *TorrentStore) GetModifiedUnix(id string) (int64, bool, error) {
    if s == nil { return 0, false, errors.New("store not initialized") }
    var m sql.NullInt64
    err := s.db.QueryRow(`SELECT modified FROM torrents WHERE id=?`, id).Scan(&m)
    if err == sql.ErrNoRows { return 0, false, nil }
    if err != nil { return 0, false, err }
    if !m.Valid { return 0, false, nil }
    return m.Int64, true, nil
}

// DeleteByID removes one torrent row and any repair row.
func (s *TorrentStore) DeleteByID(id string) error {
    if s == nil { return errors.New("store not initialized") }
    if _, err := execWithRetry(s.db, `DELETE FROM repair WHERE torrent_id=?`, id); err != nil { return err }
    _, err := execWithRetry(s.db, `DELETE FROM torrents WHERE id=?`, id)
    return err
}

// Count returns number of rows.
func (s *TorrentStore) Count() (int, error) {
    var n int
    err := s.db.QueryRow(`SELECT COUNT(*) FROM torrents`).Scan(&n)
    return n, err
}

// GetIDsNeedingUpdate returns candidate torrent IDs for enrichment.
func (s *TorrentStore) GetIDsNeedingUpdate(limit int) ([]string, error) {
    if s == nil { return nil, errors.New("store not initialized") }
    base := `SELECT t.id FROM torrents t
             LEFT JOIN repair r ON r.torrent_id = t.id
             WHERE (t.hash IS NULL OR t.hash='') AND r.torrent_id IS NULL
             ORDER BY t.updated_at ASC`
    var rows *sql.Rows
    var err error
    if limit > 0 {
        q := base + ` LIMIT ?`
        rows, err = s.db.Query(q, limit)
    } else {
        rows, err = s.db.Query(base)
    }
    if err != nil { return nil, err }
    defer rows.Close()
    ids := make([]string, 0, 1024)
    for rows.Next() {
        var id string
        if err := rows.Scan(&id); err != nil { return nil, err }
        ids = append(ids, id)
    }
    return ids, rows.Err()
}

// UpsertRepair records a torrent that needs repair or is not yet ready (e.g., links missing).
func (s *TorrentStore) UpsertRepair(id, filename, hash, status string, progress int, reason string) error {
    if s == nil { return errors.New("store not initialized") }
    now := time.Now().Unix()
    _, err := execWithRetry(s.db,
        `INSERT INTO repair(torrent_id, filename, hash, status, progress, reason, updated_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(torrent_id) DO UPDATE SET
           filename=excluded.filename,
           hash=excluded.hash,
           status=excluded.status,
           progress=excluded.progress,
           reason=excluded.reason,
           updated_at=excluded.updated_at`,
        id, filename, hash, status, progress, reason, now,
    )
    return err
}

// DeleteRepair removes a repair record for a torrent that was successfully enriched.
func (s *TorrentStore) DeleteRepair(id string) error {
    if s == nil { return errors.New("store not initialized") }
    _, err := execWithRetry(s.db, `DELETE FROM repair WHERE torrent_id=?`, id)
    return err
}

// GetRepair returns a repair entry for a specific torrent ID
func (s *TorrentStore) GetRepair(torrentID string) (*RepairEntry, error) {
    if s == nil { return nil, errors.New("store not initialized") }
    var e RepairEntry
    err := s.db.QueryRow(
        `SELECT torrent_id, filename, COALESCE(hash, ''), status, progress, reason, updated_at 
         FROM repair WHERE torrent_id=?`,
        torrentID,
    ).Scan(&e.TorrentID, &e.Filename, &e.Hash, &e.Status, &e.Progress, &e.Reason, &e.UpdatedAt)
    if err == sql.ErrNoRows {
        return nil, nil // Not found, but not an error
    }
    if err != nil {
        return nil, err
    }
    return &e, nil
}

// RepairEntry represents a torrent that needs repair
type RepairEntry struct {
    TorrentID string `json:"torrent_id"`
    Filename  string `json:"filename"`
    Hash      string `json:"hash"`
    Status    string `json:"status"`
    Progress  int    `json:"progress"`
    Reason    string `json:"reason"`
    UpdatedAt int64  `json:"updated_at"`
}

// GetAllRepairs returns all repair entries from the database
func (s *TorrentStore) GetAllRepairs() ([]RepairEntry, error) {
    if s == nil { return []RepairEntry{}, errors.New("store not initialized") }
    rows, err := s.db.Query(`SELECT torrent_id, filename, COALESCE(hash, ''), status, progress, reason, updated_at FROM repair ORDER BY updated_at DESC`)
    if err != nil { 
        return []RepairEntry{}, err 
    }
    defer rows.Close()
    entries := make([]RepairEntry, 0)
    for rows.Next() {
        var e RepairEntry
        if err := rows.Scan(&e.TorrentID, &e.Filename, &e.Hash, &e.Status, &e.Progress, &e.Reason, &e.UpdatedAt); err != nil {
            return entries, err
        }
        entries = append(entries, e)
    }
    return entries, rows.Err()
}

// GetRepairCount returns the total number of repair entries
func (s *TorrentStore) GetRepairCount() (int, error) {
    if s == nil { return 0, errors.New("store not initialized") }
    var count int
    err := s.db.QueryRow(`SELECT COUNT(*) FROM repair`).Scan(&count)
    return count, err
}

// UpdateRepairState records when a torrent was last checked
func (s *TorrentStore) UpdateRepairState(torrentID string, isBroken bool, brokenCount, linkCount int) error {
    if s == nil { return errors.New("store not initialized") }
    now := time.Now().Unix()
    broken := 0
    if isBroken {
        broken = 1
    }
    _, err := execWithRetry(s.db,
        `INSERT INTO repair_state(torrent_id, last_checked, is_broken, broken_count, link_count)
         VALUES(?,?,?,?,?)
         ON CONFLICT(torrent_id) DO UPDATE SET
           last_checked=excluded.last_checked,
           is_broken=excluded.is_broken,
           broken_count=excluded.broken_count,
           link_count=excluded.link_count`,
        torrentID, now, broken, brokenCount, linkCount)
    return err
}

// GetLastCheckedTime returns the last time a torrent was checked
func (s *TorrentStore) GetLastCheckedTime(torrentID string) (int64, error) {
    if s == nil { return 0, errors.New("store not initialized") }
    var lastChecked int64
    err := s.db.QueryRow(`SELECT last_checked FROM repair_state WHERE torrent_id=?`, torrentID).Scan(&lastChecked)
    if err == sql.ErrNoRows {
        return 0, nil
    }
    return lastChecked, err
}

// GetUncheckedTorrents returns torrents that haven't been checked in the specified duration (seconds)
func (s *TorrentStore) GetUncheckedTorrents(maxAge int64) ([]string, error) {
    if s == nil { return nil, errors.New("store not initialized") }
    cutoff := time.Now().Unix() - maxAge
    rows, err := s.db.Query(`
        SELECT t.id FROM torrents t
        LEFT JOIN repair_state rs ON t.id = rs.torrent_id
        WHERE rs.last_checked IS NULL OR rs.last_checked < ?
        ORDER BY rs.last_checked ASC NULLS FIRST
    `, cutoff)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    var ids []string
    for rows.Next() {
        var id string
        if err := rows.Scan(&id); err != nil {
            return ids, err
        }
        ids = append(ids, id)
    }
    return ids, rows.Err()
}

// timeNowOr converts RD time strings to unix seconds; falls back to now when empty.
func timeNowOr(main, fallback string) int64 {
    if main != "" { if t, err := time.Parse(time.RFC3339, main); err == nil { return t.Unix() } }
    if fallback != "" { if t, err := time.Parse(time.RFC3339, fallback); err == nil { return t.Unix() } }
    return time.Now().Unix()
}

// execWithRetry retries transient SQLITE_BUSY/LOCKED errors with small backoff.
func execWithRetry(db *sql.DB, query string, args ...any) (sql.Result, error) {
    var lastErr error
    sleep := 5 * time.Millisecond
    for i := 0; i < 8; i++ {
        res, err := db.Exec(query, args...)
        if err == nil {
            return res, nil
        }

        if !isBusyErr(err) {
            return nil, err
        }
        lastErr = err
        time.Sleep(sleep)
        sleep *= 2
        if sleep > 250*time.Millisecond { sleep = 250 * time.Millisecond }
    }
    return nil, lastErr
}

func isBusyErr(err error) bool {
    if err == nil { return false }
    s := err.Error()
    return strings.Contains(s, "SQLITE_BUSY") || strings.Contains(s, "database is locked") || strings.Contains(s, "SQLITE_LOCKED")
}
