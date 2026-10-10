// QuickDrop: Netlify үчүн статикалык build.
//   client/ -> dist/ көчүрөт, dist/config.js жана dist/_headers түзөт.
//
// Чөйрө өзгөрмөлөрү:
//   QUICKDROP_API_URL     = https://quickdrop-api.onrender.com  (signaling серверинин дареги)
//   QUICKDROP_ICE_SERVERS = [{"urls":"stun:stun.l.google.com:19302"}]  (JSON, ыктыярдуу)
//   NETLIFY               = true  (Netlify өзү коёт: анда QUICKDROP_API_URL милдеттүү жана https)
//
// QUICKDROP_API_URL жок болсо (локалдык build), frontend API'ни ошол эле origin'ден издейт.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const DIST_DIR = path.join(ROOT, 'dist');
const IS_NETLIFY = process.env.NETLIFY === 'true';

function fail(message) {
  console.error(`[build] КАТА: ${message}`);
  process.exit(1);
}

function isLocalHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('127.')
  );
}

// QUICKDROP_API_URL -> { apiBase: 'https://host', wsBase: 'wss://host' }
function readApiConfig() {
  const raw = (process.env.QUICKDROP_API_URL || '').trim();
  if (!raw) {
    if (IS_NETLIFY) fail('Netlify build үчүн QUICKDROP_API_URL керек (мис. https://quickdrop-api.onrender.com)');
    console.warn('[build] ЭСКЕРТҮҮ: QUICKDROP_API_URL жок, frontend API\'ни ошол эле origin\'ден колдонот');
    return { apiBase: '', wsBase: '' };
  }

  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    fail(`QUICKDROP_API_URL туура URL эмес: "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`QUICKDROP_API_URL http:// же https:// менен башталышы керек: "${raw}"`);
  }
  if (IS_NETLIFY) {
    if (url.protocol !== 'https:') fail(`Netlify'де QUICKDROP_API_URL https:// болушу керек: "${raw}"`);
    if (isLocalHostname(url.hostname)) fail(`Netlify'де QUICKDROP_API_URL localhost боло албайт: "${raw}"`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    console.warn(`[build] ЭСКЕРТҮҮ: QUICKDROP_API_URL'дун жолу эске алынбайт, origin гана колдонулат: ${url.origin}`);
  }

  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return { apiBase: url.origin, wsBase: `${wsProtocol}//${url.host}` };
}

// QUICKDROP_ICE_SERVERS (JSON массив) -> массив же null
function readIceServers() {
  const raw = (process.env.QUICKDROP_ICE_SERVERS || '').trim();
  if (!raw) return null;

  let servers;
  try {
    servers = JSON.parse(raw);
  } catch (error) {
    fail(`QUICKDROP_ICE_SERVERS туура JSON эмес: ${error.message}`);
  }
  const isUrlList = (urls) =>
    typeof urls === 'string' || (Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string'));
  if (!Array.isArray(servers) || servers.length === 0 || !servers.every((s) => s && isUrlList(s.urls))) {
    fail('QUICKDROP_ICE_SERVERS [{ "urls": "stun:..." }] түрүндөгү массив болушу керек');
  }
  if (servers.some((s) => s.credential || s.username)) {
    console.warn(
      '[build] ЭСКЕРТҮҮ: QUICKDROP_ICE_SERVERS ичинде TURN ачкычтары бар. Алар статикада бардыгына ачык көрүнөт! ' +
        'TURN ачкычтарын backend\'ден кыска мөөнөттүү кылып бериңиз.'
    );
  }
  return servers;
}

function buildHeaders({ apiBase, wsBase }) {
  const connectSrc = ["'self'", apiBase, wsBase].filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  X-Frame-Options: DENY',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '',
  ].join('\n');
}

function main() {
  if (!fs.existsSync(path.join(CLIENT_DIR, 'vendor', 'qrcode.min.js'))) {
    fail('client/vendor/qrcode.min.js табылган жок');
  }

  const api = readApiConfig();
  const iceServers = readIceServers();

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.cpSync(CLIENT_DIR, DIST_DIR, { recursive: true });

  const config = { apiBase: api.apiBase, wsBase: api.wsBase, iceServers };
  fs.writeFileSync(
    path.join(DIST_DIR, 'config.js'),
    `// scripts/build.js түзгөн файл. Колго өзгөртпөңүз.\nwindow.QUICKDROP_CONFIG = ${JSON.stringify(config, null, 2)};\n`
  );
  fs.writeFileSync(path.join(DIST_DIR, '_headers'), buildHeaders(api));

  console.log('[build] dist/ даяр');
  console.log(`[build]   apiBase: ${api.apiBase || '(ошол эле origin)'}`);
  console.log(`[build]   wsBase:  ${api.wsBase || '(ошол эле origin)'}`);
  console.log(`[build]   iceServers: ${iceServers ? JSON.stringify(iceServers.map((s) => s.urls)) : '(демейки STUN)'}`);
}

main();
