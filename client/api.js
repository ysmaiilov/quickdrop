// QuickDrop: signaling серверинин даректери (config.js'ке негизделет).
// apiBase/wsBase бош болсо, сервер ушул беттин өзү (локалдык режим).

// '/api/sessions' -> 'https://api.example.com/api/sessions' (же ошол эле origin)
function apiUrl(path) {
  const config = window.QUICKDROP_CONFIG || {};
  const base = (config.apiBase || '').replace(/\/+$/, '');
  return base + path;
}

// ICE серверлери (STUN/TURN). Сервер TURN ачкычтарын /api/ice аркылуу берет.
// Бет ачылганда алдын ала алынат, туташуу башталганда даяр болот.
let loadedIceServers = null;

function prefetchIceServers() {
  const config = window.QUICKDROP_CONFIG || {};
  if (config.iceServers) return; // build'де кол менен коюлган: аны колдонобуз
  fetch(apiUrl('/api/ice'))
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        loadedIceServers = data.iceServers;
      }
    })
    .catch(() => {
      // Ката болсо, демейки STUN иштейт
    });
}

function getLoadedIceServers() {
  return loadedIceServers;
}

prefetchIceServers();

// WebSocket дареги: wsBase + '/ws', болбосо беттин дарегинен (https -> wss, http -> ws)
function websocketUrl() {
  const config = window.QUICKDROP_CONFIG || {};
  if (config.wsBase) return config.wsBase.replace(/\/+$/, '') + '/ws';

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}
