const axios = require('axios');
const cheerio = require('cheerio');
const { isFileUrl } = require('./fileTypes');

async function test() {
  const url = 'http://server.arrownetsylhet.com/';
  console.log('=== Fetching root URL ===');
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      responseType: 'text',
    });
    console.log('HTTP Status:', res.status);
    console.log('Content-Type:', res.headers['content-type']);
    console.log('Final URL after redirects:', res.request?.res?.responseUrl || res.config?.url);

    const finalHostname = new URL(res.request?.res?.responseUrl || url).hostname;
    const rootHostname  = new URL(url).hostname;
    console.log('Root hostname:', rootHostname);
    console.log('Final hostname:', finalHostname);
    console.log('Hostname match:', finalHostname === rootHostname);

    const $ = cheerio.load(res.data);
    const links = [];
    $('a[href]').each((_, el) => { links.push($(el).attr('href')); });
    console.log('\nTotal <a href> links:', links.length);
    console.log('First 20:', links.slice(0, 20));

    console.log('\n=== isFileUrl check on root ===');
    console.log('isFileUrl(root):', isFileUrl(url));

    // Check a few links domain-wise
    console.log('\n=== Domain check on first 5 links ===');
    links.slice(0, 5).forEach(l => {
      try {
        const abs = new URL(l, url).href;
        const h = new URL(abs).hostname;
        const stripWww = s => s.replace(/^www\./, '');
        const same = stripWww(h) === stripWww(rootHostname);
        console.log(`  ${l}  =>  ${h}  same=${same}  isFile=${isFileUrl(abs)}`);
      } catch(e) { console.log(`  ${l} => parse error`); }
    });

    console.log('\n=== HTML snippet (first 500 chars) ===');
    console.log(res.data.substring(0, 500));

  } catch(e) {
    console.error('Fetch error:', e.message);
  }
}
test();
