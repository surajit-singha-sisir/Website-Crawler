const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

// ----------------------------------------------------------------------
// Signature definitions
// ----------------------------------------------------------------------

// Checked against window globals / DOM, evaluated inside the rendered page.
// Each entry is [name, category, jsExpression]. The expression is run inside
// a try/catch in-browser, so it's fine if a global doesn't exist.
const GLOBAL_CHECKS = [
  ['React', 'Frontend Framework', 'window.React !== undefined || document.querySelector("[data-reactroot], #__next, #root[data-reactid]") !== null'],
  ['Vue.js', 'Frontend Framework', 'window.Vue !== undefined || document.querySelector("[data-v-app]") !== null || document.querySelector("*").__vue__ !== undefined'],
  ['Angular', 'Frontend Framework', 'window.ng !== undefined || window.getAllAngularRootElements !== undefined || document.querySelector("[ng-version]") !== null'],
  ['Svelte', 'Frontend Framework', 'document.querySelector("[class*=\'svelte-\']") !== null'],
  ['jQuery', 'JS Library', 'window.jQuery !== undefined || window.$ !== undefined && window.$.fn !== undefined'],
  ['Alpine.js', 'JS Library', 'window.Alpine !== undefined'],
  ['Next.js', 'Meta-framework', 'window.__NEXT_DATA__ !== undefined'],
  ['Nuxt.js', 'Meta-framework', 'window.__NUXT__ !== undefined'],
  ['Gatsby', 'Meta-framework', 'window.___gatsby !== undefined'],
  ['Remix', 'Meta-framework', 'window.__remixContext !== undefined'],
  ['Webpack', 'Build Tool', 'window.webpackJsonp !== undefined || window.__webpack_require__ !== undefined'],
  ['Vite', 'Build Tool', 'window.__vite_plugin_react_preamble_installed__ !== undefined'],
  ['Shopify', 'E-commerce Platform', 'window.Shopify !== undefined'],
  ['WordPress', 'CMS', 'window.wp !== undefined'],
  ['Webflow', 'Website Builder', 'window.Webflow !== undefined'],
  ['Squarespace', 'Website Builder', 'window.Static !== undefined && window.Squarespace !== undefined'],
  ['Wix', 'Website Builder', 'window.wixBiSession !== undefined || window.wixPerformanceMeasurements !== undefined'],
  ['Bootstrap', 'CSS Framework', 'window.bootstrap !== undefined'],
  ['Google Tag Manager', 'Analytics', 'window.google_tag_manager !== undefined'],
  ['Google Analytics', 'Analytics', 'window.ga !== undefined || window.gtag !== undefined'],
  ['Stripe', 'Payments', 'window.Stripe !== undefined'],
  ['Cloudflare Turnstile / Bot Protection', 'Security', 'window.turnstile !== undefined || window._cf_chl_opt !== undefined'],
];

// Checked against script src / link href attribute text (case-insensitive substring match)
const URL_SIGNATURES = [
  ['react', 'React', 'Frontend Framework'],
  ['vue.js', 'Vue.js', 'Frontend Framework'],
  ['vue.runtime', 'Vue.js', 'Frontend Framework'],
  ['angular', 'Angular', 'Frontend Framework'],
  ['svelte', 'Svelte', 'Frontend Framework'],
  ['jquery', 'jQuery', 'JS Library'],
  ['alpinejs', 'Alpine.js', 'JS Library'],
  ['htmx', 'htmx', 'JS Library'],
  ['_next/static', 'Next.js', 'Meta-framework'],
  ['nuxt', 'Nuxt.js', 'Meta-framework'],
  ['gatsby', 'Gatsby', 'Meta-framework'],
  ['cdn.tailwindcss.com', 'Tailwind CSS', 'CSS Framework'],
  ['tailwind', 'Tailwind CSS', 'CSS Framework'],
  ['bootstrap', 'Bootstrap', 'CSS Framework'],
  ['bulma', 'Bulma', 'CSS Framework'],
  ['foundation.min', 'Foundation', 'CSS Framework'],
  ['fontawesome', 'Font Awesome', 'Icon Library'],
  ['use.typekit', 'Adobe Fonts (Typekit)', 'Font Service'],
  ['fonts.googleapis.com', 'Google Fonts', 'Font Service'],
  ['wp-content', 'WordPress', 'CMS'],
  ['wp-includes', 'WordPress', 'CMS'],
  ['cdn.shopify.com', 'Shopify', 'E-commerce Platform'],
  ['static.wixstatic.com', 'Wix', 'Website Builder'],
  ['squarespace.com', 'Squarespace', 'Website Builder'],
  ['webflow.com', 'Webflow', 'Website Builder'],
  ['googletagmanager.com', 'Google Tag Manager', 'Analytics'],
  ['google-analytics.com', 'Google Analytics', 'Analytics'],
  ['gtag/js', 'Google Analytics (gtag.js)', 'Analytics'],
  ['facebook.net/.../fbevents', 'Meta Pixel', 'Analytics'],
  ['connect.facebook.net', 'Meta Pixel / Facebook SDK', 'Analytics'],
  ['hotjar.com', 'Hotjar', 'Analytics'],
  ['cloudflareinsights.com', 'Cloudflare Web Analytics', 'Analytics'],
  ['js.stripe.com', 'Stripe', 'Payments'],
  ['js.paypal.com', 'PayPal', 'Payments'],
  ['recaptcha', 'Google reCAPTCHA', 'Security'],
  ['hcaptcha.com', 'hCaptcha', 'Security'],
  ['swiper-bundle', 'Swiper.js', 'JS Library'],
  ['cdnjs.cloudflare.com', 'cdnjs (Cloudflare CDN)', 'CDN'],
  ['unpkg.com', 'unpkg CDN', 'CDN'],
  ['jsdelivr.net', 'jsDelivr CDN', 'CDN'],
];

// Checked against response headers (lowercased header names)
const HEADER_SIGNATURES = [
  { header: 'server', match: /cloudflare/i, name: 'Cloudflare', category: 'CDN / Hosting' },
  { header: 'server', match: /nginx/i, name: 'Nginx', category: 'Web Server' },
  { header: 'server', match: /apache/i, name: 'Apache', category: 'Web Server' },
  { header: 'server', match: /microsoft-iis/i, name: 'Microsoft IIS', category: 'Web Server' },
  { header: 'server', match: /vercel/i, name: 'Vercel', category: 'CDN / Hosting' },
  { header: 'x-powered-by', match: /express/i, name: 'Express.js', category: 'Backend Framework' },
  { header: 'x-powered-by', match: /php/i, name: 'PHP', category: 'Backend Language' },
  { header: 'x-powered-by', match: /asp\.net/i, name: 'ASP.NET', category: 'Backend Framework' },
  { header: 'x-powered-by', match: /next\.js/i, name: 'Next.js', category: 'Meta-framework' },
  { header: 'x-vercel-id', match: /.+/, name: 'Vercel', category: 'CDN / Hosting' },
  { header: 'x-nf-request-id', match: /.+/, name: 'Netlify', category: 'CDN / Hosting' },
  { header: 'cf-ray', match: /.+/, name: 'Cloudflare', category: 'CDN / Hosting' },
  { header: 'x-shopify-stage', match: /.+/, name: 'Shopify', category: 'E-commerce Platform' },
  { header: 'x-drupal-cache', match: /.+/, name: 'Drupal', category: 'CMS' },
  { header: 'x-generator', match: /drupal/i, name: 'Drupal', category: 'CMS' },
  { header: 'x-amz-cf-id', match: /.+/, name: 'Amazon CloudFront', category: 'CDN / Hosting' },
];

// Checked against Set-Cookie names
const COOKIE_SIGNATURES = [
  { match: /^wordpress_logged_in/i, name: 'WordPress', category: 'CMS' },
  { match: /^wp-settings/i, name: 'WordPress', category: 'CMS' },
  { match: /^PHPSESSID/i, name: 'PHP', category: 'Backend Language' },
  { match: /^ASP\.NET_SessionId/i, name: 'ASP.NET', category: 'Backend Framework' },
  { match: /^laravel_session/i, name: 'Laravel', category: 'Backend Framework' },
  { match: /^django_session/i, name: 'Django', category: 'Backend Framework' },
  { match: /^_shopify_/i, name: 'Shopify', category: 'E-commerce Platform' },
  { match: /^ci_session/i, name: 'CodeIgniter', category: 'Backend Framework' },
];

function addTech(map, name, category, confidence, evidence) {
  const key = name;
  if (!map.has(key)) {
    map.set(key, { name, category, confidence, evidence: new Set([evidence]) });
  } else {
    const entry = map.get(key);
    entry.evidence.add(evidence);
    // Multiple independent signals raise our confidence
    if (confidence === 'high') entry.confidence = 'high';
  }
}

async function fetchRawResponse(rootUrl, timeout) {
  try {
    const res = await axios.get(rootUrl, {
      timeout,
      validateStatus: () => true,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    return res;
  } catch (err) {
    return null;
  }
}

async function fetchRenderedPage(rootUrl, timeout) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(rootUrl, { waitUntil: 'networkidle2', timeout });
    await new Promise(r => setTimeout(r, 800));

    const html = await page.content();

    const globalFlags = await page.evaluate((checks) => {
      const results = {};
      for (const [name, , expr] of checks) {
        try {
          // eslint-disable-next-line no-eval
          results[name] = !!eval(expr);
        } catch {
          results[name] = false;
        }
      }
      return results;
    }, GLOBAL_CHECKS);

    return { html, globalFlags };
  } catch (err) {
    return { html: null, globalFlags: {} };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

/**
 * Detects the tech stack of a single root URL. Combines:
 *  - raw HTTP response headers + cookies (server/CDN/CMS fingerprints)
 *  - raw (pre-JS) HTML for <meta name="generator">, script/link URLs
 *  - rendered (post-JS) HTML + window globals via Puppeteer, for SPA frameworks
 *    that only reveal themselves after hydration
 *
 * Returns { technologies: [{name, category, confidence, evidence}], meta: {...}, detectedAt }
 */
async function detectTechStack(rootUrl, timeout = 15000) {
  const found = new Map();
  const meta = { server: null, poweredBy: null, generator: null, title: null };

  const [rawRes, rendered] = await Promise.all([
    fetchRawResponse(rootUrl, timeout),
    fetchRenderedPage(rootUrl, timeout),
  ]);

  // --- Headers ---
  if (rawRes) {
    const headers = rawRes.headers || {};
    meta.server = headers['server'] || null;
    meta.poweredBy = headers['x-powered-by'] || null;

    for (const sig of HEADER_SIGNATURES) {
      const val = headers[sig.header];
      if (val && sig.match.test(val)) {
        addTech(found, sig.name, sig.category, 'high', `header: ${sig.header}`);
      }
    }

    const setCookie = headers['set-cookie'] || [];
    const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const cookieStr of cookieList) {
      for (const sig of COOKIE_SIGNATURES) {
        if (sig.match.test(cookieStr)) {
          addTech(found, sig.name, sig.category, 'medium', 'cookie');
        }
      }
    }
  }

  // --- Raw (pre-JS) HTML: meta generator + script/link URLs ---
  const rawHtml = rawRes && typeof rawRes.data === 'string' ? rawRes.data : '';
  if (rawHtml) {
    try {
      const $ = cheerio.load(rawHtml);
      const generator = $('meta[name="generator"]').attr('content');
      if (generator) {
        meta.generator = generator;
        addTech(found, generator.split(' ')[0], 'CMS / Platform', 'high', 'meta generator tag');
      }
      meta.title = $('title').first().text() || null;

      const urls = [];
      $('script[src]').each((_, el) => urls.push($(el).attr('src')));
      $('link[href]').each((_, el) => urls.push($(el).attr('href')));
      for (const url of urls) {
        if (!url) continue;
        const lower = url.toLowerCase();
        for (const [needle, name, category] of URL_SIGNATURES) {
          if (lower.includes(needle)) addTech(found, name, category, 'medium', `url: ${needle}`);
        }
      }

      // Tailwind heuristic: a high density of utility-style class tokens
      const classBlobs = [];
      $('[class]').slice(0, 200).each((_, el) => classBlobs.push($(el).attr('class')));
      const utilityHits = classBlobs.join(' ').match(/\b(flex|grid|items-center|justify-between|text-(xs|sm|lg|xl)|bg-[a-z]+-\d{3}|p-\d|m-\d|rounded-(lg|xl|full))\b/g) || [];
      if (utilityHits.length > 15) addTech(found, 'Tailwind CSS', 'CSS Framework', 'medium', 'utility class density heuristic');
    } catch {}
  }

  // --- Rendered HTML + window globals ---
  if (rendered.html) {
    try {
      const $ = cheerio.load(rendered.html);
      const urls = [];
      $('script[src]').each((_, el) => urls.push($(el).attr('src')));
      $('link[href]').each((_, el) => urls.push($(el).attr('href')));
      for (const url of urls) {
        if (!url) continue;
        const lower = url.toLowerCase();
        for (const [needle, name, category] of URL_SIGNATURES) {
          if (lower.includes(needle)) addTech(found, name, category, 'medium', `url: ${needle}`);
        }
      }
    } catch {}
  }

  for (const [name, category, expr] of GLOBAL_CHECKS) {
    if (rendered.globalFlags && rendered.globalFlags[name]) {
      addTech(found, name, category, 'high', 'runtime window global');
    }
  }

  const technologies = [...found.values()]
    .map(t => ({ name: t.name, category: t.category, confidence: t.confidence, evidence: [...t.evidence] }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  return { technologies, meta, detectedAt: new Date().toISOString() };
}

module.exports = { detectTechStack };
