// QuickDrop: signaling серверинин даректери (config.js'ке негизделет).
// apiBase/wsBase бош болсо, сервер ушул беттин өзү (локалдык режим).

// '/api/sessions' -> 'https://api.example.com/api/sessions' (же ошол эле origin)
function apiUrl(path) {
  const config = window.QUICKDROP_CONFIG || {};
  const base = (config.apiBase || '').replace(/\/+$/, '');
  return base + path;
}

// WebSocket дареги: wsBase + '/ws', болбосо беттин дарегинен (https -> wss, http -> ws)
function websocketUrl() {
  const config = window.QUICKDROP_CONFIG || {};
  if (config.wsBase) return config.wsBase.replace(/\/+$/, '') + '/ws';

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}/ws`;
}
