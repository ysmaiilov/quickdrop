// QuickDrop: dist/ папкасын локалдык текшерүү үчүн берет (Netlify'ди окшоштурат).
//   http://127.0.0.1:8888 , /join/* -> /join.html , dist/_headers колдонулат.
// Алгач: node scripts/build.js

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DIST_ROOT = DIST_DIR + path.sep;
const HOST = '127.0.0.1';
const PORT = Number(process.env.PREVIEW_PORT) || 8888;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error('[preview] КАТА: dist/ табылган жок. Алгач: node scripts/build.js');
  process.exit(1);
}

// Netlify _headers форматы: жол сабы, андан кийин чегинүү менен "Ат: маани" саптары
function loadHeaderRules() {
  const file = path.join(DIST_DIR, '_headers');
  if (!fs.existsSync(file)) return [];

  const rules = [];
  let current = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
    } else if (current) {
      const index = line.indexOf(':');
      if (index > 0) current.headers.push([line.slice(0, index).trim(), line.slice(index + 1).trim()]);
    }
  }
  return rules;
}

function matchesPattern(pattern, urlPath) {
  if (pattern.endsWith('/*')) return urlPath.startsWith(pattern.slice(0, -1));
  return pattern === urlPath;
}

const headerRules = loadHeaderRules();

// URL -> dist ичиндеги файл (netlify.toml'догу redirect'ти окшоштурат)
function resolveFile(urlPath) {
  if (urlPath.includes('\0')) return null;
  let cleanPath = urlPath;
  if (urlPath === '/') cleanPath = '/index.html';
  if (urlPath.startsWith('/join/')) cleanPath = '/join.html';

  const filePath = path.normalize(path.join(DIST_DIR, cleanPath));
  if (!filePath.startsWith(DIST_ROOT)) return null;
  return filePath;
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (error) {
    res.writeHead(400).end();
    return;
  }

  for (const rule of headerRules) {
    if (matchesPattern(rule.pattern, urlPath)) {
      for (const [name, value] of rule.headers) res.setHeader(name, value);
    }
  }

  const filePath = resolveFile(urlPath);
  if (!filePath || path.basename(filePath) === '_headers') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Табылган жок (404)');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Табылган жок (404)');
      return;
    }
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[preview] dist/ берилүүдө: http://${HOST}:${PORT}`);
});
