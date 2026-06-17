const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'crawler.db');

let db = null;
let SQL = null;

// Persist DB to disk every 5 seconds if dirty
let dirty = false;
setInterval(() => {
  if (dirty && db) {
    try {
      fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
      dirty = false;
    } catch (e) {
      console.error('DB persist error:', e.message);
    }
  }
}, 5000);

async function initDb() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  initSchema();
  return db;
}

function initSchema() {
  db.run(`PRAGMA journal_mode = WAL`);
  db.run(`PRAGMA foreign_keys = ON`);

  db.run(`
    CREATE TABLE IF NOT EXISTS crawl_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_url TEXT NOT NULL,
      status TEXT DEFAULT 'idle',
      max_depth INTEGER DEFAULT 3,
      max_concurrent INTEGER DEFAULT 5,
      request_timeout INTEGER DEFAULT 10000,
      crawl_delay INTEGER DEFAULT 500,
      max_pages INTEGER DEFAULT 1000,
      pages_crawled INTEGER DEFAULT 0,
      urls_queued INTEGER DEFAULT 0,
      urls_visited INTEGER DEFAULT 0,
      files_found INTEGER DEFAULT 0,
      crawl_speed REAL DEFAULT 0,
      started_at DATETIME,
      paused_at DATETIME,
      stopped_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS crawled_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      status_code INTEGER,
      depth INTEGER DEFAULT 0,
      source_page TEXT,
      crawled_at DATETIME,
      error TEXT,
      FOREIGN KEY (session_id) REFERENCES crawl_sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS discovered_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      file_name TEXT,
      category TEXT,
      extension TEXT,
      mime_type TEXT,
      content_length INTEGER,
      source_page TEXT,
      status_code INTEGER,
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES crawl_sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_crawled_urls_session ON crawled_urls(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_crawled_urls_url ON crawled_urls(url)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_discovered_files_session ON discovered_files(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_discovered_files_category ON discovered_files(category)`);

  markDirty();
}

function markDirty() {
  dirty = true;
}

/**
 * Thin wrapper around sql.js to mimic better-sqlite3's synchronous API.
 * Returns a proxy object with .prepare(), .get(), .all(), .run(), .exec().
 */
function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');

  return {
    prepare(sql) {
      return {
        run(...params) {
          db.run(sql, flattenParams(params));
          markDirty();
          // Return lastInsertRowid-style object
          const row = db.exec('SELECT last_insert_rowid() as id');
          const lastInsertRowid = row[0]?.values[0][0] ?? 0;
          return { lastInsertRowid, changes: db.getRowsModified() };
        },
        get(...params) {
          const stmt = db.prepare(sql);
          stmt.bind(flattenParams(params));
          const cols = stmt.getColumnNames();
          if (stmt.step()) {
            const vals = stmt.get();
            stmt.free();
            return zipObject(cols, vals);
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const results = [];
          const stmt = db.prepare(sql);
          stmt.bind(flattenParams(params));
          const cols = stmt.getColumnNames();
          while (stmt.step()) {
            results.push(zipObject(cols, stmt.get()));
          }
          stmt.free();
          return results;
        },
      };
    },
    exec(sql) {
      db.run(sql);
      markDirty();
    },
    // Direct helpers (used in a few places)
    get(sql, ...params) {
      const stmt = db.prepare(sql);
      stmt.bind(flattenParams(params));
      const cols = stmt.getColumnNames();
      if (stmt.step()) {
        const vals = stmt.get();
        stmt.free();
        return zipObject(cols, vals);
      }
      stmt.free();
      return undefined;
    },
    all(sql, ...params) {
      const results = [];
      const stmt = db.prepare(sql);
      stmt.bind(flattenParams(params));
      const cols = stmt.getColumnNames();
      while (stmt.step()) {
        results.push(zipObject(cols, stmt.get()));
      }
      stmt.free();
      return results;
    },
  };
}

function flattenParams(params) {
  // better-sqlite3 allows .run(a, b, c) or .run([a, b, c])
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function zipObject(keys, values) {
  const obj = {};
  for (let i = 0; i < keys.length; i++) obj[keys[i]] = values[i];
  return obj;
}

module.exports = { getDb, initDb };
