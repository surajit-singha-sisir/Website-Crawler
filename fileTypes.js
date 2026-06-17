const FILE_CATEGORIES = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm3u8', 'ts', 'mpd', 'flv', 'm4v', '3gp'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tiff', 'tif'],
  audio: ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'opus', 'wma', 'ra'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'zip', 'rar', '7z', 'tar', 'gz', 'epub', 'mobi'],
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
