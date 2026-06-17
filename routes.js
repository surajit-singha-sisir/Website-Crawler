const express = require('express');
const router = express.Router();
const { getDb } = require('./database');
const { createCrawlState, getCrawlState, deleteCrawlState, runCrawler } = require('./crawler');
const { getExtension, getCategory, getFileName } = require('./fileTypes');

// SSE clients for live updates
const sseClients = new Map(); // sessionId -> Set of res objects

function broadcast(sessionId, data) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(msg); } catch {}
  }
}

// ============================================================
// POST /api/sessions - Start a new crawl session
// ============================================================
router.post('/sessions', (req, res) => {
  const {
    rootUrl,
    maxDepth = 3,
    maxConcurrent = 5,
    requestTimeout = 10000,
    crawlDelay = 300,
    maxPages = 500,
  } = req.body;

  if (!rootUrl) return res.status(400).json({ error: 'rootUrl is required' });

  let parsedUrl;
  try {
    parsedUrl = new URL(rootUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO crawl_sessions (root_url, status, max_depth, max_concurrent, request_timeout, crawl_delay, max_pages)
    VALUES (?, 'idle', ?, ?, ?, ?, ?)
  `).run(parsedUrl.href, maxDepth, maxConcurrent, requestTimeout, crawlDelay, maxPages);

  const sessionId = result.lastInsertRowid;
  const config = { rootUrl: parsedUrl.href, maxDepth, maxConcurrent, requestTimeout, crawlDelay, maxPages };
  const state = createCrawlState(sessionId, config);

  // Seed root URL
  db.prepare(`INSERT OR IGNORE INTO crawled_urls (session_id, url, depth) VALUES (?, ?, ?)`)
    .run(sessionId, parsedUrl.href, 0);
  state.queuedUrls.add(parsedUrl.href);
  state.queue.push({ url: parsedUrl.href, depth: 0 });

  // Start crawl async
  runCrawler(sessionId).then(() => {
    broadcast(sessionId, { type: 'status', status: state.status });
  }).catch(err => console.error('Crawler error:', err));

  // Periodic stats broadcast
  const interval = setInterval(() => {
    const s = getCrawlState(sessionId);
    if (!s) { clearInterval(interval); return; }
    const session = db.prepare('SELECT * FROM crawl_sessions WHERE id=?').get(sessionId);
    broadcast(sessionId, { type: 'stats', session });
    if (s.status === 'completed' || s.isStopped) clearInterval(interval);
  }, 1000);

  res.json({ sessionId, message: 'Crawl started' });
});

// ============================================================
// GET /api/sessions - List all sessions
// ============================================================
router.get('/sessions', (req, res) => {
  const db = getDb();
  const sessions = db.prepare('SELECT * FROM crawl_sessions ORDER BY created_at DESC').all();
  res.json(sessions);
});

// ============================================================
// GET /api/sessions/:id - Get session details
// ============================================================
router.get('/sessions/:id', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM crawl_sessions WHERE id=?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const state = getCrawlState(parseInt(req.params.id));
  const activeRequests = state ? state.activeRequests : 0;
  res.json({ ...session, activeRequests });
});

// ============================================================
// POST /api/sessions/:id/pause
// ============================================================
router.post('/sessions/:id/pause', (req, res) => {
  const state = getCrawlState(parseInt(req.params.id));
  if (!state) return res.status(404).json({ error: 'Session not active' });
  state.isPaused = true;
  state.status = 'paused';
  getDb().prepare(`UPDATE crawl_sessions SET status='paused', paused_at=CURRENT_TIMESTAMP WHERE id=?`).run(req.params.id);
  broadcast(parseInt(req.params.id), { type: 'status', status: 'paused' });
  res.json({ message: 'Paused' });
});

// ============================================================
// POST /api/sessions/:id/resume
// ============================================================
router.post('/sessions/:id/resume', (req, res) => {
  const state = getCrawlState(parseInt(req.params.id));
  if (!state) return res.status(404).json({ error: 'Session not active' });
  state.isPaused = false;
  state.status = 'running';
  getDb().prepare(`UPDATE crawl_sessions SET status='running' WHERE id=?`).run(req.params.id);
  broadcast(parseInt(req.params.id), { type: 'status', status: 'running' });
  res.json({ message: 'Resumed' });
});

// ============================================================
// POST /api/sessions/:id/stop
// ============================================================
router.post('/sessions/:id/stop', (req, res) => {
  const state = getCrawlState(parseInt(req.params.id));
  if (!state) return res.status(404).json({ error: 'Session not active' });
  state.isStopped = true;
  state.isPaused = false;
  state.status = 'stopped';
  getDb().prepare(`UPDATE crawl_sessions SET status='stopped', stopped_at=CURRENT_TIMESTAMP WHERE id=?`).run(req.params.id);
  broadcast(parseInt(req.params.id), { type: 'status', status: 'stopped' });
  deleteCrawlState(parseInt(req.params.id));
  res.json({ message: 'Stopped' });
});

// ============================================================
// GET /api/sessions/:id/files - Get discovered files
// ============================================================
router.get('/sessions/:id/files', (req, res) => {
  const db = getDb();
  const {
    category, extension, mime, minSize, maxSize,
    search, page = 1, limit = 50, sortBy = 'discovered_at', sortDir = 'DESC'
  } = req.query;

  const conditions = ['session_id = ?'];
  const params = [req.params.id];

  if (category && category !== 'all') { conditions.push('category = ?'); params.push(category); }
  if (extension) { conditions.push('extension = ?'); params.push(extension.toLowerCase()); }
  if (mime) { conditions.push('mime_type LIKE ?'); params.push(`%${mime}%`); }
  if (search) { conditions.push('(url LIKE ? OR file_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (minSize) { conditions.push('content_length >= ?'); params.push(parseInt(minSize)); }
  if (maxSize) { conditions.push('content_length <= ?'); params.push(parseInt(maxSize)); }

  const where = conditions.join(' AND ');
  const allowedSort = ['discovered_at', 'file_name', 'category', 'extension', 'content_length', 'status_code'];
  const safeSort = allowedSort.includes(sortBy) ? sortBy : 'discovered_at';
  const safeDir = sortDir === 'ASC' ? 'ASC' : 'DESC';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM discovered_files WHERE ${where}`).get(...params).cnt;
  const files = db.prepare(`SELECT * FROM discovered_files WHERE ${where} ORDER BY ${safeSort} ${safeDir} LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);

  res.json({ total, page: parseInt(page), limit: parseInt(limit), files });
});

// ============================================================
// GET /api/sessions/:id/export - Export files
// ============================================================
router.get('/sessions/:id/export', (req, res) => {
  const db = getDb();
  const { format = 'json', category } = req.query;

  const conditions = ['session_id = ?'];
  const params = [req.params.id];
  if (category && category !== 'all') { conditions.push('category = ?'); params.push(category); }

  const files = db.prepare(`SELECT * FROM discovered_files WHERE ${conditions.join(' AND ')} ORDER BY category, file_name`).all(...params);

  if (format === 'csv') {
    const cols = ['id', 'url', 'file_name', 'category', 'extension', 'mime_type', 'content_length', 'source_page', 'status_code', 'discovered_at'];
    const rows = [cols.join(',')];
    for (const f of files) {
      rows.push(cols.map(c => `"${(f[c] ?? '').toString().replace(/"/g, '""')}"`).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="crawl-${req.params.id}.csv"`);
    return res.send(rows.join('\n'));
  }

  if (format === 'excel') {
    // Simple TSV that Excel can open
    const cols = ['ID', 'URL', 'File Name', 'Category', 'Extension', 'MIME Type', 'Size (bytes)', 'Source Page', 'Status Code', 'Discovered At'];
    const rows = [cols.join('\t')];
    for (const f of files) {
      rows.push([f.id, f.url, f.file_name, f.category, f.extension, f.mime_type, f.content_length, f.source_page, f.status_code, f.discovered_at].join('\t'));
    }
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="crawl-${req.params.id}.xls"`);
    return res.send(rows.join('\n'));
  }

  // JSON default
  res.setHeader('Content-Disposition', `attachment; filename="crawl-${req.params.id}.json"`);
  res.json({ sessionId: req.params.id, exportedAt: new Date().toISOString(), total: files.length, files });
});

// ============================================================
// GET /api/sessions/:id/stats - Category breakdown
// ============================================================
router.get('/sessions/:id/stats', (req, res) => {
  const db = getDb();
  const breakdown = db.prepare(`
    SELECT category, extension, COUNT(*) as count, SUM(content_length) as total_size
    FROM discovered_files WHERE session_id = ?
    GROUP BY category, extension ORDER BY count DESC
  `).all(req.params.id);
  res.json(breakdown);
});

// ============================================================
// GET /api/sessions/:id/events - SSE live updates
// ============================================================
router.get('/sessions/:id/events', (req, res) => {
  const sessionId = parseInt(req.params.id);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(sessionId)) sseClients.set(sessionId, new Set());
  sseClients.get(sessionId).add(res);

  // Send current state immediately
  const db = getDb();
  const session = db.prepare('SELECT * FROM crawl_sessions WHERE id=?').get(sessionId);
  if (session) res.write(`data: ${JSON.stringify({ type: 'stats', session })}\n\n`);

  req.on('close', () => {
    const clients = sseClients.get(sessionId);
    if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(sessionId); }
  });
});

// ============================================================
// DELETE /api/sessions/:id
// ============================================================
router.delete('/sessions/:id', (req, res) => {
  const state = getCrawlState(parseInt(req.params.id));
  if (state) { state.isStopped = true; deleteCrawlState(parseInt(req.params.id)); }
  getDb().prepare('DELETE FROM crawl_sessions WHERE id=?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
