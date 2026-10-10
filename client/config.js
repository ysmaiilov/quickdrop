// QuickDrop: frontend конфигурациясы.
// Локалдык режимде (node server/server.js) бардык маанилер бош: API жана WebSocket
// ушул эле сервер (location) аркылуу иштейт.
// Production'до бул файлды scripts/build.js QUICKDROP_API_URL боюнча dist/config.js кылып кайра жазат,
// мисалы: { apiBase: 'https://quickdrop-api.onrender.com', wsBase: 'wss://quickdrop-api.onrender.com' }.
//   iceServers: null болсо peer.js'теги демейки STUN колдонулат.
window.QUICKDROP_CONFIG = {
  apiBase: '',
  wsBase: '',
  iceServers: null,
};
