const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  const res = await axios.get('https://www.taobao.com/list/product/%E7%A7%8B%E8%A3%85.htm', {
    timeout: 10000,
    validateStatus: () => true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  });
  const html = res.data;
  const $ = cheerio.load(html);

  const itemLinks = new Set();
  $('a').each((_, el) => { const h = $(el).attr('href'); if (h && h.includes('item.htm')) itemLinks.add(h); });
  console.log('distinct item.htm links found:', itemLinks.size);
  console.log('sample item links:', [...itemLinks].slice(0,3));

  // dump all distinct img src
  const imgs = new Set();
  $('img').each((_, el) => { const s = $(el).attr('src'); if (s) imgs.add(s); });
  console.log('distinct img src count:', imgs.size);
  console.log('sample imgs:', [...imgs].slice(0, 10));

  // size of ICE_APP_CONTEXT blob
  const m = html.match(/window\.__ICE_APP_CONTEXT__\s*=\s*(\{.*?\});?\s*<\/script>/s);
  if (m) {
    console.log('ICE_APP_CONTEXT length:', m[1].length);
    const urlRegex = /https?:\/\/[^\s"'\\]+\.(?:jpg|jpeg|png|gif|webp)[^\s"'\\]*/gi;
    const found = new Set(m[1].match(urlRegex) || []);
    console.log('image urls inside ICE_APP_CONTEXT:', found.size);
    console.log('sample:', [...found].slice(0,5));
  } else {
    console.log('ICE_APP_CONTEXT not matched by regex, trying alt approach');
    const idx = html.indexOf('window.__ICE_APP_CONTEXT__');
    console.log(html.slice(idx, idx+300));
  }
})();
