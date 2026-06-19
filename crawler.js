const axios = require('axios');
const cheerio = require('cheerio');
const { parseStringPromise } = require('xml2js');
const mime = require('mime-types');
const { getDb } = require('./database');
const { isFileUrl, getExtension, getCategory, getFileName, ALL_EXTENSIONS } = require('./fileTypes');

// Regex that finds absolute file-looking URLs anywhere in raw page text —
// not just inside tag attributes. This is what catches images/video/docs that
// are embedded in inline <script> JSON state blobs (very common on modern
// SPA-rendered sites like Taobao, where the real product image URLs live in
// a JSON object the framework hydrates from, not in <img src="..."> at all).
const FILE_EXT_PATTERN = [...ALL_EXTENSIONS].join('|');
const ABS_FILE_URL_REGEX = new RegExp(`https?:\\/\\/[^\\s"'<>\\\\]+\\.(?:${FILE_EXT_PATTERN})[^\\s"'<>\\\\]*`, 'gi');
const REL_FILE_URL_REGEX = new RegExp(`\\/\\/[a-z0-9.-]+\\.[a-z]{2,}\\/[^\\s"'<>\\\\]+\\.(?:${FILE_EXT_PATTERN})[^\\s"'<>\\\\]*`, 'gi');

// In-memory crawl state per session
const crawlStates = new Map();

function createCrawlState(sessionId, config) {
  const state = {
    sessionId,
    config,
    status: 'idle',
    visitedUrls: new Set(),
    queuedUrls: new Set(),
    queue: [],
    activeRequests: 0,
    pagesProcessed: 0,
    filesFound: 0,
    startTime: null,
    pauseResolve: null,
    isPaused: false,
    isStopped: false,
    speedSamples: [],
    lastSpeedCheck: Date.now(),
    lastSpeedCount: 0,
  };
  crawlStates.set(sessionId, state);
  return state;
}

function getCrawlState(sessionId) {
  return crawlStates.get(sessionId);
}

function deleteCrawlState(sessionId) {
  crawlStates.delete(sessionId);
}

function normalizeUrl(url, base) {
  try {
    const u = new URL(url, base);
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function isSameDomain(url, rootHostname, includeSubdomains = true) {
  try {
    const hostname = new URL(url).hostname;
    const stripWww = h => h.replace(/^www\./, '');
    const root = stripWww(rootHostname);
    if (hostname === rootHostname || stripWww(hostname) === root) return true;
    // Optionally treat any subdomain of the root (e.g. item.taobao.com,
    // m.taobao.com) as "same domain" for the purpose of following page links.
    // Most real content (product detail pages, image galleries, etc.) lives
    // on subdomains rather than the bare root, so without this a crawl can
    // complete "successfully" while finding almost nothing.
    if (includeSubdomains && hostname.endsWith('.' + root)) return true;
    return false;
  } catch {
    return false;
  }
}

async function fetchRobotsTxt(rootUrl, timeout) {
  try {
    const robotsUrl = new URL('/robots.txt', rootUrl).href;
    const res = await axios.get(robotsUrl, { timeout, validateStatus: () => true });
    return res.status === 200 ? res.data : '';
  } catch {
    return '';
  }
}

function extractSitemapUrls(robotsTxt) {
  const urls = [];
  const lines = robotsTxt.split('\n');
  for (const line of lines) {
    const match = line.match(/^Sitemap:\s*(.+)/i);
    if (match) urls.push(match[1].trim());
  }
  return urls;
}

async function parseSitemap(sitemapUrl, timeout) {
  const urls = [];
  try {
    const res = await axios.get(sitemapUrl, { timeout, validateStatus: () => true });
    if (res.status !== 200) return urls;
    const xml = await parseStringPromise(res.data, { explicitArray: false });
    // Sitemap index
    if (xml.sitemapindex?.sitemap) {
      const sitemaps = Array.isArray(xml.sitemapindex.sitemap)
        ? xml.sitemapindex.sitemap
        : [xml.sitemapindex.sitemap];
      for (const sm of sitemaps) {
        const nested = await parseSitemap(sm.loc, timeout);
        urls.push(...nested);
      }
    }
    // Regular sitemap
    if (xml.urlset?.url) {
      const entries = Array.isArray(xml.urlset.url) ? xml.urlset.url : [xml.urlset.url];
      for (const entry of entries) {
        if (entry.loc) urls.push(typeof entry.loc === 'string' ? entry.loc : entry.loc._);
      }
    }
  } catch {}
  return urls;
}

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Set();
  const selectors = [
    ['a', 'href'],
    ['link', 'href'],
    ['script', 'src'],
    ['img', 'src'],
    ['video', 'src'],
    ['audio', 'src'],
    ['source', 'src'],
    ['source', 'srcset'],
    ['iframe', 'src'],
    ['embed', 'src'],
    ['object', 'data'],
    ['track', 'src'],
  ];
  for (const [tag, attr] of selectors) {
    $(tag).each((_, el) => {
      const val = $(el).attr(attr);
      if (!val) return;
      // Handle srcset
      if (attr === 'srcset') {
        val.split(',').forEach(part => {
          const src = part.trim().split(/\s+/)[0];
          if (src) {
            const norm = normalizeUrl(src, baseUrl);
            if (norm) links.add(norm);
          }
        });
      } else {
        const norm = normalizeUrl(val, baseUrl);
        if (norm) links.add(norm);
      }
    });
  }

  // Also catch any data-* lazy-load attributes (data-src, data-original,
  // data-lazy, data-ks-lazyload, etc.) — many sites swap the real src in via
  // JS after a placeholder, so the actual asset URL only ever appears here.
  $('[data-src], [data-original], [data-lazy], [data-lazy-src]').each((_, el) => {
    for (const a of ['data-src', 'data-original', 'data-lazy', 'data-lazy-src']) {
      const val = $(el).attr(a);
      if (val) {
        const norm = normalizeUrl(val, baseUrl);
        if (norm) links.add(norm);
      }
    }
  });

  // Scan the *raw* HTML text for file-looking URLs, not just tag attributes.
  // SPA-rendered pages frequently embed the real content (product images,
  // video URLs, etc.) inside inline <script> JSON state blobs rather than in
  // any HTML attribute at all — cheerio's tag/attr walk above never sees
  // those. This regex pass catches them regardless of where in the markup
  // they sit.
  for (const m of html.match(ABS_FILE_URL_REGEX) || []) {
    const norm = normalizeUrl(m, baseUrl);
    if (norm) links.add(norm);
  }
  for (const m of html.match(REL_FILE_URL_REGEX) || []) {
    const norm = normalizeUrl(m, baseUrl);
    if (norm) links.add(norm);
  }

  return [...links];
}

async function fetchMeta(url, timeout) {
  try {
    const res = await axios.head(url, {
      timeout,
      validateStatus: () => true,
      maxRedirects: 3,
    });
    const contentType = res.headers['content-type'] || '';
    const contentLength = parseInt(res.headers['content-length'] || '0', 10) || null;
    const mimeType = contentType.split(';')[0].trim() || null;
    return { statusCode: res.status, mimeType, contentLength };
  } catch {
    return { statusCode: null, mimeType: null, contentLength: null };
  }
}

function updateSessionStats(state) {
  const db = getDb();
  const now = Date.now();
  const elapsed = (now - state.lastSpeedCheck) / 1000;
  let speed = 0;
  if (elapsed >= 1) {
    speed = (state.pagesProcessed - state.lastSpeedCount) / elapsed;
    state.lastSpeedCount = state.pagesProcessed;
    state.lastSpeedCheck = now;
  }

  db.prepare(`
    UPDATE crawl_sessions SET
      pages_crawled = ?,
      urls_queued = ?,
      urls_visited = ?,
      files_found = ?,
      crawl_speed = ?
    WHERE id = ?
  `).run(
    state.pagesProcessed,
    state.queuedUrls.size,
    state.visitedUrls.size,
    state.filesFound,
    Math.round(speed * 10) / 10,
    state.sessionId
  );
}

async function processUrl(url, depth, state) {
  if (state.isStopped) return;
  while (state.isPaused) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (state.isStopped) return;
  }

  state.visitedUrls.add(url);
  state.activeRequests++;

  const db = getDb();
  const rootHostname = new URL(state.config.rootUrl).hostname;

  try {
    // Check if it's a file URL first
    if (isFileUrl(url)) {
      const ext = getExtension(url);
      const category = getCategory(ext);
      const { statusCode, mimeType, contentLength } = await fetchMeta(url, state.config.requestTimeout);
      const resolvedMime = mimeType || mime.lookup(ext) || null;

      db.prepare(`
        INSERT OR IGNORE INTO discovered_files
        (session_id, url, file_name, category, extension, mime_type, content_length, source_page, status_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(state.sessionId, url, getFileName(url), category, ext, resolvedMime, contentLength, depth > 0 ? url : null, statusCode);

      state.filesFound++;
      db.prepare(`UPDATE crawled_urls SET status='file', status_code=?, crawled_at=CURRENT_TIMESTAMP WHERE session_id=? AND url=?`)
        .run(statusCode, state.sessionId, url);
      updateSessionStats(state);
      return;
    }

    // It's an HTML page, fetch it
    const res = await axios.get(url, {
      timeout: state.config.requestTimeout,
      validateStatus: () => true,
      maxRedirects: 5,
      headers: { 'User-Agent': 'DomainFileCrawler/1.0 (+https://github.com/kehem-it)' },
      responseType: 'text',
    });

    db.prepare(`UPDATE crawled_urls SET status='crawled', status_code=?, crawled_at=CURRENT_TIMESTAMP WHERE session_id=? AND url=?`)
      .run(res.status, state.sessionId, url);

    state.pagesProcessed++;

    const contentType = res.headers['content-type'] || '';
    if (!contentType.includes('html') && !contentType.includes('xml')) {
      // Could be a direct file served without file extension
      const ext = getExtension(url);
      if (ext) {
        const category = getCategory(ext);
        db.prepare(`INSERT OR IGNORE INTO discovered_files (session_id, url, file_name, category, extension, mime_type, content_length, source_page, status_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(state.sessionId, url, getFileName(url), category, ext, contentType.split(';')[0].trim(), null, null, res.status);
        state.filesFound++;
      }
      updateSessionStats(state);
      return;
    }

    // Extract links from HTML
    if (depth < state.config.maxDepth && state.pagesProcessed < state.config.maxPages) {
      const links = extractLinks(res.data, url);
      for (const link of links) {
        if (!link || link.startsWith('javascript:') || link.startsWith('mailto:') || link.startsWith('tel:')) continue;
        // File URLs (images, video, docs, etc.) are commonly hosted on a separate
        // CDN domain (e.g. taobao.com pages reference img.alicdn.com assets).
        // Only restrict *page* crawling to the root domain; let file URLs through
        // regardless of host so they actually get discovered.
        const linkIsFile = isFileUrl(link);
        if (!linkIsFile && !isSameDomain(link, rootHostname)) continue;
        if (state.visitedUrls.has(link) || state.queuedUrls.has(link)) continue;

        state.queuedUrls.add(link);
        db.prepare(`INSERT OR IGNORE INTO crawled_urls (session_id, url, depth, source_page) VALUES (?, ?, ?, ?)`)
          .run(state.sessionId, link, depth + 1, url);
        state.queue.push({ url: link, depth: depth + 1 });
      }
    }

    updateSessionStats(state);
  } catch (err) {
    db.prepare(`UPDATE crawled_urls SET status='error', error=?, crawled_at=CURRENT_TIMESTAMP WHERE session_id=? AND url=?`)
      .run(err.message?.slice(0, 500), state.sessionId, url);
  } finally {
    state.activeRequests--;
    if (state.config.crawlDelay > 0) {
      await new Promise(r => setTimeout(r, state.config.crawlDelay));
    }
  }
}

async function runCrawler(sessionId) {
  const state = getCrawlState(sessionId);
  if (!state) return;

  const db = getDb();
  const { maxConcurrent } = state.config;

  state.status = 'running';
  state.startTime = Date.now();
  db.prepare(`UPDATE crawl_sessions SET status='running', started_at=CURRENT_TIMESTAMP WHERE id=?`).run(sessionId);

  // Process robots.txt + sitemap
  const robotsTxt = await fetchRobotsTxt(state.config.rootUrl, state.config.requestTimeout);
  const sitemapUrls = extractSitemapUrls(robotsTxt);
  const rootHostname = new URL(state.config.rootUrl).hostname;

  for (const smUrl of sitemapUrls) {
    const urls = await parseSitemap(smUrl, state.config.requestTimeout);
    for (const u of urls) {
      if (isSameDomain(u, rootHostname) && !state.queuedUrls.has(u)) {
        state.queuedUrls.add(u);
        state.queue.push({ url: u, depth: 0 });
        db.prepare(`INSERT OR IGNORE INTO crawled_urls (session_id, url, depth, source_page) VALUES (?, ?, ?, ?)`)
          .run(sessionId, u, 0, 'sitemap');
      }
    }
  }

  // Main crawl loop — keeps a sliding window of maxConcurrent active tasks
  const inFlight = new Set();

  const launchNext = () => {
    while (
      state.queue.length > 0 &&
      inFlight.size < maxConcurrent &&
      !state.isStopped &&
      state.pagesProcessed < state.config.maxPages
    ) {
      const item = state.queue.shift();
      if (!item || state.visitedUrls.has(item.url)) continue;

      const promise = processUrl(item.url, item.depth, state).finally(() => {
        inFlight.delete(promise);
      });
      inFlight.add(promise);
    }
  };

  while (!state.isStopped) {
    while (state.isPaused && !state.isStopped) {
      await new Promise(r => setTimeout(r, 300));
    }
    if (state.isStopped) break;
    if (state.pagesProcessed >= state.config.maxPages) break;

    launchNext();

    if (inFlight.size === 0 && state.queue.length === 0) break;

    // Wait for at least one task to finish, then re-fill the window
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    } else {
      await new Promise(r => setTimeout(r, 50));
    }
  }

  // Drain any remaining in-flight requests
  if (inFlight.size > 0) await Promise.all(inFlight);

  if (!state.isStopped) {
    state.status = 'completed';
    db.prepare(`UPDATE crawl_sessions SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=?`).run(sessionId);
  }

  updateSessionStats(state);
}

module.exports = { createCrawlState, getCrawlState, deleteCrawlState, runCrawler };
