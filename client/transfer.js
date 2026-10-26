// QuickDrop: файл өткөрүү протоколу (8-этап).
// Бул файл эки бетте тең колдонулат. Сүрөт жана жалпы файлдар үчүн бирдей иштейт.
//
// Протокол (DataChannel аркылуу):
//   1) { type: 'file:start', id, kind, name, size, mime } - файл башталды
//        kind: 'image' (сүрөт, preview менен) же 'file' (жалпы файл)
//   2) ArrayBuffer, ArrayBuffer, ...                      - файлдын бөлүктөрү
//   3) { type: 'file:end', id }                           - файл аяктады
//   4) { type: 'file:received', id }                      - алуучу "толук алдым" дейт
// Ката болсо: { type: 'file:error', id, reason } же { type: 'file:cancel', id }
//
// Бир убакта бир гана өткөрүүгө уруксат:
//   - жөнөтүүчү: activeSend өзгөрмөсү (бардык жөнөтүүчүлөр үчүн жалпы)
//   - алуучу: current өзгөрмөсү, жаңы файл келсе 'busy' ката кайтарат
// Кийин бир нече файл үчүн: бөлүктөргө номер кошуп, ушул өзгөрмөлөрдү Map кылабыз.

const FILE_CHUNK_SIZE = 16 * 1024; // бир бөлүктүн өлчөмү (16 KB: бардык браузерде коопсуз)
const FILE_READ_BLOCK_SIZE = 256 * 1024; // файлдан бир жолу окулуучу блок
const FILE_BLOB_BATCH_BYTES = 4 * 1024 * 1024; // алуучу ушунча чогулткан сайын Blob түзөт
const FILE_ACK_TIMEOUT_MS = 15 * 1000; // акырында "алдым" деген жоопту күтүү убактысы
const FILE_RECEIVE_IDLE_TIMEOUT_MS = 30 * 1000; // алуучу: бөлүк келбей калса ушунча убакыттан кийин токтотот
const MAX_INCOMING_NAME_LENGTH = 255; // келген файл атынын максималдуу узундугу

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // сүрөт: максимум 50 MB
const MAX_FILE_BYTES = 300 * 1024 * 1024; // жалпы файл: максимум 300 MB
const MAX_MOBILE_FILE_BYTES = 100 * 1024 * 1024; // телефон кабыл ала турган эң чоң файл: 100 MB

// Колдоого алынган сүрөт форматтары
const IMAGE_MIME_PATTERN = /^image\/(jpeg|png|gif|webp|bmp|avif|heic|heif)$/;

// Файл түрлөрүнүн иконкалары (кеңейтүү боюнча)
const FILE_ICONS = {
  pdf: '📕',
  doc: '📘',
  docx: '📘',
  xls: '📗',
  xlsx: '📗',
  ppt: '📙',
  pptx: '📙',
  zip: '🗜️',
  rar: '🗜️',
  '7z': '🗜️',
  txt: '📝',
};

/* ===================== АБАЛДЫ КАБАРЛОО ===================== */

// Беттер өткөрүүнүн абалын билүү үчүн ушул функцияга жазылат (status.js).
// Абалдар: 'sending', 'receiving', 'completed', 'failed', 'cancelled'
let transferStatusHandler = null;

function onTransferStatus(handler) {
  transferStatusHandler = handler;
}

function reportTransferStatus(status, detail = {}) {
  if (transferStatusHandler) transferStatusHandler(status, detail);
}

// Учурда жөнөтүлүп жаткан файл (бардык жөнөтүүчүлөр үчүн жалпы)
let activeSend = null;

// Алуучу ушул функцияны өзү коёт: учурда файл алынып жатабы?
let receiveActiveCheck = () => false;

// Өткөрүү жүрүп жатабы? Жөнөтүү да, алуу да эсептелет (бир убакта бир гана өткөрүү)
function isFileTransferActive() {
  return activeSend !== null || receiveActiveCheck();
}

/* ===================== ЖАРДАМЧЫЛАР ===================== */

// Өткөрүү катасы: code - ката түрү, reason - алуучу жөнөткөн себеп
class TransferError extends Error {
  constructor(code, reason) {
    super(code);
    this.code = code;
    this.reason = reason || null;
  }
}

// Файлдын өлчөмүн окууга ыңгайлуу кылат: 3355443 -> "3.2 MB"
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Файлдын атына карап иконка тандайт
function getFileIcon(fileName) {
  const extension = String(fileName).split('.').pop().toLowerCase();
  return FILE_ICONS[extension] || '📄';
}

function makeTransferId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ===================== ЖӨНӨТҮҮЧҮ ===================== */

// getPeer: учурдагы WebRTC байланышын кайтарган функция
function createFileSender({ getPeer }) {
  // Акыркы "алдым" жоопту күтөт
  function waitForAck(current) {
    return new Promise((resolve, reject) => {
      let timer = null;

      const finish = () => {
        clearTimeout(timer);
        if (current.failure) reject(current.failure);
        else resolve();
      };

      // Жооп буга чейин эле келип калышы мүмкүн
      if (current.acked || current.failure) {
        finish();
        return;
      }

      timer = setTimeout(() => reject(new TransferError('ack_timeout')), FILE_ACK_TIMEOUT_MS);
      current.onSettled = finish;
    });
  }

  // Файлды бөлүп-бөлүп жөнөтөт.
  // kind: 'image' же 'file', onProgress(sent, total): прогресс,
  // signal: AbortSignal (токтотуу үчүн)
  async function sendFile(file, { kind = 'file', onProgress, signal } = {}) {
    const peer = getPeer();
    if (!peer) throw new TransferError('not_connected');
    if (isFileTransferActive()) throw new TransferError('busy'); // бир убакта бир гана өткөрүү

    const id = makeTransferId();
    const current = { id, failure: null, acked: false, onSettled: null };
    activeSend = current;
    reportTransferStatus('sending', { name: file.name });

    try {
      const started = peer.send({
        type: 'file:start',
        id,
        kind,
        name: file.name,
        size: file.size,
        mime: file.type,
      });
      if (!started) throw new TransferError('not_connected');

      let sent = 0;

      // Файлды чоң блоктор менен окуйбуз, ар блокту 16 KB бөлүктөргө бөлүп жөнөтөбүз
      for (let blockStart = 0; blockStart < file.size; blockStart += FILE_READ_BLOCK_SIZE) {
        const block = await file
          .slice(blockStart, blockStart + FILE_READ_BLOCK_SIZE)
          .arrayBuffer();

        for (let offset = 0; offset < block.byteLength; offset += FILE_CHUNK_SIZE) {
          if (signal && signal.aborted) throw new TransferError('cancelled');
          if (current.failure) throw current.failure; // алуучу ката жөнөттү

          const chunk = block.slice(offset, offset + FILE_CHUNK_SIZE);
          await peer.sendBinary(chunk); // буфер толуп калса, ушул жерде күтөт

          sent += chunk.byteLength;
          if (onProgress) onProgress(sent, file.size);
        }
      }

      if (current.failure) throw current.failure;
      if (!peer.send({ type: 'file:end', id })) throw new TransferError('not_connected');

      await waitForAck(current);
      reportTransferStatus('completed', { name: file.name });
    } catch (error) {
      // Алуучуга жарым-жартылай маалыматты таштоону айтабыз (мүмкүн болсо)
      if (!current.failure) peer.send({ type: 'file:cancel', id });

      const transferError =
        error instanceof TransferError ? error : new TransferError('channel_closed');

      // Байланыш үзүлсө, "Байланыш үзүлдү" абалын беттин өзү көрсөтөт
      const connectionLost =
        transferError.code === 'not_connected' || transferError.code === 'channel_closed';
      const cancelled = transferError.code === 'cancelled';
      reportTransferStatus(cancelled || connectionLost ? 'cancelled' : 'failed', {
        name: file.name,
      });

      throw transferError;
    } finally {
      activeSend = null;
    }
  }

  // Алуучудан келген билдирүүлөр
  function handleMessage(message) {
    if (!activeSend || message.id !== activeSend.id) return;

    if (message.type === 'file:received') {
      activeSend.acked = true;
    } else if (message.type === 'file:error') {
      activeSend.failure = new TransferError('receiver_error', message.reason);
    } else {
      return;
    }

    if (activeSend.onSettled) activeSend.onSettled();
  }

  return { sendFile, handleMessage };
}
/* ===================== АЛУУЧУ ===================== */

// send: экинчи түзмөккө JSON билдирүү жөнөтүүчү функция
// accept(meta): файлды кабыл алабызбы? Макул болсо null, макул эмес болсо себебин
//               (мисалы 'unsupported', 'too_large') кайтарат
// onStart(meta), onProgress(meta, received), onComplete(file), onError(meta, reason)
function createFileReceiver({ send, accept, onStart, onProgress, onComplete, onError }) {
  let current = null; // учурда алынып жаткан файл
  receiveActiveCheck = () => current !== null;
  let idleTimer = null;

  function stopIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Жөнөтүүчү тымып калса, алууну токтотобуз (кийинки файлдарды бөгөттөп албашы үчүн)
  function armIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fail('timeout', true), FILE_RECEIVE_IDLE_TIMEOUT_MS);
  }

  // Чогулган бөлүктөрдү бир Blob'го бириктирет (эс тутумду үнөмдөө үчүн)
  function flushPending(meta) {
    if (meta.pending.length === 0) return;
    meta.parts.push(new Blob(meta.pending));
    meta.pending = [];
    meta.pendingBytes = 0;
  }

  // Ката: алууну токтотот. notifySender: жөнөтүүчүгө билдиребизби
  function fail(reason, notifySender) {
    stopIdleTimer();
    const meta = current;
    current = null;
    if (!meta) return;
    if (notifySender) send({ type: 'file:error', id: meta.id, reason });
    reportTransferStatus(reason === 'cancelled' ? 'cancelled' : 'failed', { name: meta.name });
    if (onError) onError(meta, reason);
  }

  function start(message) {
    const { id, name, size, mime } = message;
    const kind = message.kind === 'image' ? 'image' : 'file';

    // Келген маалымат ишенимсиз: түрүн жана узундугун текшеребиз
    const valid =
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= 64 &&
      typeof name === 'string' &&
      name.length > 0 &&
      name.length <= MAX_INCOMING_NAME_LENGTH &&
      typeof mime === 'string' &&
      mime.length <= 100 &&
      Number.isSafeInteger(size) &&
      size > 0;

    if (!valid) {
      const replyId = typeof id === 'string' ? id.slice(0, 64) : null;
      send({ type: 'file:error', id: replyId, reason: 'invalid' });
      return;
    }

    // Бир убакта бир гана файл алабыз: жаңысын кабыл албайбыз

    if (current || activeSend) {
      send({ type: 'file:error', id, reason: 'busy' });
      return;
    }

    if (size > MAX_FILE_BYTES) {
      send({ type: 'file:error', id, reason: 'too_large' });
      return;
    }

    const rejection = accept ? accept({ kind, name, size, mime }) : null;
    if (rejection) {
      send({ type: 'file:error', id, reason: rejection });
      return;
    }

    current = {
      id,
      kind,
      name,
      size,
      mime,
      parts: [], // даяр Blob бөлүктөрү
      pending: [], // али Blob'го бириктирилө элек ArrayBuffer'лер
      pendingBytes: 0,
      received: 0,
    };
    armIdleTimer();
    reportTransferStatus('receiving', { name });
    if (onStart) onStart({ id, kind, name, size, mime });
  }

  function finish(message) {
    if (!current || current.id !== message.id) return;

    // Бардык бөлүктөр келдиби?
    if (current.received !== current.size) {
      fail('size_mismatch', true);
      return;
    }

    stopIdleTimer();
    const meta = current;
    current = null;

    flushPending(meta);

    // Сүрөттүн түрүн сактайбыз (preview үчүн). Калган файлдар жөн гана жүктөлөт,
    // браузер аларды ачпашы үчүн жалпы түр коебуз.
    const blobType = meta.kind === 'image' ? meta.mime : 'application/octet-stream';
    const blob = new Blob(meta.parts, { type: blobType });

    send({ type: 'file:received', id: meta.id });
    reportTransferStatus('completed', { name: meta.name });
    if (onComplete) {
      onComplete({ kind: meta.kind, name: meta.name, size: meta.size, mime: meta.mime, blob });
    }
  }

  // JSON билдирүү. Бул билдирүү файлга тиешелүү болсо true кайтарат
  function handleMessage(message) {
    switch (message.type) {
      case 'file:start':
        start(message);
        return true;
      case 'file:end':
        finish(message);
        return true;
      case 'file:cancel':
        if (current && current.id === message.id) fail('cancelled', false);
        return true;
      default:
        return false;
    }
  }

  // Бинардык бөлүк келди
  function handleBinary(buffer) {
    if (!current) return;

    // Бөлүк 16 KB'дан чоң болбошу керек (протокол эрежеси)
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0 || buffer.byteLength > FILE_CHUNK_SIZE) {
      fail('protocol_error', true);
      return;
    }

    // Жарыяланган өлчөмдөн ашып кетсе, токтотобуз
    if (current.received + buffer.byteLength > current.size) {
      fail('size_mismatch', true);
      return;
    }

    current.pending.push(buffer);
    current.pendingBytes += buffer.byteLength;
    current.received += buffer.byteLength;
    armIdleTimer();

    if (current.pendingBytes >= FILE_BLOB_BATCH_BYTES) flushPending(current);
    if (onProgress) onProgress(current, current.received);
  }

  // Файл алынып жатабы?
  function isActive() {
    return current !== null;
  }

  // Үнсүз токтотот: жарым-жартылай келген маалымат ташталат жана колдонулбайт
  function cancel() {
    stopIdleTimer();
    current = null;
  }

  return { handleMessage, handleBinary, isActive, cancel };
}