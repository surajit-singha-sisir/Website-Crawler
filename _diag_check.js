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

  console.log('--- sessions ---');
  console.log(JSON.stringify(all('SELECT * FROM crawl_sessions ORDER BY id DESC LIMIT 3'), null, 2));

  const sess = all('SELECT id FROM crawl_sessions ORDER BY id DESC LIMIT 1')[0];
  const sid = sess.id;

  console.log('--- sample crawled_urls (status=crawled) ---');
  console.log(JSON.stringify(all(`SELECT url, status, status_code FROM crawled_urls WHERE session_id=${sid} AND status='crawled' LIMIT 5`), null, 2));

  console.log('--- domains seen in crawled_urls ---');
  const rows = all(`SELECT url FROM crawled_urls WHERE session_id=${sid}`);
  const domains = {};
  for (const r of rows) {
    try { const h = new URL(r.url).hostname; domains[h] = (domains[h]||0)+1; } catch {}
  }
  console.log(JSON.stringify(domains, null, 2));

  console.log('--- discovered_files count ---');
  console.log(JSON.stringify(all(`SELECT COUNT(*) as cnt FROM discovered_files WHERE session_id=${sid}`)));

  console.log('--- error sample ---');
  console.log(JSON.stringify(all(`SELECT url, error FROM crawled_urls WHERE session_id=${sid} AND status='error' LIMIT 5`), null, 2));

  console.log('--- live fetch test of root url ---');
  const axios = require('axios');
  const cheerio = require('cheerio');
  try {
    const res = await axios.get('https://www.taobao.com/list/product/wap/wholesale.htm?from=redirectFromAutoCallApp', {
      timeout: 10000,
      validateStatus: () => true,
      headers: { 'User-Agent': 'DomainFileCrawler/1.0 (+https://github.com/kehem-it)' },
    });
    console.log('status:', res.status, 'content-type:', res.headers['content-type'], 'length:', res.data.length);
    console.log('first 500 chars:', res.data.slice(0, 500));
    const $ = cheerio.load(res.data);
    console.log('a tags:', $('a').length, 'img tags:', $('img').length, 'script tags:', $('script').length);
  } catch (e) {
    console.log('fetch error:', e.message);
  }
})();
