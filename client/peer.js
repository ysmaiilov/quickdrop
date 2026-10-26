// QuickDrop: WebRTC жардамчысы (компьютер да, телефон да колдонот).
// Бул файл RTCPeerConnection жана DataChannel'ди башкарат.
// Signaling билдирүүлөрүн (offer, answer, ICE) өзү жөнөтпөйт:
// аларды sendSignal функциясы аркылуу сайттын коду жөнөтөт.
//
// DataChannel аркылуу эки түрдөгү маалымат өтөт:
//   - текст (JSON): башкаруу билдирүүлөрү, мисалы { type: 'text', ... }
//   - бинардык (ArrayBuffer): файлдын бөлүктөрү

// ICE серверлери config.js'тен (QUICKDROP_ICE_SERVERS аркылуу build'де коюлат).
// Болбосо акысыз public STUN server (түзмөккө өзүнүн тармактагы дарегин табууга жардам берет).
const ICE_SERVERS = (window.QUICKDROP_CONFIG && window.QUICKDROP_CONFIG.iceServers) || [
  { urls: 'stun:stun.l.google.com:19302' },
];

// Ушул убакытта туташпаса, ийгиликсиз деп эсептейбиз
const CONNECT_TIMEOUT_MS = 20 * 1000;
// Байланыш "disconnected" абалында ушунча убакыт турса, үзүлдү деп эсептейбиз
const DISCONNECT_GRACE_MS = 8 * 1000;
// Коопсуздук: JSON билдирүүнүн жана жөнөтүүнүн лимиттери
const MAX_JSON_MESSAGE_CHARS = 64 * 1024; // андан чоң JSON билдирүүлөр этибарга алынбайт
const DRAIN_TIMEOUT_MS = 30 * 1000; // буфер ушунча убакытта бошобосо, жөнөтүү токтойт

// Backpressure: буфердеги маалымат ушундан ашса, жөнөтүүнү токтотобуз,
// ушуга чейин азайганда улантабыз
const BUFFER_HIGH_WATER = 1024 * 1024; // 1 MB
const BUFFER_LOW_WATER = 256 * 1024; // 256 KB

function rtcLog(...args) {
  console.log('[WebRTC]', ...args);
}

// isInitiator: true -> компьютер (offer түзөт), false -> телефон (answer берет)
// sendSignal(data): signaling билдирүүсүн экинчи түзмөккө жөнөтөт
// onConnected(): DataChannel ачылды, түз байланыш даяр
// onFailed(reason): байланыш түзүлө алган жок
// onClosed(reason): байланыш түзүлгөндөн кийин үзүлдү
// onMessage(message): экинчи түзмөктөн JSON билдирүү келди
// onBinary(buffer): экинчи түзмөктөн бинардык маалымат (файл бөлүгү) келди
function createPeer({
  isInitiator,
  sendSignal,
  onConnected,
  onFailed,
  onClosed,
  onMessage,
  onBinary,
}) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const pendingCandidates = []; // remote description келгенче сакталган ICE'лер
  let channel = null;
  let connected = false;
  let closed = false;
  let disconnectTimerId = null;

  const role = isInitiator ? 'компьютер' : 'телефон';
  rtcLog(`${role}: RTCPeerConnection түзүлдү`);

  // Көп убакыт өтсө, туташпай калды деп эсептейбиз
  const timeoutId = setTimeout(() => {
    if (!connected && !closed) {
      rtcLog('Убакыт бүттү: түз байланыш түзүлгөн жок');
      fail('timeout');
    }
  }, CONNECT_TIMEOUT_MS);

  // Байланыш бүткөндө же ишке ашпаганда бир гана жолу чакырылат
  function fail(reason) {
    if (closed) return;
    const wasConnected = connected;
    close();
    if (wasConnected) {
      if (onClosed) onClosed(reason);
    } else if (onFailed) {
      onFailed(reason);
    }
  }

  // Канал ачыкпы?
  function isOpen() {
    return Boolean(channel) && channel.readyState === 'open';
  }

  // DataChannel окуяларын туташтырат
  function setupChannel(dataChannel) {
    channel = dataChannel;
    channel.binaryType = 'arraybuffer'; // бинардык маалымат ArrayBuffer болуп келет
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;

    channel.addEventListener('open', () => {
      connected = true;
      clearTimeout(timeoutId);
      rtcLog('DataChannel ачылды: түз байланыш даяр ✓');
      if (onConnected) onConnected();
    });

    channel.addEventListener('close', () => {
      rtcLog('DataChannel жабылды');
      fail('channel_closed');
    });

    // Экинчи түзмөктөн маалымат келгенде
    channel.addEventListener('message', (event) => {
      // Тексттик билдирүү = JSON
      if (typeof event.data === 'string') {
        if (event.data.length > MAX_JSON_MESSAGE_CHARS) {
          rtcLog('Өтө чоң билдирүү алынды, этибарга алынган жок');
          return;
        }
        try {
          const message = JSON.parse(event.data);
          rtcLog('Билдирүү алынды:', message.type); // мазмунун логдобойбуз
          if (onMessage) onMessage(message);
        } catch (error) {
          rtcLog('Туура эмес билдирүү алынды');
        }
        return;
      }

      // Бинардык маалымат = файлдын бөлүгү
      if (event.data instanceof ArrayBuffer && onBinary) {
        onBinary(event.data);
      }
    });
  }

  // Компьютер каналды өзү ачат, телефон аны күтүп алат
  if (isInitiator) {
    setupChannel(pc.createDataChannel('quickdrop'));
  } else {
    pc.addEventListener('datachannel', (event) => {
      rtcLog('DataChannel алынды');
      setupChannel(event.channel);
    });
  }

  // Бул түзмөктүн ICE candidate'и табылды -> экинчи түзмөккө жөнөтөбүз
  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      rtcLog('ICE candidate табылды, жөнөтүлдү');
      sendSignal({ candidate: event.candidate });
    } else {
      rtcLog('ICE candidate\'лердин баары чогулду');
    }
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    rtcLog('ICE абалы:', pc.iceConnectionState);
  });

  pc.addEventListener('connectionstatechange', () => {
    rtcLog('Байланыш абалы:', pc.connectionState);

    if (pc.connectionState === 'failed') {
      fail('connection_failed');
    } else if (pc.connectionState === 'disconnected') {
      // Убактылуу үзүлүү болушу мүмкүн: бир аз күтүп көрөбүз
      clearTimeout(disconnectTimerId);
      disconnectTimerId = setTimeout(() => {
        if (pc.connectionState === 'disconnected') fail('connection_lost');
      }, DISCONNECT_GRACE_MS);
    } else {
      clearTimeout(disconnectTimerId);
    }
  });

  // Компьютер гана чакырат: offer түзүп жөнөтөт
  async function start() {
    try {
      rtcLog('Offer түзүлүүдө...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ description: pc.localDescription });
      rtcLog('Offer жөнөтүлдү');
    } catch (error) {
      rtcLog('Offer түзүүдө ката:', error);
      fail('offer_error');
    }
  }

  // Экинчи түзмөктөн келген signaling маалыматын иштетет
  async function handleSignal(data) {
    try {
      if (data.description) {
        rtcLog(`${data.description.type} алынды`);
        await pc.setRemoteDescription(data.description);
        await flushPendingCandidates();

        // Offer келсе (телефон), answer түзүп кайтарабыз
        if (data.description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ description: pc.localDescription });
          rtcLog('Answer жөнөтүлдү');
        }
      } else if (data.candidate) {
        // Remote description келмейинче candidate кошууга болбойт, ошондуктан күтөбүз
        if (pc.remoteDescription) {
          await pc.addIceCandidate(data.candidate);
          rtcLog('ICE candidate кошулду');
        } else {
          pendingCandidates.push(data.candidate);
          rtcLog('ICE candidate убактылуу сакталды');
        }
      }
    } catch (error) {
      rtcLog('Signaling иштетүүдө ката:', error);
      fail('signal_error');
    }
  }

  // Күтүп турган ICE candidate'терди кошот
  async function flushPendingCandidates() {
    while (pendingCandidates.length > 0) {
      await pc.addIceCandidate(pendingCandidates.shift());
      rtcLog('Күтүп турган ICE candidate кошулду');
    }
  }

  // DataChannel аркылуу JSON билдирүү жөнөтөт.
  // Ийгиликтүү болсо true, байланыш жок болсо false кайтарат.
  function send(message) {
    if (!isOpen()) return false;
    try {
      channel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      rtcLog('Жөнөтүүдө ката:', error);
      return false;
    }
  }

  // Буфер бошонгончо күтөт (backpressure).
  // Канал жабылса же убакыт өтүп кетсе, ката менен токтойт.
  function waitForDrain() {
    return new Promise((resolve, reject) => {
      if (!isOpen()) {
        reject(new Error('channel_closed'));
        return;
      }
      if (channel.bufferedAmount <= BUFFER_LOW_WATER) {
        resolve();
        return;
      }

      const cleanup = () => {
        clearTimeout(timer);
        channel.removeEventListener('bufferedamountlow', onLow);
        channel.removeEventListener('close', onClose);
      };
      const onLow = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(new Error('channel_closed'));
      };
      // Экинчи түзмөк маалыматты окубай калса, чексиз күтпөйбүз
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('drain_timeout'));
      }, DRAIN_TIMEOUT_MS);

      channel.addEventListener('bufferedamountlow', onLow);
      channel.addEventListener('close', onClose);
    });
  }

  // Бинардык маалымат (файл бөлүгү) жөнөтөт.
  // Буфер толуп калса, алгач бошонгончо күтөт.
  async function sendBinary(data) {
    if (!isOpen()) throw new Error('channel_closed');
    if (channel.bufferedAmount > BUFFER_HIGH_WATER) {
      await waitForDrain();
    }
    channel.send(data);
  }

  // Бардык ресурстарды бошотот (бир нече жолу чакырса болот)
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timeoutId);
    clearTimeout(disconnectTimerId);
    if (channel) channel.close();
    pc.close();
    rtcLog('Байланыш жабылды');
  }

  return { start, handleSignal, send, sendBinary, close };
}