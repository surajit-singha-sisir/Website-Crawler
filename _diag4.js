const axios = require('axios');

async function run() {
  const base = 'http://server.arrownetsylhet.com';
  const jsUrl = base + '/static/js/main.024b98fa.js';

  console.log('Fetching main JS bundle...');
  const res = await axios.get(jsUrl, {
    timeout: 30000, validateStatus: () => true, responseType: 'text'
  });
  console.log('Status:', res.status, 'Size:', res.data.length, 'bytes');

  const js = res.data;

  // Extract string literals that look like URL paths
  const pathRegex = /["'`](\/[a-zA-Z0-9_\-/:]+)["'`]/g;
  const paths = new Set();
  let m;
  while ((m = pathRegex.exec(js)) !== null) {
    const p = m[1];
    if (p.length > 2 && !p.startsWith('/static') && !p.startsWith('/favicon')) {
      paths.add(p);
    }
  }

  console.log('\n=== URL paths found in JS bundle ===');
  [...paths].sort().forEach(p => console.log(' ', p));

  // Also look for fetch/axios calls
  const apiRegex = /(?:fetch|axios\.(?:get|post|put))\s*\(\s*["'`]([^"'`]+)["'`]/g;
  const apis = new Set();
  while ((m = apiRegex.exec(js)) !== null) apis.add(m[1]);

  console.log('\n=== fetch/axios calls found ===');
  [...apis].forEach(a => console.log(' ', a));
}
run();
