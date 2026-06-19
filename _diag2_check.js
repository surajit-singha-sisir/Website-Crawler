const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  const res = await axios.get('https://www.taobao.com/list/product/wap/wholesale.htm?from=redirectFromAutoCallApp', {
    timeout: 10000,
    validateStatus: () => true,
    headers: { 'User-Agent': 'DomainFileCrawler/1.0 (+https://github.com/kehem-it)' },
  });
  const html = res.data;
  console.log('total length:', html.length);

  const $ = cheerio.load(html);
  console.log('img tags total:', $('img').length);

  let realSrc = 0, dataSrcAttrs = new Set(), placeholderLike = 0;
  $('img').each((_, el) => {
    const attribs = el.attribs || {};
    Object.keys(attribs).forEach(a => { if (/data.*src|lazy|original/i.test(a)) dataSrcAttrs.add(a); });
    const src = attribs.src || '';
    if (/^data:image/.test(src) || src.length < 5) placeholderLike++;
    else realSrc++;
  });
  console.log('img with real-looking src:', realSrc, 'placeholder-ish:', placeholderLike);
  console.log('lazy/data-src-like attrs found on <img>:', [...dataSrcAttrs]);

  // Sample a few img tags raw
  console.log('--- sample img tags ---');
  $('img').slice(0, 5).each((_, el) => console.log($.html(el)));

  // Look for image-looking URLs anywhere in raw HTML (incl inside <script> JSON blobs)
  const urlRegex = /https?:\/\/[^\s"'<>\\]+\.(?:jpg|jpeg|png|gif|webp|mp4|m3u8)[^\s"'<>\\]*/gi;
  const allMatches = new Set(html.match(urlRegex) || []);
  console.log('total distinct file-like URLs anywhere in raw HTML:', allMatches.size);
  console.log('sample:', [...allMatches].slice(0, 5));

  // How many of those are inside <script> tags only (i.e. not in img/a/link/etc tags)
  let scriptText = '';
  $('script').each((_, el) => { scriptText += $(el).html() || ''; });
  const inScript = new Set(scriptText.match(urlRegex) || []);
  console.log('file-like URLs inside <script> blocks:', inScript.size);

  console.log('script tag count:', $('script').length);
  console.log('script with type application/json or similar:', $('script[type]').map((_,el)=>$(el).attr('type')).get());
})();
