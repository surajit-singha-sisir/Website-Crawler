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

  let scriptText = '';
  $('script').each((_, el) => { scriptText += ($(el).html() || '') + '\n'; });
  console.log('total script text length:', scriptText.length);

  const urlRegex = /https?:\/\/[^\s"'\\<>]+\.(?:jpg|jpeg|png|gif|webp|avif|svg|mp4|m3u8)[^\s"'\\<>]*/gi;
  const found = new Set(scriptText.match(urlRegex) || []);
  console.log('distinct file-like URLs inside <script> blocks:', found.size);
  console.log('sample:', [...found].slice(0, 10));

  // also protocol-relative //xxx.jpg patterns (no https:)
  const relRegex = /\/\/[a-z0-9.-]+\.(?:jpg|jpeg|png|gif|webp|avif|svg)[^\s"'\\<>]*/gi;
  const foundRel = new Set(scriptText.match(relRegex) || []);
  console.log('protocol-relative file URLs in script:', foundRel.size);

  // item.htm links inside script text (product detail pages)
  const itemRegex = /https?:\/\/[^\s"'\\<>]*item\.htm[^\s"'\\<>]*/gi;
  const items = new Set(scriptText.match(itemRegex) || []);
  console.log('item.htm product links inside script:', items.size);
  console.log('sample item link:', [...items][0]);
})();
