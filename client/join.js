// QuickDrop: телефондун бети (8-этап).
// 1) Session жарактуубу деп гана сурайт (туташпайт).
// 2) [Туташуу] басылганда гана WebSocket ачып, session'ге кошулат.
// 3) Компьютерден offer келгенде WebRTC answer берет.
// 4) Туташкандан кийин текст, сүрөт, файл жөнөтө алат жана байланышты үзө алат.

const iconElement = document.getElementById('icon');
const titleElement = document.getElementById('title');
const infoElement = document.getElementById('info');
const messageElement = document.getElementById('message');
const connectButton = document.getElementById('connectBtn');
const disconnectButton = document.getElementById('disconnectBtn');

// URL: /join/КОД -> КОД
const sessionId = window.location.pathname.split('/')[2];

// Байланыш абалынын көрсөткүчү (status.js), өткөрүү окуяларына байланган
const statusBadge = createStatusBadge();
bindTransferStatus(statusBadge);

let socket = null;
let peer = null; // WebRTC байланышы
let joined = false; // телефон session'ге кошулдубу
let ended = false; // байланыш аяктадыбы (ката же үзүү)

// Жөнөтүү модулдары
const textSender = createTextSender({ getPeer: () => peer });
const imageSender = createImageSender({ getPeer: () => peer });
const fileScreen = createFileScreen({ getPeer: () => peer });

// 💻 Компьютер → 📱 Телефон: компьютерден келген маалыматты алуу (received.js)
const inbox = createReceiver({
  send: (message) => (peer ? peer.send(message) : false),
  maxFileBytes: MAX_MOBILE_FILE_BYTES, // телефондун эс тутуму үчүн азыраак чек
  ids: {
    section: 'inbox',
    status: 'inboxStatus',
    list: 'inboxList',
    progress: 'inboxProgress',
    progressName: 'inboxProgressName',
    progressBar: 'inboxProgressBar',
    progressLabel: 'inboxProgressLabel',
  },
});
const directionLabel = document.getElementById('directionLabel');

function appLog(...args) {
  console.log('[QuickDrop]', ...args);
}

// Ката түрлөрү. state: абал көрсөткүчүнүн абалы ('failed' же 'disconnected')
const ERRORS = {
  session_invalid: {
    state: 'failed',
    icon: '⚠️',
    title: 'QR-коддун мөөнөтү бүттү',
    message: 'Компьютерде "Жаңы QR-код" кнопкасын басып, кайра сканерлеңиз.',
  },
  session_closed: {
    state: 'failed',
    icon: '⚠️',
    title: 'Бул QR-код жараксыз',
    message: 'Бул session жабылган. Эски QR-кодду кайра колдонууга болбойт, компьютерден жаңы QR-код түзүңүз.',
  },
  already_connected: {
    state: 'failed',
    icon: '⚠️',
    title: 'Бул QR-код колдонулган',
    message: 'Ар бир QR-код бир гана жолу иштейт. Компьютерден жаңы QR-код түзүңүз.',
  },
  computer_offline: {
    state: 'failed',
    icon: '⚠️',
    title: 'Компьютер табылган жок',
    message: 'Компьютерде QuickDrop ачык экенин текшерип, жаңы QR-код түзүңүз.',
  },
  peer_left: {
    state: 'disconnected',
    icon: '🔌',
    title: 'Байланыш үзүлдү',
    message: 'Компьютер байланышты үздү. Кайра туташуу үчүн компьютерден жаңы QR-код түзүп, сканерлеңиз.',
  },
  lost: {
    state: 'disconnected',
    icon: '🔌',
    title: 'Байланыш үзүлдү',
    message: 'Компьютер менен байланыш үзүлдү. Кайра туташуу үчүн компьютерден жаңы QR-код түзүңүз.',
  },
  self_disconnected: {
    state: 'disconnected',
    icon: '🔌',
    title: 'Байланыш үзүлдү',
    message: 'Сиз байланышты үздүңүз. Кайра туташуу үчүн компьютерден жаңы QR-код сканерлеңиз.',
  },
  peer_failed: {
    state: 'failed',
    icon: '⚠️',
    title: 'Байланыш түзүлгөн жок',
    message: 'Эки түзмөк бир Wi-Fi тармагында экенин текшерип, жаңы QR-код менен кайра аракет кылыңыз.',
  },
    rejected: {
    state: 'disconnected',
    icon: '🚫',
    title: 'Туташуу четке кагылды',
    message: 'Компьютер туташууга уруксат берген жок. Кайра аракет кылуу үчүн компьютерден жаңы QR-код түзүңүз.',
  },
  approval_timeout: {
    state: 'failed',
    icon: '⏱️',
    title: 'Уруксат берилген жок',
    message: 'Компьютер убагында жооп берген жок. Компьютерден жаңы QR-код түзүп, кайра аракет кылыңыз.',
  },
  rate_limited: {
    state: 'failed',
    icon: '⚠️',
    title: 'Өтө көп аракет',
    message: 'Бир аз күтүп, кайра аракет кылыңыз.',
  },
  network: {
    state: 'failed',
    icon: '⚠️',
    title: 'Серверге туташуу мүмкүн болгон жок',
    message: 'Телефон жана компьютер бир Wi-Fi тармагында экенин текшериңиз.',
  },
};

/* ===================== ЭКРАНДЫ ЧИЙҮҮ ===================== */

// Экрандын абалын бир жерден өзгөртөбүз
function render({ icon, title, info = '', message = '', type = 'error', showButton = false, isCode = false }) {
  // Жаңы абалда кошумча экрандар жабылат (жөнөтүү жүрүп жатса, токтойт)
  textSender.hide();
  imageSender.hide();
  fileScreen.hide();
    inbox.reset();
  directionLabel.hidden = true;
  disconnectButton.hidden = true;

  iconElement.textContent = icon;
    iconElement.classList.toggle('status-icon--code', isCode); // тастыктоо коду чоң көрүнөт
  titleElement.textContent = title;
  infoElement.textContent = info;

  messageElement.textContent = message;
  messageElement.hidden = !message;
  messageElement.className = `message message--${type}`;

  connectButton.hidden = !showButton;
  connectButton.disabled = false;
}

// Ката экранын жана тиешелүү абалды көрсөтөт
function showError(error) {
  render({ icon: error.icon, title: error.title, message: error.message });
  statusBadge.set(error.state, error.state === 'failed' ? error.title : '');
}

/* ===================== 1) SESSION'ДУ ТЕКШЕРҮҮ ===================== */

async function checkSession() {
  statusBadge.set('waiting', 'Текшерилүүдө...');
  render({ icon: '⏳', title: 'Компьютерге туташуу', info: 'Текшерилүүдө...' });

  try {
    const response = await fetch(apiUrl(`/api/sessions/${sessionId}`));

    if (response.ok) {
      showReady();
    } else if (response.status === 409) {
      showError(ERRORS.already_connected);
    } else if (response.status === 410) {
      showError(ERRORS.session_closed);
    } else {
      showError(ERRORS.session_invalid);
    }
  } catch (error) {
    showError(ERRORS.network);
  }
}

// Session жарактуу: колдонуучудан уруксат сурайбыз
function showReady() {
  render({
    icon: '🖥️',
    title: 'Компьютерге туташуу',
    info: 'Бул компьютерге туташкыңыз келеби?',
    showButton: true,
  });
  connectButton.textContent = 'Туташуу';
  statusBadge.set('waiting', 'Туташуу үчүн кнопканы басыңыз');
}

/* ===================== 2) ТУТАШУУ ===================== */

// [Туташуу] басылганда гана WebSocket ачылат
function connect() {
  if (socket) return; // эки жолу басылып кетпесин

  connectButton.disabled = true;
  connectButton.textContent = 'Туташылууда...';
  infoElement.textContent = 'Компьютер менен байланыш түзүлүүдө...';
  statusBadge.set('connecting', 'Компьютерге кошулуп жатабыз...');

  socket = new WebSocket(websocketUrl());

  socket.addEventListener('open', () => {
    appLog('WebSocket ачылды, session\'ге кошулабыз');
    sendToServer({ type: 'phone:join', sessionId });
  });

  socket.addEventListener('message', (event) => {
    handleMessage(JSON.parse(event.data));
  });

  socket.addEventListener('close', () => {
    appLog('WebSocket жабылды');
    closePeer();
    if (ended) return;

    // Күтүүсүз жабылды
    const wasJoined = joined;
    ended = true;
    joined = false;
    showError(wasJoined ? ERRORS.lost : ERRORS.network);
  });
}

// Серверге JSON билдирүү жөнөтөт
function sendToServer(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// Серверден келген билдирүүлөр
function handleMessage(message) {
  switch (message.type) {
        case 'phone:joined': {
      joined = true;
      appLog('Туташуу суралды, компьютердин уруксатын күтөбүз');
      // Код компьютердин экранында да көрүнөт: экөө бирдей болушу керек
      const code = /^\d{4}$/.test(String(message.code)) ? String(message.code) : '----';
           render({
        icon: code,
        isCode: true,
        title: 'Компьютердин уруксатын күтүүдө...',
        info: 'Компьютердин экранында ушул эле код чыкканын текшериңиз. Компьютерде "Уруксат берүү" басылышын күтүңүз.',
      });
      statusBadge.set('connecting', 'Компьютер уруксат бериши күтүлүүдө');
      break;
    }

    case 'phone:approved':
      appLog('Компьютер уруксат берди, WebRTC башталат');
      render({ icon: '⏳', title: 'Байланыш түзүлүүдө...', info: 'Бир аз күтө туруңуз.' });
      statusBadge.set('connecting', 'Түз байланыш түзүлүүдө...');
      startPeer();
      break;

    case 'signal':
      if (peer) peer.handleSignal(message.data);
      break;

        case 'peer:disconnected':
      if (message.reason === 'user') finishWithError(ERRORS.peer_left);
      else if (message.reason === 'rejected') finishWithError(ERRORS.rejected);
      else if (message.reason === 'timeout') finishWithError(ERRORS.approval_timeout);
      else finishWithError(ERRORS.lost);
      break;

    case 'error':
      finishWithError(ERRORS[message.code] || ERRORS.network);
      break;

    default:
      break;
  }
}

/* ===================== 3) WEBRTC ===================== */

// Телефон WebRTC байланышын даярдайт (offer келгенде answer берет)
function startPeer() {
  peer = createPeer({
    isInitiator: false,
    sendSignal: (data) => sendToServer({ type: 'signal', data }),
    onMessage: (message) => {
      textSender.handleMessage(message); // телефондун жөнөткөндөрүнүн "алдым" жооптору
      imageSender.handleMessage(message);
      fileScreen.handleMessage(message);
      inbox.handleMessage(message); // компьютерден келген текст жана файл
    },
    onBinary: (data) => inbox.handleBinary(data), // файлдын бөлүктөрү
    onConnected: showConnected,
    onFailed: () => finishWithError(ERRORS.peer_failed),
    onClosed: () => finishWithError(ERRORS.lost),
  });
}

// WebRTC байланышы даяр
function showConnected() {
  if (ended) return;
  appLog('WebRTC туташты ✓');

  render({
    icon: '✅',
        title: '✓ Компьютер туташты',
    info: 'Компьютер менен түз байланыш түзүлдү. Эми маалымат жөнөтсөңүз болот.',
  });
  statusBadge.set('connected', 'Компьютер менен түз байланыш даяр');

  textSender.show();
  imageSender.show();
  fileScreen.show();
    directionLabel.hidden = false;
  inbox.show();
  disconnectButton.hidden = false;
}

/* ===================== БАЙЛАНЫШТЫ АЯКТОО ===================== */

function closePeer() {
  if (peer) {
    peer.close();
    peer = null;
  }
}

// WebRTC жана WebSocket'ти жабат
function closeAll() {
  closePeer();
  if (socket) {
    const currentSocket = socket;
    socket = null;
    currentSocket.close();
  }
}

// Байланышты аяктап, ката экранын көрсөтөт (бир гана жолу иштейт)
function finishWithError(error) {
  if (ended) return;
  ended = true;
  joined = false;

  closeAll();
  showError(error);
}

// "Байланышты үзүү" кнопкасы
function disconnect() {
  if (ended || !joined) return;
  appLog('Колдонуучу байланышты үздү');

  // Алгач компьютерге билдиребиз, анан баарын жабабыз
  sendToServer({ type: 'disconnect' });
  finishWithError(ERRORS.self_disconnected);
}

connectButton.addEventListener('click', connect);
disconnectButton.addEventListener('click', disconnect);
checkSession();