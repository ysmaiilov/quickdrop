# QuickDrop

Телефон менен компьютердин ортосунда маалыматты түз өткөрүү үчүн веб-долбоор.
QR-код аркылуу түзмөктөр туташат, WhatsApp же Telegram керек эмес.

## Технологиялар

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js + `ws` (WebSocket signaling)
- Өткөрүү: WebRTC DataChannel (текст, сүрөт, файл серверге тийбей түз өтөт)

## Түзүм

- `client/` : браузерде көрүнгөн бөлүк (`config.js` — сервер даректери, `vendor/` — QR китепканасы)
- `server/` : Node.js signaling сервери (сессиялар RAM'да)
- `scripts/build.js` : `client/` → `dist/` (Netlify үчүн), `config.js` жана `_headers` түзөт
- `scripts/preview.js` : `dist/` ну `http://127.0.0.1:8888` дарегинде текшерүү
- `netlify.toml` : Netlify build жөндөөлөрү

## Локалдык иштетүү

```bash
cd server
npm install
cd ..
npm start          # же: node server/server.js
```

Андан кийин браузерде `http://localhost:3000` ачыңыз.
Бул **локалдык гана** дарек: QR-коддо компьютердин LAN IP'си (мис. `http://192.168.1.5:3000`)
колдонулат, телефон ошол эле Wi-Fi тармагында болушу керек.
Production'до `localhost` колдонулбайт — төмөнкү бөлүмдү караңыз.

## Production: Netlify + өзүнчө signaling сервер

Netlify Functions WebSocket серверин иштете албайт. Ошондуктан:

```
Телефон / Компьютер ──HTTPS──► Netlify (dist/: HTML, CSS, JS)
                    ──HTTPS/WSS──► Signaling сервер (Render/Railway/Fly/VPS, API гана)
                    ◄──WebRTC DataChannel (түз)──►
```

### 1. Signaling сервер (backend)

Үзгүлтүксүз иштеген хостко (Render, Railway, Fly.io, VPS) **бир гана инстанс** коюңуз
(сессиялар RAM'да, бир нече инстанс болсо телефон менен компьютер башка-башка инстанска түшүп калат).
HTTPS/WSS хосттун proxy'си аркылуу берилиши керек.

- Build: `npm ci --prefix server`
- Start: `npm start` (же Root directory = `server`, start: `npm start`)
- Health check: `GET /healthz` → `200 {"status":"ok"}`

| Өзгөрмө | Мисал | Мааниси |
|---|---|---|
| `NODE_ENV` | `production` | LAN IP алмаштыруу өчөт, логдо `localhost` чыкпайт |
| `SERVE_CLIENT` | `0` | client файлдарын бербейт, `/` → `QuickDrop signaling server` |
| `PUBLIC_URL` | `https://quickdrop.netlify.app` | Netlify дареги: QR шилтемеси ушундан түзүлөт, origin автоматтык уруксат алат |
| `ALLOWED_HOSTS` | `quickdrop-api.onrender.com` | ушул сервердин домени (Host header, үтүр менен; стандарттуу эмес порт болсо `host:port`) |
| `TRUST_PROXY` | `1` | proxy артында `X-Forwarded-For` / `X-Forwarded-Proto` колдонулат; `NODE_ENV=production` менен бирге HTTP суроолору HTTPS'ке (308) багытталат, `ws://` кабыл алынбайт (`wss://` гана) |
| `ALLOWED_ORIGINS` | `https://quickdrop.example.com` | кошумча frontend origin'дер (керек болсо, үтүр менен) |
| `PORT` | хост өзү коёт | |

`SERVE_CLIENT=0` болгондо `PUBLIC_URL` же `ALLOWED_HOSTS` жок болсо сервер баштабайт.
`TRUST_PROXY` жок же `PUBLIC_URL` https эмес болсо эскертүү чыгат.

### 2. Netlify (frontend)

Репозиторийди туташтырыңыз — `netlify.toml` бардыгын коёт (`node scripts/build.js`, publish `dist`,
`/join/*` → `/join.html`). Site settings → Environment variables:

| Өзгөрмө | Мисал |
|---|---|
| `QUICKDROP_API_URL` | `https://quickdrop-api.onrender.com` (милдеттүү, https, localhost эмес) |
| `QUICKDROP_ICE_SERVERS` | `[{"urls":"stun:stun.l.google.com:19302"}]` (ыктыярдуу) |

Netlify'де `QUICKDROP_API_URL` жок, `http://` же localhost болсо build ката менен токтойт.
Build `dist/_headers` түзөт: CSP (`connect-src` ичинде API жана WSS дареги), `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` ж.б.

### TURN жөнүндө эскертме

Демейки боюнча STUN гана колдонулат. Мобилдик тармактарда (CGNAT) жана катуу корпоративдик
firewall артында STUN жетишсиз болушу мүмкүн — WebRTC туташпай калат. Анда TURN сервери керек.
TURN кошсоңуз, ачкычтарды (`username`/`credential`) `QUICKDROP_ICE_SERVERS` аркылуу статикага
**салбаңыз** (бардыгына ачык көрүнөт): аларды backend'ден кыска мөөнөттүү (мис. TURN REST API,
HMAC менен) берүү керек.

## Production'ду локалдык текшерүү

macOS / Linux:

```bash
# 1-терминал: backend (API гана)
NODE_ENV=production SERVE_CLIENT=0 PORT=3000 \
PUBLIC_URL=http://127.0.0.1:8888 \
ALLOWED_HOSTS=127.0.0.1:3000,localhost:3000 \
ALLOWED_ORIGINS=http://127.0.0.1:8888 \
node server/server.js

# 2-терминал: frontend
QUICKDROP_API_URL=http://127.0.0.1:3000 node scripts/build.js && node scripts/preview.js
```

Windows PowerShell:

```powershell
# 1-терминал
$env:NODE_ENV="production"; $env:SERVE_CLIENT="0"; $env:PORT="3000"
$env:PUBLIC_URL="http://127.0.0.1:8888"
$env:ALLOWED_HOSTS="127.0.0.1:3000,localhost:3000"
$env:ALLOWED_ORIGINS="http://127.0.0.1:8888"
node server/server.js

# 2-терминал
$env:QUICKDROP_API_URL="http://127.0.0.1:3000"; node scripts/build.js; node scripts/preview.js
```

Андан кийин `http://127.0.0.1:8888` ачыңыз.
