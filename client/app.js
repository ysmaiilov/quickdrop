// QuickDrop: компьютердин негизги файлы (9-этап: коопсуздук).
// Бул этапта:
//   - computerToken: session'ду башкаруу (катталуу, жабуу) ушул компьютерде гана
//   - телефон туташууну сураганда компьютер тастыктоо коду менен уруксат берет
//   - экранды куруу textContent/DOM аркылуу (innerHTML колдонулбайт)

const titleElement = document.getElementById('title');
const infoElement = document.getElementById('info');
const qrElement = document.getElementById('qr');
const timerElement = document.getElementById('timer');
const messageElement = document.getElementById('message');
const newQrButton = document.getElementById('newQrBtn');
const disconnectButton = document.getElementById('disconnectBtn');
const approvalActions = document.getElementById('approvalActions');
const approveButton = document.getElementById('approveBtn');
const rejectButton = document.getElementById('rejectBtn');

// Баштапкы тексттер (туташкандан кийин кайра ушуларга кайтабыз)
const DEFAULT_TITLE = '📱 Телефонду туташтырыңыз';
const DEFAULT_INFO = 'QR-код 2 мүнөт жарактуу';

const APPROVAL_SECONDS = 30; // уруксат берүүгө канча убакыт бар (серверде да ушундай)

// Байланыш абалынын көрсөткүчү (status.js), өткөрүү окуяларына байланган
const statusBadge = createStatusBadge();
bindTransferStatus(statusBadge);

// Учурдагы абал.
// phase: 'loading' (QR түзүлүүдө), 'waiting' (телефон күтүлүүдө),
//        'approving' (телефон уруксат сурап жатат), 'connecting' (WebRTC түзүлүүдө),
//        'connected', 'ended' (аяктады)
const state = {
  phase: 'loading',
  sessionId: null,
  token: null, // computerToken: QR-кодго салынбайт, ушул компьютерде гана
  deadline: 0, // таймер бүтө турган убакыт (браузердин саатына жараша)
  timerId: null,
  socket: null,
  peer: null, // WebRTC байланышы
};

// Телефондон келген маалыматты көрсөтүү модулу (received.js)
const receiver = createReceiver({
  send: (message) => (state.peer ? state.peer.send(message) : false),
});

// Компьютерден телефонго жөнөтүү панели (send-panel.js)
const sendPanel = createSendPanel({ getPeer: () => state.peer });

function appLog(...args) {
  console.log('[QuickDrop]', ...args);
}

// Фазаны өзгөртүп, кнопкаларды ошого жараша көрсөтөт
function setPhase(phase) {
  state.phase = phase;
  const inConnection = phase === 'connecting' || phase === 'connected';
  const approving = phase === 'approving';

  disconnectButton.hidden = !inConnection;
  approvalActions.hidden = !approving;
  newQrButton.hidden = inConnection || approving;
  newQrButton.disabled = phase === 'loading';
}

/* ===================== СЕРВЕР МЕНЕН БАЙЛАНЫШ ===================== */

// Серверден жаңы session сурайт
async function requestSession() {
  const response = await fetch(apiUrl('/api/sessions'), { method: 'POST' });
  if (response.status === 429) throw new Error('rate_limited');
  if (!response.ok) throw new Error('Session түзүлгөн жок');
  return response.json();
}

// Эски session'ду серверде жабат. Токен керек: QR-кодду көргөн адам жаба албайт.
async function cancelSession(sessionId, token) {
  if (!sessionId || !token) return;
  try {
    await fetch(apiUrl(`/api/sessions/${sessionId}`), {
      method: 'DELETE',
      headers: { 'X-Session-Token': token },
    });
  } catch (error) {
    // Маанилүү эмес: session баары бир 2 мүнөттөн кийин бүтөт
  }
}

/* ===================== WEBSOCKET ===================== */

// WebSocket ачып, компьютерди session'ге каттайт (токен менен)
function openSocket(sessionId, token) {
  const socket = new WebSocket(websocketUrl());
  state.socket = socket;

  socket.addEventListener('open', () => {
    appLog('WebSocket ачылды, session\'ге катталуудабыз');
    socket.send(JSON.stringify({ type: 'computer:register', sessionId, token }));
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (message && typeof message === 'object') handleSocketMessage(message);
  });

  socket.addEventListener('close', () => {
    // Өзүбүз жапкан болсо (state.socket башка), эч нерсе кылбайбыз
    if (state.socket !== socket) return;
    state.socket = null;
    appLog('WebSocket күтүүсүз жабылды');
    handleConnectionLost();
  });
}

// Серверге JSON билдирүү жөнөтөт
function sendToServer(message) {
  const socket = state.socket;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// WebSocket'ти жана WebRTC байланышын атайылап жабат
function closeConnections() {
  if (state.peer) {
    state.peer.close();
    state.peer = null;
  }
  const socket = state.socket;
  state.socket = null;
  if (socket) socket.close();
}

// Серверден келген билдирүүлөр
function handleSocketMessage(message) {
  switch (message.type) {
    case 'phone:request':
      handlePhoneRequest(message);
      break;
    case 'phone:connected':
      handlePhoneConnected();
      break;
    case 'signal':
      if (state.peer) state.peer.handleSignal(message.data);
      break;
    case 'peer:disconnected':
      handlePeerDisconnected(message);
      break;
    case 'error':
      handleServerError(message.code);
      break;
    default:
      break;
  }
}

function handleServerError(code) {
  if (code === 'session_closed') {
    endSession({
      badgeState: 'failed',
      badgeDetail: 'Session жабылган',
      message: 'Бул session жабылган. Жаңы QR-код түзүңүз.',
      cancelOnServer: false,
    });
  } else if (code === 'rate_limited') {
    endSession({
      badgeState: 'failed',
      badgeDetail: 'Өтө көп аракет',
      message: 'Өтө көп аракет болду. Бир аз күтүп, кайра аракет кылыңыз.',
      cancelOnServer: false,
    });
  } else if (code === 'session_invalid') {
    handleExpired();
  }
}

/* ===================== WEBRTC ===================== */

// Компьютер уруксат бергенден кийин WebRTC байланышын баштайбыз
function startPeer() {
  state.peer = createPeer({
    isInitiator: true,
    sendSignal: (data) => sendToServer({ type: 'signal', data }),
    onMessage: (message) => {
      receiver.handleMessage(message); // телефондон келген маалымат
      sendPanel.handleMessage(message); // телефондун "алдым" жооптору
    },
    onBinary: (data) => receiver.handleBinary(data),
    onConnected: handlePeerConnected,
    onFailed: () => {
      endSession({
        badgeState: 'failed',
        badgeDetail: 'Байланыш түзүлгөн жок',
        message: 'Байланыш түзүлгөн жок. Эки түзмөк бир Wi-Fi тармагында экенин текшерип, жаңы QR-код менен кайра аракет кылыңыз.',
      });
    },
    onClosed: () => {
      endSession({
        badgeState: 'disconnected',
        message: 'Байланыш үзүлдү. Кайра туташуу үчүн жаңы QR-код түзүңүз.',
      });
    },
  });
  state.peer.start();
}

/* ===================== QR ЖАНА ЭКРАН ===================== */

// QR ордундагы чоң символду (текст) коопсуз түрдө жасайт
function makeQrSymbol(className, text) {
  const symbol = document.createElement('span');
  symbol.className = className;
  symbol.textContent = text;
  return symbol;
}

// QR-кодду чиймелейт
function renderQr(url) {
  qrElement.replaceChildren();
  qrElement.className = 'qr qr--active';
  new QRCode(qrElement, {
    text: url,
    width: 200,
    height: 200,
    correctLevel: QRCode.CorrectLevel.M,
  });
}

// QR'ды алып салып, баштапкы placeholder'ге кайтарат
function resetQr(expired) {
  qrElement.className = expired ? 'qr qr--expired' : 'qr';
  qrElement.replaceChildren(makeQrSymbol('qr__label', 'QR'));
}

// QR ордуна чоң белги көрсөтөт (⏳, 🔐 же ✓)
function showQrStatus(icon, title, info) {
  qrElement.className = 'qr qr--connected';
  qrElement.replaceChildren(makeQrSymbol('qr__check', icon));
  titleElement.textContent = title;
  infoElement.textContent = info;
}

// Тексттерди баштапкы абалга кайтарат жана келген маалыматты тазалайт
function resetTexts() {
  titleElement.textContent = DEFAULT_TITLE;
  infoElement.textContent = DEFAULT_INFO;
  receiver.reset();
    sendPanel.hide();
}

/* ===================== БИЛДИРҮҮ ЖАНА ТАЙМЕР ===================== */

function showMessage(text) {
  messageElement.textContent = text;
  messageElement.hidden = false;
}

function hideMessage() {
  messageElement.hidden = true;
  messageElement.textContent = '';
}

// 95 секунд -> "1:35"
function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function stopCountdown() {
  clearInterval(state.timerId);
  state.timerId = null;
  timerElement.textContent = '';
}

// Ар секунд сайын калган убакытты жаңыртат.
// onExpire: убакыт бүткөндө чакырылат (null болсо, жөн гана токтойт)
function startCountdown(durationMs, { label = 'Калган убакыт', onExpire = handleExpired } = {}) {
  stopCountdown();
  state.deadline = Date.now() + durationMs;

  const tick = () => {
    const remaining = state.deadline - Date.now();
    if (remaining <= 0) {
      stopCountdown();
      if (onExpire) onExpire();
      return;
    }
    timerElement.textContent = `${label}: ${formatTime(remaining)}`;
  };

  tick();
  state.timerId = setInterval(tick, 1000);
}

/* ===================== СЕССИЯНЫ АЯКТОО ===================== */

// Session'ду аяктап, баштапкы көрүнүшкө кайтат. Баарын бир жерден тазалайт:
// таймер, WebRTC, WebSocket, серверде session, токен жана келген маалымат.
//   badgeState/badgeDetail: абал көрсөткүчү, message: колдонуучуга билдирүү
//   cancelOnServer: серверге session'ду жабууну айтабызбы
//   expired: QR мөөнөтү бүткөнбү (QR өчүңкү көрүнөт)
function endSession({ badgeState, badgeDetail = '', message, cancelOnServer = true, expired = false }) {
  if (!state.sessionId) return; // буга чейин аяктаган

  const oldSessionId = state.sessionId;
  const oldToken = state.token;
  state.sessionId = null;
  state.token = null;

  // Файл алынып жаткан болсо, жарым-жартылай маалымат колдонулбайт (receiver.reset ташташат)
  const partialReceive = receiver.isReceiving();

  stopCountdown();
  closeConnections();
  if (cancelOnServer) cancelSession(oldSessionId, oldToken);

  resetTexts();
  resetQr(expired);
  setPhase('ended');
  statusBadge.set(badgeState, badgeDetail);

  const extra = partialReceive ? ' Жарым-жартылай алынган файл сакталган жок.' : '';
  showMessage(`${message}${extra}`);
  appLog('Session аяктады:', message);
}

// QR-коддун мөөнөтү бүттү
function handleExpired() {
  if (state.phase !== 'waiting') return;
  endSession({
    badgeState: 'failed',
    badgeDetail: 'QR-коддун мөөнөтү бүттү',
    message: 'QR-коддун мөөнөтү бүттү. Жаңы QR-код түзүү үчүн төмөнкү кнопканы басыңыз.',
    expired: true,
  });
}

// Серверге байланыш күтүүсүз үзүлдү
function handleConnectionLost() {
  endSession({
    badgeState: 'disconnected',
    message: 'Серверге байланыш үзүлдү. Жаңы QR-код түзүп көрүңүз.',
    cancelOnServer: false,
  });
}

// Телефон байланышты үздү же ажырады
function handlePeerDisconnected(message) {
  let text = 'Байланыш үзүлдү. Кайра туташуу үчүн жаңы QR-код түзүңүз.';
  if (message.reason === 'user') {
    text = 'Байланыш үзүлдү. Телефон байланышты үздү. Кайра туташуу үчүн жаңы QR-код түзүңүз.';
  } else if (message.reason === 'timeout') {
    text = 'Уруксат убагында берилген жок. Жаңы QR-код түзүңүз.';
  }

  endSession({ badgeState: 'disconnected', message: text, cancelOnServer: false });
}

// "Байланышты үзүү" кнопкасы
function disconnect() {
  if (!state.sessionId) return;
  appLog('Колдонуучу байланышты үздү');

  // Алгач телефонго билдиребиз, анан баарын тазалайбыз
  sendToServer({ type: 'disconnect' });
  endSession({
    badgeState: 'disconnected',
    message: 'Байланыш үзүлдү. Кайра туташуу үчүн жаңы QR-код түзүңүз.',
    cancelOnServer: false,
  });
}

/* ===================== УРУКСАТ БЕРҮҮ ===================== */

// Телефон QR'ды сканерлеп, туташууну сурады. Колдонуучу өзү чечет.
function handlePhoneRequest(message) {
  if (state.phase !== 'waiting') return;

  // Код сервердин эле билдирүүсү, бирок экранга чыгаруудан мурун текшеребиз
  const code = /^\d{4}$/.test(String(message.code)) ? String(message.code) : '----';

  appLog('Телефон туташууну суранды, уруксат күтүлүүдө');
  stopCountdown();
  hideMessage();
  setPhase('approving');
  statusBadge.set('connecting', 'Телефон уруксат сурап жатат');
    // Кодду чоң кылып QR ордунда көрсөтөбүз
  showQrStatus(
    code,
    'Телефон туташууну сурап жатат',
    'Бул код телефонуңузда да көрүнүп жатабы? Эгер сиз сканерлеген жок болсоңуз, баш тартыңыз.'
  );
  qrElement.classList.add('qr--code');
  startCountdown(APPROVAL_SECONDS * 1000, { label: 'Жооп берүүгө калды', onExpire: null });
}

// "Уруксат берүү"
function approve() {
  if (state.phase !== 'approving') return;
  appLog('Колдонуучу уруксат берди');
  stopCountdown();
  sendToServer({ type: 'approve' });
  setPhase('connecting');
  statusBadge.set('connecting', 'Түз байланыш түзүлүүдө...');
  showQrStatus('⏳', 'Уруксат берилди', 'Түз байланыш түзүлүүдө...');
}

// "Баш тартуу"
function reject() {
  if (state.phase !== 'approving') return;
  appLog('Колдонуучу баш тартты');
  sendToServer({ type: 'reject' });
  endSession({
    badgeState: 'disconnected',
    message: 'Туташуу өтүнүчү четке кагылды. Кайра туташуу үчүн жаңы QR-код түзүңүз.',
    cancelOnServer: false,
  });
}

/* ===================== АБАЛДАР ===================== */

// Сервер уруксатты ырастады: WebRTC байланышы башталат
function handlePhoneConnected() {
  if (state.phase !== 'connecting') return; // уруксатсыз башталбайт
  appLog('Уруксат ырасталды, WebRTC башталат');
  startPeer();
}

// WebRTC байланышы даяр
function handlePeerConnected() {
  appLog('WebRTC туташты ✓');
  setPhase('connected');
  statusBadge.set('connected', 'Телефон менен түз байланыш даяр');
      showQrStatus('✓', '✓ Телефон туташты', 'Телефон менен түз байланыш түзүлдү. Эми маалымат жөнөтсөңүз болот.');
  receiver.show();
    sendPanel.show();
}

/* ===================== НЕГИЗГИ ЛОГИКА ===================== */

// Жаңы session түзүп, QR көрсөтөт
async function generateNewSession() {
  setPhase('loading');
  statusBadge.set('waiting', 'QR-код түзүлүүдө...');
  hideMessage();
  stopCountdown();
  resetTexts();

  // Эски байланышты жана session'ду жабабыз
  closeConnections();
  const oldSessionId = state.sessionId;
  const oldToken = state.token;
  state.sessionId = null;
  state.token = null;
  if (oldSessionId) cancelSession(oldSessionId, oldToken);

  try {
    const session = await requestSession();
    appLog('Жаңы session түзүлдү');
    state.sessionId = session.sessionId;
    state.token = session.computerToken;
    renderQr(session.joinUrl);
    startCountdown(session.expiresInMs);
    openSocket(session.sessionId, session.computerToken);
    setPhase('waiting');
    statusBadge.set('waiting', 'Телефон күтүлүүдө');
  } catch (error) {
    resetQr(false);
    setPhase('ended');
    statusBadge.set('failed', 'Session түзүлгөн жок');
    showMessage(
      error.message === 'rate_limited'
        ? 'Өтө көп аракет болду. Бир аз күтүп, кайра аракет кылыңыз.'
        : 'Серверге туташуу мүмкүн болгон жок. Серверди текшерип, кайра аракет кылыңыз.'
    );
  }
}

// Колдонмону баштоо
function init() {
  newQrButton.addEventListener('click', generateNewSession);
  disconnectButton.addEventListener('click', disconnect);
  approveButton.addEventListener('click', approve);
  rejectButton.addEventListener('click', reject);
  generateNewSession();
}

init();