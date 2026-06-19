const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(path.join(__dirname, 'crawler.db')));

  console.log('=== SESSIONS ===');
  const sessions = db.exec(`SELECT id, root_url, status, max_depth, pages_crawled, urls_queued, urls_visited, files_found FROM crawl_sessions ORDER BY id DESC LIMIT 5`);
  console.log(JSON.stringify(sessions, null, 2));

  if (sessions[0]) {
    const lastId = sessions[0].values[0][0];
    console.log('\n=== crawled_urls status breakdown for session ' + lastId + ' ===');
    const statusBreakdown = db.exec(`SELECT status, COUNT(*) as cnt FROM crawled_urls WHERE session_id=${lastId} GROUP BY status`);
    console.log(JSON.stringify(statusBreakdown, null, 2));

    console.log('\n=== sample crawled_urls (status=crawled) ===');
    const sampleCrawled = db.exec(`SELECT url, status, status_code, depth, source_page FROM crawled_urls WHERE session_id=${lastId} AND status='crawled' LIMIT 10`);
    console.log(JSON.stringify(sampleCrawled, null, 2));

    console.log('\n=== sample crawled_urls (status=pending, stuck?) ===');
    const samplePending = db.exec(`SELECT url, status, depth FROM crawled_urls WHERE session_id=${lastId} AND status='pending' LIMIT 10`);
    console.log(JSON.stringify(samplePending, null, 2));

    console.log('\n=== discovered_files count + sample ===');
    const filesCount = db.exec(`SELECT COUNT(*) as cnt FROM discovered_files WHERE session_id=${lastId}`);
    console.log(JSON.stringify(filesCount, null, 2));
    const filesSample = db.exec(`SELECT url, file_name, category, source_page FROM discovered_files WHERE session_id=${lastId} LIMIT 15`);
    console.log(JSON.stringify(filesSample, null, 2));

    console.log('\n=== distinct hostnames among crawled_urls (sample 2000) ===');
    const hosts = db.exec(`SELECT url FROM crawled_urls WHERE session_id=${lastId} LIMIT 2000`);
    if (hosts[0]) {
      const hostSet = new Set();
      for (const row of hosts[0].values) {
        try { hostSet.add(new URL(row[0]).hostname); } catch {}
      }
      console.log([...hostSet]);
    }
  }
}).catch(e => console.error('ERR', e));
