CREATE TABLE IF NOT EXISTS users (
 email TEXT PRIMARY KEY, google_sub TEXT UNIQUE, google_name TEXT NOT NULL DEFAULT '',
 display_name TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT 'A',
 access_scope TEXT NOT NULL DEFAULT 'both' CHECK(access_scope IN ('ref','mock','both')),
 download_mode TEXT NOT NULL DEFAULT 'view' CHECK(download_mode IN ('view','download')),
 view_enabled INTEGER NOT NULL DEFAULT 0, reading_mode TEXT NOT NULL DEFAULT 'protected',
 daily_download_limit INTEGER, individual INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0,
 last_login TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES ('policy','{"enabled":false,"defaultTier":"catalog","scope":"both","dailyLimit":null}');
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS oauth (state TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS exchanges (hash TEXT PRIMARY KEY, email TEXT NOT NULL, state TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, parent TEXT NOT NULL, book_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER, md5 TEXT, index_id TEXT);
CREATE INDEX IF NOT EXISTS assets_parent ON assets(parent);
CREATE TABLE IF NOT EXISTS scan (id TEXT PRIMARY KEY, category TEXT NOT NULL, book_id TEXT, page_token TEXT);
CREATE TABLE IF NOT EXISTS events (id TEXT NOT NULL, email TEXT NOT NULL, book_id TEXT, book_title TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(email,id));
CREATE INDEX IF NOT EXISTS events_time ON events(created_at);
CREATE TABLE IF NOT EXISTS tickets (hash TEXT PRIMARY KEY, email TEXT NOT NULL, book_id TEXT NOT NULL, asset_id TEXT NOT NULL, action TEXT NOT NULL, kind TEXT NOT NULL, trace_code TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, issued_at TEXT, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS downloads (email TEXT NOT NULL, day TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY(email,day,asset_id));
