CREATE TABLE IF NOT EXISTS keybox_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('encoded','raw_xml','json_index')),
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked TEXT,
  last_result TEXT,
  last_error TEXT,
  last_imported INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS keyboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES keybox_sources(id),
  sha256 TEXT NOT NULL UNIQUE,
  xml_content TEXT NOT NULL,
  source_claim TEXT NOT NULL DEFAULT 'unknown',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  origin_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_keyboxes_source ON keyboxes(source_id);
CREATE INDEX IF NOT EXISTS idx_keyboxes_claim ON keyboxes(source_claim);
INSERT OR IGNORE INTO keybox_sources (name,kind,url) VALUES
 ('evoker', 'encoded', 'https://evoker.qzz.io/key'),
 ('zuri', 'raw_xml', 'https://raw.githubusercontent.com/zuri1503/Toolbox-Database/refs/heads/main/keybox.xml'),
 ('kowx', 'json_index', 'https://keybox.kowx712.cc/api/keyboxes');
