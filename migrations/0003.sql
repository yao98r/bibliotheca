CREATE INDEX IF NOT EXISTS pdf_headers_content ON pdf_headers(size,md5);
CREATE TABLE IF NOT EXISTS index_jobs (
 id TEXT PRIMARY KEY,
 asset TEXT NOT NULL,
 size INTEGER NOT NULL,
 md5 TEXT NOT NULL,
 page_count INTEGER,
 tail TEXT,
 next_page INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'pending',
 error TEXT,
 updated_at TEXT NOT NULL,
 UNIQUE(asset,size,md5)
);
