// QuickDrop: HTTP + WebSocket + signaling server (9-этап: коопсуздук аудити).
// Негизги коопсуздук чаралары:
//   - computerToken: session'ду башкаруу (катталуу, жабуу) компьютерде гана
//   - телефон туташканда компьютер уруксат берет (тастыктоо коду менен)
//   - Host/Origin текшерүү (CSWSH, DNS rebinding, CSRF)
//   - rate limiting, лимиттер, signaling билдирүүлөрүн текшерүү
//   - коопсуздук header'лери (CSP, HSTS ж.б.)
// Сервер файлдарды, текстти сактабайт жана окубайт: алар WebRTC аркылуу түз өтөт.
//
// Локалдык режим (демейки): `node server/server.js` -> http://localhost:3000
//   client/ файлдары ушул серверден берилет, QR'да LAN IP колдонулат.
//
// Production (Netlify + өзүнчө signaling сервер) үчүн чөйрө өзгөрмөлөрү:
//   NODE_ENV        = production
//   SERVE_CLIENT    = 0                              (client файлдарын бербейт, "API гана" режими)
//   PUBLIC_URL      = https://quickdrop.netlify.app  (frontend дареги: QR шилтемеси ушундан түзүлөт)
//   ALLOWED_HOSTS   = quickdrop-api.onrender.com     (ушул сервердин домени, үтүр менен)
//   ALLOWED_ORIGINS = https://custom.example.com     (кошумча frontend origin'дер, ыктыярдуу)
//   TRUST_PROXY     = 1                              (reverse proxy / HTTPS терминатор артында)
// Сессиялар RAM'да сакталат: сервер бир гана инстанс болуп иштеши керек.

'use strict';

const http = require('http');
const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

/* ===================== КОНФИГУРАЦИЯ ===================== */

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// SERVE_CLIENT=0: client/ файлдары берилбейт (frontend Netlify'де турат)
const SERVE_CLIENT = process.env.SERVE_CLIENT !== '0';

// Конфигурация катасы: серверди баштабайбыз
function configError(message) {
  console.error(`[config] КАТА: ${message}`);
  process.exit(1);
}

function configWarning(message) {
  console.warn(`[config] ЭСКЕРТҮҮ: ${message}`);
}

// "https://Example.com/path" -> "https://example.com" (http/https гана)
function parseOrigin(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    configError(`${name} туура URL эмес: "${value}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    configError(`${name} http:// же https:// менен башталышы керек: "${value}"`);
  }
  return parsed.origin;
}

// Үтүр менен бөлүнгөн тизме: "a, b,,c" -> ['a', 'b', 'c']
function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Туруктуу frontend дареги (мис. https://quickdrop.netlify.app). QR шилтемеси ушундан түзүлөт.
let PUBLIC_URL = null;
let PUBLIC_HOST = null;
if (process.env.PUBLIC_URL) {
  PUBLIC_URL = parseOrigin(process.env.PUBLIC_URL, 'PUBLIC_URL');
  PUBLIC_HOST = new URL(PUBLIC_URL).host;
}

// Ушул серверге кайрылууга уруксат берилген Host'тор (DNS rebinding'ден коргоо).
// Бош болсо локалдык эреже иштейт (localhost, IP, *.local).
const ALLOWED_HOSTS = new Set(parseList(process.env.ALLOWED_HOSTS).map((host) => host.toLowerCase()));
// Client ушул серверден берилсе, PUBLIC_URL'дун хосту да ушул сервер
if (SERVE_CLIENT && PUBLIC_HOST) ALLOWED_HOSTS.add(PUBLIC_HOST);

// API жана WebSocket'ке кайрыла алган башка сайттар (frontend). PUBLIC_URL автоматтык кошулат.
const ALLOWED_ORIGINS = new Set(
  parseList(process.env.ALLOWED_ORIGINS).map((origin) => parseOrigin(origin, 'ALLOWED_ORIGINS'))
);
if (PUBLIC_URL) ALLOWED_ORIGINS.add(PUBLIC_URL);

// Конфигурацияны текшерүү
if (!SERVE_CLIENT) {
  if (!PUBLIC_URL) configError('SERVE_CLIENT=0 болгондо PUBLIC_URL (frontend дареги) керек');
  if (!process.env.ALLOWED_HOSTS) configError('SERVE_CLIENT=0 болгондо ALLOWED_HOSTS (ушул сервердин домени) керек');
}
if (IS_PRODUCTION || !SERVE_CLIENT) {
  if (!TRUST_PROXY) {
    configWarning('TRUST_PROXY=1 коюлган эмес: proxy артында IP лимиттери жана HTTPS аныктоо туура иштебейт');
  }
  if (!PUBLIC_URL) {
    configWarning('PUBLIC_URL коюлган эмес: QR шилтемеси суроонун Host\'унан түзүлөт');
  } else if (!PUBLIC_URL.startsWith('https://')) {
    configWarning(`PUBLIC_URL https эмес (${PUBLIC_URL}): телефондо WebRTC/WSS иштебей калышы мүмкүн`);
  }
}

const CLIENT_DIR = path.resolve(__dirname, '..', 'client');
const CLIENT_ROOT = CLIENT_DIR + path.sep; // префикс текшерүү үчүн (client-evil сыяктуу папкалар өтпөсүн)

const SESSION_TTL_MS = 2 * 60 * 1000; // QR-код 2 мүнөт жарактуу
const APPROVAL_TIMEOUT_MS = 30 * 1000; // компьютер уруксат берүүгө канча убакыт бар
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // session'дун эң узак жашоо убактысы
const CLOSED_SESSION_TTL_MS = 10 * 60 * 1000; // жабылган session'ду канча убакыт эстейбиз
const HEARTBEAT_INTERVAL_MS = 25 * 1000;

const MAX_ACTIVE_SESSIONS = 500; // бир убакта активдүү session'дордун саны
const MAX_WS_CLIENTS = 1000; // бир убакта WebSocket'тердин саны
const MAX_WS_PER_IP = 10; // бир IP'ден бир убакта WebSocket'тердин саны
const MAX_WS_MESSAGES = 150; // бир WebSocket'тен 10 секундда билдирүүлөр
const MAX_SIGNALS_PER_SESSION = 200; // бир session'до signaling билдирүүлөр
const MAX_SDP_LENGTH = 12000;
const MAX_CANDIDATE_LENGTH = 1024;

// Активдүү session'дор:
//   id -> { createdAt, expiresAt, computerToken, connected, approved, confirmCode,
//           approvalTimer, signalCount, computer, phone }
const sessions = new Map();

// Жабылган session'дор: id -> жабылган убакыт. Эски QR кайра колдонулбашы үчүн.
const closedSessions = new Map();

// Бир IP'ден ачык WebSocket'тердин саны
const wsPerIp = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ===================== ЛОГ ===================== */

// Логдо session ID'нин башталышын гана көрсөтөбүз (толугу эмес)
function shortId(id) {
  return `${String(id).slice(0, 6)}…`;
}

function log(...args) {
  console.log(...args);
}

/* ===================== RATE LIMITING ===================== */

// Жөнөкөй эс тутумдагы лимит: ар бир ачкыч (IP) үчүн терезе ичинде max аракет
function createRateLimiter({ windowMs, max }) {
  const entries = new Map(); // ачкыч -> { count, resetAt }
  const MAX_TRACKED = 10000;

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now >= entry.resetAt) entries.delete(key);
    }
  }

  function current(key) {
    const now = Date.now();
    let entry = entries.get(key);
    if (!entry || now >= entry.resetAt) {
      if (entries.size >= MAX_TRACKED) cleanup();
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    return entry;
  }

  return {
    // Аракетти санайт. Лимиттен ашса false кайтарат
    hit(key) {
      const entry = current(key);
      entry.count += 1;
      return entry.count <= max;
    },
    // Лимитке жеттиби? (санабастан текшерет)
    isLimited(key) {
      return current(key).count >= max;
    },
    retryAfterSec(key) {
      return Math.max(1, Math.ceil((current(key).resetAt - Date.now()) / 1000));
    },
    cleanup,
  };
}

const limiters = {
  createSession: createRateLimiter({ windowMs: 60 * 1000, max: 10 }), // жаңы session
  checkSession: createRateLimiter({ windowMs: 60 * 1000, max: 60 }), // session текшерүү
  wsConnect: createRateLimiter({ windowMs: 60 * 1000, max: 30 }), // WebSocket ачуу
  badJoin: createRateLimiter({ windowMs: 60 * 1000, max: 10 }), // ийгиликсиз кошулуу аракеттери
};

// Клиенттин IP дареги. Proxy артында гана X-Forwarded-For'го ишенебиз.
function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) {
      const parts = forwarded.split(',');
      return parts[parts.length - 1].trim(); // өзүбүздүн proxy кошкон акыркы маани
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/* ===================== HOST / ORIGIN ТЕКШЕРҮҮ ===================== */

// Host header'ден хост атын алат: "localhost:3000" -> "localhost", "[::1]:3000" -> "::1"
function getHostname(hostHeader) {
  const host = String(hostHeader || '').toLowerCase();
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']'));
  return host.split(':')[0];
}

// DNS rebinding'ден коргойт: белгисиз домен аттары менен суроолор кабыл алынбайт
function isAllowedHost(hostHeader) {
  if (!hostHeader) return false;
  if (ALLOWED_HOSTS.size > 0) return ALLOWED_HOSTS.has(String(hostHeader).toLowerCase());

  const hostname = getHostname(hostHeader);
  return hostname === 'localhost' || net.isIP(hostname) !== 0 || hostname.endsWith('.local');
}

// Origin allowlist'теби (ALLOWED_ORIGINS + PUBLIC_URL)?
function isListedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.has(origin.toLowerCase());
}

// Cross-site суроолорго (CSRF, CSWSH) жол бербейт:
// Origin allowlist'те болушу же биздин хост менен бирдей болушу керек.
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // браузер эмес клиент же ошол эле origin'ден GET
  if (isListedOrigin(origin)) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host).toLowerCase();
  } catch (error) {
    return false;
  }
}

// CORS header'лери: allowlist'теги origin'ге гана (same-host үчүн CORS керек эмес)
function applyCors(req, res) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (!isListedOrigin(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
}

// OPTIONS preflight (мис. DELETE + X-Session-Token үчүн браузер алгач сурайт)
function handlePreflight(req, res) {
  if (!isListedOrigin(req.headers.origin)) {
    sendJson(res, 403, { error: 'forbidden_origin' });
    return;
  }
  res.writeHead(204, {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
    'Access-Control-Max-Age': '600',
  });
  res.end();
}

// HTTPS аркылуу келдиби?
function isSecureRequest(req) {
  if (req.socket.encrypted) return true;
  return TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';
}

/* ===================== КООПСУЗДУК HEADER'ЛЕРИ ===================== */

// script-src 'self': баардык скрипттер өз серверибизден (тышкы CDN жок).
// style-src 'unsafe-inline': JS аркылуу коюлган стилдер үчүн (скрипт эмес, тобокелдиги аз).
// connect-src ws: wss: : WebSocket (http болгондо ws, https болгондо wss).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function setSecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cache-Control', 'no-cache');
  if (isSecureRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/* ===================== SESSION ===================== */

// Эки токенди убакытка көз каранды болбогон жол менен салыштырат
function tokensMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Жаңы session түзөт.
//   id: 16 кокустук байт (128 бит), QR-кодго салынат (телефонго белгилүү)
//   computerToken: 24 кокустук байт, компьютерге гана белгилүү (QR-кодго салынбайт)
function createSession() {
  if (sessions.size >= MAX_ACTIVE_SESSIONS) return null;

  const id = crypto.randomBytes(16).toString('base64url');
  const computerToken = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();

  sessions.set(id, {
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    computerToken,
    connected: false, // телефон кошулдубу (QR колдонулдубу)
    approved: false, // компьютер уруксат бердиби
    confirmCode: null,
    approvalTimer: null,
    signalCount: 0,
    computer: null,
    phone: null,
  });
  log(`[session] түзүлдү: ${shortId(id)}`);
  return { id, computerToken };
}

// QR-коддун мөөнөтү бүттү: session'ду өчүрүп, компьютерге билдиребиз
function expireSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);

  if (session.computer) {
    sendWs(session.computer, { type: 'error', code: 'session_invalid' });
    session.computer.close();
    session.computer = null;
  }
  log(`[session] мөөнөтү бүттү: ${shortId(id)}`);
}

// Session'ду кайтарат. Телефон али кошула элек болсо жана мөөнөтү бүтсө,
// өчүрүп null кайтарат. Туташкан session QR мөөнөтүнө көз каранды эмес.
function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (!session.connected && Date.now() >= session.expiresAt) {
    expireSession(id);
    return null;
  }
  return session;
}

// Session жок болгондо кайсы ката кайтарабыз: жабылганбы же мөөнөтү бүттүбү
function getMissingSessionError(id) {
  return closedSessions.has(id) ? 'session_closed' : 'session_invalid';
}

// Session'ду жабат: түзмөктөргө билдирет, WebSocket'терди жабат,
// байланыш маалыматтарын тазалайт жана id'ни "жабылган" деп белгилейт.
//   by: ким жапты ('computer', 'phone' же null),
//   reason: 'user', 'lost', 'rejected', 'timeout' же 'closed'
function closeSession(id, { by = null, reason = 'closed' } = {}) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id); // алгач өчүрөбүз, ошондо close окуялары кайра иштебейт
  closedSessions.set(id, Date.now());
  clearTimeout(session.approvalTimer);

  for (const role of ['computer', 'phone']) {
    const ws = session[role];
    session[role] = null;
    if (!ws) continue;

    // Жапкан тарапка эмес, экинчисине билдиребиз
    if (role !== by) sendWs(ws, { type: 'peer:disconnected', by, reason });
    ws.close();
  }
  log(`[session] жабылды: ${shortId(id)} (кимден: ${by || 'сервер'}, себеп: ${reason})`);
}

// Тазалоо: мөөнөтү бүткөн session'дорду жана эски белгилерди өчүрөт
setInterval(() => {
  const now = Date.now();

  for (const [id, session] of sessions) {
    if (!session.connected && now >= session.expiresAt) {
      expireSession(id);
    } else if (now - session.createdAt >= SESSION_MAX_AGE_MS) {
      closeSession(id, { by: null, reason: 'timeout' });
    }
  }
  for (const [id, closedAt] of closedSessions) {
    if (now - closedAt >= CLOSED_SESSION_TTL_MS) closedSessions.delete(id);
  }
  Object.values(limiters).forEach((limiter) => limiter.cleanup());
}, 30 * 1000).unref();

/* ===================== URL ЖАРДАМЧЫЛАРЫ ===================== */

// Компьютердин жергиликтүү тармактагы IP дареги (мис. 192.168.1.5)
function getLanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list) {
      const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
      if (isIPv4 && !iface.internal) return iface.address;
    }
  }
  return null;
}

// QR ичине салына турган дарек (телефон ачкан frontend).
//   Production / PUBLIC_URL бар: ар дайым PUBLIC_URL (Netlify дареги).
//   Жергиликтүү: localhost болсо LAN IP (телефон "localhost" дегенди ача албайт).
//   Production'до LAN IP алмаштыруу өчүк.
function getBaseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;

  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = isSecureRequest(req) ? 'https' : 'http';
  const hostname = getHostname(host);

  if (!IS_PRODUCTION && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    const lanIp = getLanIp();
    if (lanIp) return `${protocol}://${lanIp}:${PORT}`;
  }
  return `${protocol}://${host}`;
}

/* ===================== HTTP API ===================== */

// JSON жооп жөнөтөт
function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function sendTooManyRequests(res, limiter, key) {
  sendJson(
    res,
    429,
    { error: 'too_many_requests' },
    { 'Retry-After': String(limiter.retryAfterSec(key)) }
  );
}

// /api/... суроолорун иштетет
function handleApi(req, res, urlPath) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    handlePreflight(req, res);
    return;
  }

  // Белгисиз сайттан келген суроолорго жол бербейбиз (CSRF)
  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: 'forbidden_origin' });
    return;
  }

  const ip = getClientIp(req);

  // POST /api/sessions -> жаңы session түзүү
  if (req.method === 'POST' && urlPath === '/api/sessions') {
    if (!limiters.createSession.hit(ip)) {
      sendTooManyRequests(res, limiters.createSession, ip);
      return;
    }
    const created = createSession();
    if (!created) {
      sendJson(res, 503, { error: 'server_busy' });
      return;
    }
    sendJson(res, 201, {
      sessionId: created.id,
      computerToken: created.computerToken,
      joinUrl: `${getBaseUrl(req)}/join/${created.id}`,
      expiresInMs: SESSION_TTL_MS,
    });
    return;
  }

  const match = urlPath.match(/^\/api\/sessions\/([\w-]{1,64})$/);
  if (match) {
    const id = match[1];

    // GET /api/sessions/:id -> телефон кошула алабы?
    //   200: жарактуу, 409: QR буга чейин колдонулган,
    //   410: session жабылган, 404: жок же мөөнөтү бүткөн
    if (req.method === 'GET') {
      if (!limiters.checkSession.hit(ip)) {
        sendTooManyRequests(res, limiters.checkSession, ip);
        return;
      }
      const session = getSession(id);
      if (!session) {
        const reason = getMissingSessionError(id) === 'session_closed' ? 'closed' : 'expired';
        sendJson(res, reason === 'closed' ? 410 : 404, { valid: false, reason });
        return;
      }
      if (session.connected) {
        sendJson(res, 409, { valid: false, reason: 'already_connected' });
        return;
      }
      sendJson(res, 200, {
        valid: true,
        expiresInMs: session.expiresAt - Date.now(),
      });
      return;
    }

    // DELETE /api/sessions/:id -> session'ду жабуу. Компьютердин токени керек:
    // QR-кодду көргөн адам session'ду жаба албайт.
    if (req.method === 'DELETE') {
      const session = sessions.get(id);
      if (session && !tokensMatch(req.headers['x-session-token'], session.computerToken)) {
        limiters.badJoin.hit(ip);
        sendJson(res, 403, { error: 'invalid_token' });
        return;
      }
      closeSession(id, { by: null, reason: 'closed' });
      sendJson(res, 200, { deleted: true });
      return;
    }
  }

  sendJson(res, 404, { error: 'API табылган жок' });
}

/* ===================== WEBSOCKET / SIGNALING ===================== */

// maxPayload: SDP билдирүүсү бир нече KB болушу мүмкүн, ошондуктан 16 KB
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

// WebSocket аркылуу JSON жөнөтөт (ачык болсо гана)
function sendWs(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function isValidId(id) {
  return typeof id === 'string' && /^[\w-]{1,64}$/.test(id);
}

// Бир WebSocket'тен билдирүүлөр өтө тез келбесин
function allowMessage(ws) {
  const now = Date.now();
  if (now - ws.messageWindowStart >= 10 * 1000) {
    ws.messageWindowStart = now;
    ws.messageCount = 0;
  }
  ws.messageCount += 1;
  return ws.messageCount <= MAX_WS_MESSAGES;
}

// Компьютер session'ге катталат (сайт ачылганда). Токен керек.
function handleComputerRegister(ws, msg) {
  const id = msg.sessionId;
  if (!isValidId(id) || ws.role) {
    sendWs(ws, { type: 'error', code: 'session_invalid' });
    return;
  }

  const session = getSession(id);
  if (!session) {
    sendWs(ws, { type: 'error', code: getMissingSessionError(id) });
    return;
  }

  // Токен туура эмес болсо, бул компьютер эмес
  if (!tokensMatch(msg.token, session.computerToken) || session.computer) {
    limiters.badJoin.hit(ws.ip);
    sendWs(ws, { type: 'error', code: 'session_invalid' });
    log(`[ws] компьютер катталуу четке кагылды (токен/кайталоо): ${shortId(id)}`);
    return;
  }

  ws.role = 'computer';
  ws.sessionId = id;
  session.computer = ws;
  sendWs(ws, { type: 'computer:registered' });
  log(`[ws] компьютер катталды: ${shortId(id)}`);
}

// Телефон session'ге кошулат ([Туташуу] басылганда).
// QR ушул жерден баштап колдонулган болот, бирок компьютер уруксат бергенче
// signaling иштебейт.
function handlePhoneJoin(ws, msg) {
  if (ws.role) return;

  // Көп ийгиликсиз аракет болсо, убактылуу токтотобуз (ID таап көрүүгө каршы)
  if (limiters.badJoin.isLimited(ws.ip)) {
    sendWs(ws, { type: 'error', code: 'rate_limited' });
    ws.close();
    return;
  }

  const id = msg.sessionId;
  if (!isValidId(id)) {
    limiters.badJoin.hit(ws.ip);
    sendWs(ws, { type: 'error', code: 'session_invalid' });
    return;
  }

  const session = getSession(id);
  if (!session) {
    limiters.badJoin.hit(ws.ip);
    sendWs(ws, { type: 'error', code: getMissingSessionError(id) });
    log(`[ws] телефон кошула албады: session жок же жабылган (${shortId(id)})`);
    return;
  }
  if (session.connected) {
    limiters.badJoin.hit(ws.ip);
    sendWs(ws, { type: 'error', code: 'already_connected' });
    log(`[ws] телефон кошула албады: QR колдонулган (${shortId(id)})`);
    return;
  }
  if (!session.computer || session.computer.readyState !== WebSocket.OPEN) {
    sendWs(ws, { type: 'error', code: 'computer_offline' });
    log(`[ws] телефон кошула албады: компьютер жок (${shortId(id)})`);
    return;
  }

  // Бардык текшерүүлөрдөн өттү: QR колдонулду. Эми компьютердин уруксатын күтөбүз.
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  session.connected = true;
  session.phone = ws;
  session.confirmCode = code;
  ws.role = 'phone';
  ws.sessionId = id;

  sendWs(ws, { type: 'phone:joined', code });
  sendWs(session.computer, { type: 'phone:request', code });
  log(`[ws] телефон кошулууну суранды, уруксат күтүлүүдө: ${shortId(id)}`);

  session.approvalTimer = setTimeout(() => {
    log(`[session] уруксат убагында берилген жок: ${shortId(id)}`);
    closeSession(id, { by: null, reason: 'timeout' });
  }, APPROVAL_TIMEOUT_MS);
}

// Компьютер телефонго уруксат берди же баш тартты
function handleApproval(ws, approve) {
  if (ws.role !== 'computer') return;
  const session = sessions.get(ws.sessionId);
  if (!session || !session.connected || session.approved) return;

  if (!approve) {
    log(`[ws] компьютер баш тартты: ${shortId(ws.sessionId)}`);
    closeSession(ws.sessionId, { by: 'computer', reason: 'rejected' });
    return;
  }

  clearTimeout(session.approvalTimer);
  session.approved = true;
  sendWs(session.phone, { type: 'phone:approved' });
  sendWs(session.computer, { type: 'phone:connected' });
  log(`[ws] компьютер уруксат берди: ${shortId(ws.sessionId)}`);
}

// Signaling маалыматын текшерип, тазаланган көчүрмөсүн кайтарат (же null).
// Компьютер гана offer, телефон гана answer жөнөтө алат.
function sanitizeSignal(role, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  if (data.description !== undefined) {
    const description = data.description;
    if (!description || typeof description !== 'object') return null;
    if (typeof description.sdp !== 'string' || description.sdp.length > MAX_SDP_LENGTH) return null;

    const allowedType = role === 'computer' ? 'offer' : 'answer';
    if (description.type !== allowedType) return null;
    return { description: { type: description.type, sdp: description.sdp } };
  }

  if (data.candidate !== undefined) {
    const candidate = data.candidate;
    if (!candidate || typeof candidate !== 'object') return null;
    if (typeof candidate.candidate !== 'string') return null;
    if (candidate.candidate.length > MAX_CANDIDATE_LENGTH) return null;

    const sdpMid = typeof candidate.sdpMid === 'string' ? candidate.sdpMid.slice(0, 64) : null;
    const sdpMLineIndex = Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : null;
    const usernameFragment =
      typeof candidate.usernameFragment === 'string' ? candidate.usernameFragment.slice(0, 256) : null;

    return {
      candidate: { candidate: candidate.candidate, sdpMid, sdpMLineIndex, usernameFragment },
    };
  }

  return null;
}

// WebRTC signaling билдирүүсүн экинчи түзмөккө өткөрүп берет.
// Сервер мазмунун өзгөртпөйт жана сактабайт.
function handleSignal(ws, msg) {
  // Сессия ID клиенттен эмес, сервер өзү сактаган ws.sessionId'ден алынат.
  // Ошондуктан башка session'го билдирүү жөнөтүү мүмкүн эмес.
  const session = ws.sessionId ? sessions.get(ws.sessionId) : null;
  if (!session || !session.approved) return; // компьютер уруксат бергенче signaling жок

  session.signalCount += 1;
  if (session.signalCount > MAX_SIGNALS_PER_SESSION) {
    log(`[signal] өтө көп билдирүү, session жабылды: ${shortId(ws.sessionId)}`);
    closeSession(ws.sessionId, { by: null, reason: 'closed' });
    return;
  }

  const clean = sanitizeSignal(ws.role, msg.data);
  if (!clean) {
    log(`[signal] туура эмес билдирүү четке кагылды (${ws.role}, ${shortId(ws.sessionId)})`);
    return;
  }

  const target = ws.role === 'computer' ? session.phone : session.computer;
  if (!target) return;

  sendWs(target, { type: 'signal', data: clean });

  const kind = clean.description ? clean.description.type : 'ice-candidate';
  const to = ws.role === 'computer' ? 'телефон' : 'компьютер';
  log(`[signal] ${ws.role} → ${to}: ${kind} (${shortId(ws.sessionId)})`);
}

// Колдонуучу "Байланышты үзүү" басты
function handleDisconnect(ws) {
  if (!ws.sessionId) {
    ws.close();
    return;
  }
  log(`[ws] ${ws.role} байланышты үздү: ${shortId(ws.sessionId)}`);
  closeSession(ws.sessionId, { by: ws.role, reason: 'user' });
}

// Түзмөк күтүүсүздөн ажырап калганда (интернет жок, браузер жабылды ж.б.)
function handleClose(ws) {
  if (!ws.sessionId) return;
  if (!sessions.has(ws.sessionId)) return; // session буга чейин жабылган

  log(`[ws] ${ws.role} ажырады: ${shortId(ws.sessionId)}`);
  closeSession(ws.sessionId, { by: ws.role, reason: 'lost' });
}

wss.on('connection', (ws, req) => {
  ws.ip = getClientIp(req);
  ws.role = null;
  ws.sessionId = null;
  ws.isAlive = true;
  ws.messageWindowStart = Date.now();
  ws.messageCount = 0;

  wsPerIp.set(ws.ip, (wsPerIp.get(ws.ip) || 0) + 1);

  // 10 секундда эч нерсе жарыялабаса, байланышты жабабыз
  const idleTimer = setTimeout(() => {
    if (!ws.role) ws.close();
  }, 10 * 1000);

  // Браузер ping'ге автоматтык түрдө pong менен жооп берет
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw, isBinary) => {
    // Файлдын мазмуну бул серверге келбейт: бинардык билдирүүлөргө жол жок
    if (isBinary) {
      ws.close(1003, 'binary not allowed');
      return;
    }
    if (!allowMessage(ws)) {
      log(`[ws] билдирүүлөр өтө тез келди, ажыратылды (${ws.role || 'белгисиз'})`);
      ws.close(1008, 'rate limit');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (error) {
      sendWs(ws, { type: 'error', code: 'bad_message' });
      return;
    }

    // JSON "null", сан же массив болушу мүмкүн: серверди кулатпоо үчүн текшеребиз
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      sendWs(ws, { type: 'error', code: 'bad_message' });
      return;
    }

    try {
      if (msg.type === 'computer:register') handleComputerRegister(ws, msg);
      else if (msg.type === 'phone:join') handlePhoneJoin(ws, msg);
      else if (msg.type === 'approve') handleApproval(ws, true);
      else if (msg.type === 'reject') handleApproval(ws, false);
      else if (msg.type === 'signal') handleSignal(ws, msg);
      else if (msg.type === 'disconnect') handleDisconnect(ws);
    } catch (error) {
      log('[ws] билдирүүнү иштетүүдө ката:', error.message);
      ws.close(1011, 'server error');
    }
  });

  ws.on('close', () => {
    clearTimeout(idleTimer);
    const count = (wsPerIp.get(ws.ip) || 1) - 1;
    if (count <= 0) wsPerIp.delete(ws.ip);
    else wsPerIp.set(ws.ip, count);
    handleClose(ws);
  });

  ws.on('error', () => {
    // Ката болсо close окуясы баары бир чакырылат
  });
});

// Heartbeat: жооп бербеген (өчүп калган) түзмөктөрдү ажыратабыз
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      log(`[ws] ${ws.role || 'белгисиз'} жооп бербейт, ажыратылды`);
      ws.terminate(); // 'close' окуясы чакырылып, session жабылат
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS).unref();

/* ===================== СТАТИКАЛЫК ФАЙЛДАР ===================== */

// Браузер сураган URL'ди файлдын жолуна которот. Уруксат берилбесе null кайтарат.
function resolveFilePath(urlPath) {
  if (urlPath.includes('\0')) return null;

  // QR китепкана client/vendor/ ичинде турат (тышкы CDN колдонулбайт)
  let cleanPath = urlPath;
  if (urlPath === '/') cleanPath = '/index.html';
  // /join/КОД -> join.html (телефон үчүн бет)
  if (/^\/join\/[\w-]{1,64}$/.test(urlPath)) cleanPath = '/join.html';

  const filePath = path.normalize(path.join(CLIENT_DIR, cleanPath));

  // Коопсуздук: client папкасынан сыртка чыгууга жол бербейбиз.
  // CLIENT_ROOT аягында бөлүүчү бар, ошондуктан "client-evil" сыяктуу папкалар өтпөйт.
  if (!filePath.startsWith(CLIENT_ROOT)) return null;
  return filePath;
}

// Файлды окуп, жоопко жөнөтөт
function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Бет табылган жок (404)');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

/* ===================== SERVER ===================== */

const server = http.createServer((req, res) => {
  try {
    setSecurityHeaders(req, res);

    const urlPath = req.url.split('?')[0];

    // Хостинг платформасынын health check'и ички дарек менен келиши мүмкүн,
    // ошондуктан Host текшерүүдөн мурун жооп беребиз
    if (urlPath === '/healthz') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    // Белгисиз Host (DNS rebinding) кабыл алынбайт
    if (!isAllowedHost(req.headers.host)) {
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Бул хост уруксат берилген эмес');
      return;
    }

    if (urlPath.startsWith('/api/')) {
      handleApi(req, res, urlPath);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Метод уруксат берилген эмес');
      return;
    }

    // "API гана" режими: frontend Netlify'де, бул жерде client файлдары жок
    if (!SERVE_CLIENT) {
      const isRoot = urlPath === '/';
      res.writeHead(isRoot ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(isRoot ? 'QuickDrop signaling server' : 'Табылган жок (404)');
      return;
    }

    const filePath = resolveFilePath(urlPath);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Тыюу салынган (403)');
      return;
    }

    serveFile(filePath, res);
  } catch (error) {
    log('[http] ката:', error.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Сервер катасы');
  }
});

// Тымып калган же жай суроолор серверди кармап калбасын
server.headersTimeout = 10 * 1000;
server.requestTimeout = 15 * 1000;

function rejectUpgrade(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

// Браузер /ws дарегине WebSocket ачууну суранганда ушул жерге келет
server.on('upgrade', (req, socket, head) => {
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath !== '/ws') {
    socket.destroy();
    return;
  }

  // Белгисиз сайттан WebSocket ачууга (CSWSH) жана белгисиз хостко жол бербейбиз
  if (!isAllowedHost(req.headers.host) || !isAllowedOrigin(req)) {
    log('[ws] Origin/Host текшерүүдөн өткөн жок, четке кагылды');
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }

  const ip = getClientIp(req);
  if (wss.clients.size >= MAX_WS_CLIENTS) {
    rejectUpgrade(socket, 503, 'Service Unavailable');
    return;
  }
  if ((wsPerIp.get(ip) || 0) >= MAX_WS_PER_IP || !limiters.wsConnect.hit(ip)) {
    log('[ws] өтө көп туташуу, четке кагылды');
    rejectUpgrade(socket, 429, 'Too Many Requests');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  if (IS_PRODUCTION) {
    // Production'до "localhost" шилтемеси логго чыкпайт (ал жерде эч ким ача албайт)
    log(`QuickDrop ${SERVE_CLIENT ? 'сервери' : 'signaling сервери (API гана)'} иштеп жатат, порт ${PORT}`);
  } else {
    log(`QuickDrop иштеп жатат: http://localhost:${PORT}`);
  }
  if (PUBLIC_URL) log(`Public URL: ${PUBLIC_URL}`);
  if (ALLOWED_HOSTS.size > 0) log(`Уруксат берилген хосттор: ${[...ALLOWED_HOSTS].join(', ')}`);
  if (ALLOWED_ORIGINS.size > 0) log(`Уруксат берилген origin'дер: ${[...ALLOWED_ORIGINS].join(', ')}`);
});