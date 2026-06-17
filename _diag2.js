const axios = require('axios');

async function get(url) {
  try {
    const res = await axios.get(url, {
      timeout: 10000, validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      responseType: 'text',
    });
    console.log(`[${res.status}] ${url}  CT:${res.headers['content-type']?.split(';')[0]}`);
    if (res.status === 200) console.log('  Preview:', res.data.substring(0, 200).replace(/\n/g, ' '));
  } catch(e) { console.log(`[ERR] ${url}  ${e.message}`); }
}

async function run() {
  const base = 'http://server.arrownetsylhet.com';
  await get(base + '/robots.txt');
  await get(base + '/sitemap.xml');
  await get(base + '/sitemap_index.xml');
  await get(base + '/asset-manifest.json');
  await get(base + '/static/js/main.chunk.js');  // CRA bundle
  // Common API patterns for movie sites
  await get(base + '/api/movies');
  await get(base + '/api/home');
  await get(base + '/api/latest');
}
run();
