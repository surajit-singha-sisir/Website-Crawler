const axios = require('axios');

async function run() {
  const base = 'http://server.arrownetsylhet.com';

  // Fetch main.js to find all chunk references
  const mainRes = await axios.get(base + '/static/js/main.024b98fa.js', {
    timeout: 15000, validateStatus: () => true, responseType: 'text'
  });
  console.log('main.js size:', mainRes.data.length, '\n', mainRes.data.substring(0, 500));

  const chunk27Res = await axios.get(base + '/static/js/27.b3cd3a7c.chunk.js', {
    timeout: 30000, validateStatus: () => true, responseType: 'text'
  });
  console.log('\nchunk27 status:', chunk27Res.status, 'size:', chunk27Res.data.length);

  const js = chunk27Res.data;

  // Extract route paths
  const pathRegex = /["'`](\/[a-zA-Z0-9_\-/:?=&.]+)["'`]/g;
  const paths = new Set();
  let m;
  while ((m = pathRegex.exec(js)) !== null) {
    const p = m[1];
    if (p.length > 2 && !p.startsWith('/static') && !p.includes('.js') && !p.includes('.css')) {
      paths.add(p);
    }
  }
  console.log('\n=== Paths in chunk27 ===');
  [...paths].sort().slice(0, 80).forEach(p => console.log(' ', p));

  // fetch/axios calls
  const apiRegex = /(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*[`"']([^`"']+)[`"']/g;
  const apis = new Set();
  while ((m = apiRegex.exec(js)) !== null) apis.add(m[1]);
  console.log('\n=== API calls in chunk27 ===');
  [...apis].forEach(a => console.log(' ', a));

  // Look for baseURL config
  const baseUrlMatch = js.match(/baseURL\s*[:=]\s*["'`]([^"'`]+)["'`]/);
  console.log('\nbaseURL found:', baseUrlMatch?.[1] || 'none');
}
run();
