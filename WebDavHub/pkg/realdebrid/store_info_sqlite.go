package realdebrid

import (
    "database/sql"
    "encoding/json"
    "errors"
    "time"

    _ "modernc.org/sqlite"
)

type TorrentInfoStore struct {
    db *sql.DB
}

func OpenTorrentInfoStore(dbPath string) (*TorrentInfoStore, error) {
    dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)"
    db, err := sql.Open("sqlite", dsn)
    if err != nil { return nil, err }

    db.SetMaxOpenConns(1)
    db.SetMaxIdleConns(1)

    if _, err := db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
        if _, err := db.Exec(`PRAGMA wal_checkpoint(RESTART)`); err != nil {
            _, _ = db.Exec(`PRAGMA wal_checkpoint(PASSIVE)`)
        }
    }

    _, _ = db.Exec(`PRAGMA synchronous=NORMAL`)
    _, _ = db.Exec(`PRAGMA cache_size=-20000`)
    _, _ = db.Exec(`PRAGMA temp_store=MEMORY`)
    _, _ = db.Exec(`PRAGMA journal_size_limit=67108864`)
    _, _ = db.Exec(`PRAGMA wal_autocheckpoint=1000`)
    _, _ = db.Exec(`PRAGMA mmap_size=134217728`)

    if _, err := db.Exec(`
CREATE TABLE IF NOT EXISTS torrent_info (
    id TEXT PRIMARY KEY,
    info_json TEXT NOT NULL,
    added TEXT,
    ended TEXT,
    progress REAL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_torrent_info_updated_at ON torrent_info(updated_at);
`); err != nil {
        _ = db.Close()
        return nil, err
    }

    return &TorrentInfoStore{db: db}, nil
}

func (s *TorrentInfoStore) Close() error {
    if s == nil || s.db == nil {
        return nil
    }
    // Checkpoint WAL before closing
    _, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
    _, _ = s.db.Exec(`PRAGMA optimize`)
    return s.db.Close()
}

func (s *TorrentInfoStore) Upsert(info *TorrentInfo) error {
    if s == nil { return errors.New("info store not initialized") }
    if info == nil || info.ID == "" { return errors.New("invalid info") }
    b, err := json.Marshal(info)
    if err != nil { return err }
    now := time.Now().Unix()
    _, err = s.db.Exec(`
INSERT INTO torrent_info(id, info_json, added, ended, progress, updated_at)
VALUES(?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET
  info_json=excluded.info_json,
  added=excluded.added,
  ended=excluded.ended,
  progress=excluded.progress,
  updated_at=excluded.updated_at
`, info.ID, string(b), info.Added, info.Ended, info.Progress, now)
    return err
}

func (s *TorrentInfoStore) Get(id string) (*TorrentInfo, bool, error) {
    if s == nil { return nil, false, errors.New("info store not initialized") }
    var jsonStr string
    err := s.db.QueryRow(`SELECT info_json FROM torrent_info WHERE id=?`, id).Scan(&jsonStr)
    if err == sql.ErrNoRows { return nil, false, nil }
    if err != nil { return nil, false, err }
    var info TorrentInfo
    if err := json.Unmarshal([]byte(jsonStr), &info); err != nil {
        return nil, false, err
    }
    return &info, true, nil
}

// Delete removes one cached TorrentInfo row by id.
func (s *TorrentInfoStore) Delete(id string) error {
    if s == nil { return errors.New("info store not initialized") }
    _, err := s.db.Exec(`DELETE FROM torrent_info WHERE id=?`, id)
    return err
}


