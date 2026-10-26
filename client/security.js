// QuickDrop: коопсуздук жардамчылары (9-этап).
// Телефондон келген файлдын аты ишенимсиз маалымат: аны ар дайым тазалайбыз.
// Бул файл эки бетте тең колдонулат.

const MAX_FILE_NAME_LENGTH = 120;

// Компьютерде ачылганда программа катары иштеп кетиши мүмкүн файл түрлөрү.
// Алар кабыл алынбайт (кадимки документтер, сүрөттөр, архивдер өтөт).
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'msp', 'bat', 'cmd', 'com', 'scr', 'pif', 'lnk',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'ps1', 'psm1',
  'reg', 'dll', 'cpl', 'inf', 'jar', 'sh', 'command', 'dmg', 'pkg', 'app', 'apk',
  // Кошумча скрипттер жана орнотуучулар (Windows / Linux / macOS / Android)
  'py', 'pyw', 'pl', 'rb', 'php', 'cgi', 'mjs', 'cjs', 'vb', 'ws', 'url', 'scf',
  'msix', 'msixbundle', 'appx', 'appxbundle', 'msc', 'gadget', 'application', 'appref-ms',
  'deb', 'rpm', 'run', 'bin', 'appimage', 'desktop', 'flatpakref', 'snap',
  'ipa', 'xapk', 'aab', 'workflow', 'action', 'scpt', 'terminal',
  // Макросу бар Office документтери
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'sldm',
  // Браузерде ачылганда скрипт иштеткен файлдар
  'html', 'htm', 'xhtml', 'svg', 'swf',
]);

// Windows'ттун атайын аттары (CON, NUL, COM1 ...): алар файл ат катары иштебейт
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Сүрөттүн түрүнө жараша сакталуучу кеңейтүү
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// "report.PDF" -> "pdf", кеңейтүү жок болсо ''
function getFileExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

// Файлдын атын коопсуз кылат:
//   - көзгө көрүнбөгөн жана башкаруу символдорун алып салат (RTL алдамчылыгы: "photo‮gpj.exe")
//   - жолдун символдорун (\ / : * ? " < > |) алмаштырат
//   - башындагы чекиттерди жана аягындагы чекит/боштуктарды алып салат (Windows аларды өзү алып салат)
//   - өтө узун болсо кыскартат, бирок кеңейтүүнү сактайт
//   - Windows'тун атайын аттарын (CON, NUL ...) өзгөртөт
function makeSafeFileName(name, fallback) {
  let cleaned = String(name)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');

  if (cleaned.length > MAX_FILE_NAME_LENGTH) {
    const extension = getFileExtension(cleaned);
    const suffix = extension && extension.length <= 10 ? `.${extension}` : '';
    cleaned = cleaned.slice(0, MAX_FILE_NAME_LENGTH - suffix.length).replace(/[. ]+$/, '') + suffix;
  }

  if (WINDOWS_RESERVED_NAMES.test(cleaned.split('.')[0])) cleaned = `_${cleaned}`;

  return cleaned || fallback;
}

// Файл түрү коопсуздук үчүн бөгөттөлгөнбү? (аты тазаланган түрүндө текшерилет)
function isBlockedFileName(name) {
  return BLOCKED_EXTENSIONS.has(getFileExtension(makeSafeFileName(name, 'file')));
}

// Сүрөттүн сакталуучу аты: кеңейтүү сүрөттүн чыныгы түрүнөн алынат.
// Ошондуктан "virus.exe" деп аталган сүрөт "virus.png" болуп сакталат.
function makeSafeImageName(name, mime) {
  const safe = makeSafeFileName(name, 'image');
  const dot = safe.lastIndexOf('.');
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  return `${base || 'image'}.${IMAGE_EXTENSIONS[mime] || 'jpg'}`;
}