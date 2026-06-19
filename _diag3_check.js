const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(path.join(__dirname, 'crawler.db'));
  const db = new SQL.Database(buf);

  function all(sql) {
    const res = db.exec(sql);
    if (!res[0]) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => Object.fromEntries(cols.map((c,i)=>[c,row[i]])));
  }

  console.log('--- latest sessions ---');
  console.log(JSON.stringify(all('SELECT id, root_url, status, pages_crawled, urls_queued, urls_visited, files_found, started_at FROM crawl_sessions ORDER BY id DESC LIMIT 3'), null, 2));

  const sid = all('SELECT id FROM crawl_sessions ORDER BY id DESC LIMIT 1')[0].id;

  console.log('--- discovered_files for latest session ---');
  console.log(JSON.stringify(all(`SELECT url, extension, category, status_code FROM discovered_files WHERE session_id=${sid}`), null, 2));

  console.log('--- domain breakdown of crawled_urls for latest session ---');
  const rows = all(`SELECT url FROM crawled_urls WHERE session_id=${sid}`);
  const domains = {};
  for (const r of rows) { try { const h = new URL(r.url).hostname; domains[h]=(domains[h]||0)+1; } catch{} }
  console.log(JSON.stringify(domains, null, 2));

  console.log('total crawled_urls rows:', rows.length);
})();
