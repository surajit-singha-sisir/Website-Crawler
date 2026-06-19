const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  const res = await axios.get('https://www.taobao.com/list/product/%E7%A7%8B%E8%A3%85.htm', {
    timeout: 10000,
    validateStatus: () => true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  });
  console.log('status', res.status, 'len', res.data.length);
  const $ = cheerio.load(res.data);
  console.log('img tags:', $('img').length);
  console.log('a tags:', $('a').length);
  console.log('script tags:', $('script').length);

  // does it contain product listing markers?
  console.log('contains "item.htm":', res.data.includes('item.htm'));
  console.log('contains "mtop." api hint:', /mtop\.|h5api|\.taobao\.com\/api/i.test(res.data));

  // print body text length (stripped) to see if real content rendered server-side
  console.log('visible text sample:', $('body').text().replace(/\s+/g,' ').slice(0,300));

  // check for window.__INITIAL or similar state blobs
  const stateMatch = res.data.match(/window\.__\w+__\s*=\s*/g);
  console.log('inline state vars found:', stateMatch);
})();
