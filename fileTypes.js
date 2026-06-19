const FILE_CATEGORIES = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm3u8', 'mpd', 'flv', 'm4v', '3gp'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tiff', 'tif'],
  audio: ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'opus', 'wma', 'ra'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'epub', 'mobi', 'rtf', 'odt', 'ods', 'odp'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  // Source/script files. Note: '.ts' is genuinely ambiguous (TypeScript source
  // vs. an MPEG-2 transport-stream video segment, which HLS playlists use
  // constantly). We bias '.ts' toward "code" since that's the far more common
  // meaning on the open web outside of video CDNs; video .ts segments are still
  // caught separately because they're almost always referenced from an .m3u8
  // playlist rather than discovered as a bare link.
  // NOTE: '.html'/'.htm' are deliberately NOT included here even though they're
  // "source files" in a sense — classifying them as files would stop the
  // crawler from following links out of them, since processUrl() treats any
  // isFileUrl() match as a dead-end download rather than a page to parse.
  code: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'php', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rb', 'sh', 'wasm', 'map'],
  data: ['json', 'xml', 'yaml', 'yml', 'toml', 'ndjson', 'jsonl', 'sql', 'db', 'sqlite'],
  font: ['woff', 'woff2', 'ttf', 'otf', 'eot'],
};

const EXT_TO_CATEGORY = {};
for (const [cat, exts] of Object.entries(FILE_CATEGORIES)) {
  for (const ext of exts) EXT_TO_CATEGORY[ext] = cat;
}

const ALL_EXTENSIONS = new Set(Object.values(FILE_CATEGORIES).flat());

function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot === -1) return null;
    const ext = pathname.slice(dot + 1).toLowerCase().split('?')[0];
    return ext.length <= 10 ? ext : null;
  } catch {
    return null;
  }
}

function getCategory(ext) {
  return EXT_TO_CATEGORY[ext] || 'other';
}

function isFileUrl(url) {
  const ext = getExtension(url);
  return ext ? ALL_EXTENSIONS.has(ext) : false;
}

function getFileName(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || url;
  } catch {
    return url;
  }
}

module.exports = { FILE_CATEGORIES, EXT_TO_CATEGORY, ALL_EXTENSIONS, getExtension, getCategory, isFileUrl, getFileName };
