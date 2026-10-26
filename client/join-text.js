// QuickDrop: телефондон текст жөнөтүү (8-этап).
// Текст сервер аркылуу эмес, WebRTC DataChannel аркылуу түз компьютерге өтөт.

const MAX_TEXT_BYTES = 16000; // DataChannel билдирүүсү үчүн коопсуз өлчөм
const ACK_TIMEOUT_MS = 5000; // компьютер "алдым" дебесе, канча күтөбүз

// getPeer: учурдагы WebRTC байланышын кайтарган функция
function createTextSender({ getPeer }) {
  const statusCard = document.getElementById('statusCard');
  const textButton = document.getElementById('textBtn');
  const textCard = document.getElementById('textCard');
  const textInput = document.getElementById('textInput');
  const textMessage = document.getElementById('textMessage');
  const sendButton = document.getElementById('sendTextBtn');
  const backButton = document.getElementById('backBtn');

  const TRANSFER_NAME = 'Текст'; // абал көрсөткүчүндө көрүнөт

  let waitingTimer = null;
  let canRetry = false; // жөнөтүү ийгиликсиз болду: "Кайра аракет кылуу" көрсөтөбүз

  // Текст экранындагы билдирүү (ийгилик же ката)
  function showMessage(text, type) {
    textMessage.textContent = text;
    textMessage.className = `message message--${type}`;
    textMessage.hidden = false;
  }

  function clearMessage() {
    textMessage.hidden = true;
    textMessage.textContent = '';
  }

  // Жөнөтүү учурунда талааны жана кнопкаларды бөгөттөйбүз
  function setSending(isSending) {
    sendButton.disabled = isSending;
    textInput.disabled = isSending;
    backButton.disabled = isSending; // жөнөтүү учурунда башка экранга өтүүгө болбойт
    sendButton.textContent = isSending
      ? 'Жөнөтүлүүдө...'
      : canRetry
        ? 'Кайра аракет кылуу'
        : 'Жөнөтүү';
  }

  // Жөнөтүү ийгиликсиз болду. report: абал көрсөткүчүнө билдиребизби
  function failSend(text, { report = true } = {}) {
    clearTimeout(waitingTimer);
    canRetry = true;
    setSending(false);
    showMessage(text, 'error');
    if (report) reportTransferStatus('failed', { name: TRANSFER_NAME });
  }

  // Туташкандан кийин "📝 Текст" кнопкасын көрсөтөт
  function show() {
    textButton.hidden = false;
  }

  // Баарын баштапкы абалга кайтарат (статус картасы гана көрүнөт)
  function hide() {
    clearTimeout(waitingTimer);
    canRetry = false;
    setSending(false);
    textButton.hidden = true;
    textCard.hidden = true;
    statusCard.hidden = false;
  }

  // "📝 Текст" басылганда текст экранын ачат
  function open() {
    clearMessage();
    statusCard.hidden = true;
    textCard.hidden = false;
    textInput.focus();
  }

  // "← Артка" басылганда
  function back() {
    clearTimeout(waitingTimer);
    canRetry = false;
    setSending(false);
    textCard.hidden = true;
    statusCard.hidden = false;
  }

  // "Жөнөтүү" же "Кайра аракет кылуу" басылганда
  function send() {
    const text = textInput.value.trim();

    if (!text) {
      showMessage('Алгач текст жазыңыз.', 'error');
      return;
    }
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
      showMessage('Текст өтө узун. Кыскараак текст жазыңыз.', 'error');
      return;
    }

    // Бир убакта бир гана өткөрүү
    if (isFileTransferActive()) {
      showMessage('Башка өткөрүү жүрүп жатат. Аяктаганча күтүңүз.', 'error');
      return;
    }

    // Байланыш жок болсо, түшүнүктүү ката көрсөтөбүз
    const peer = getPeer();
    const sent = peer ? peer.send({ type: 'text', text }) : false;
    if (!sent) {
      failSend('Байланыш жок. Компьютерден жаңы QR-код түзүп, кайра туташыңыз.', { report: false });
      return;
    }

    // Компьютер "алдым" деген жооп бергенче күтөбүз
    clearMessage();
    setSending(true);
    reportTransferStatus('sending', { name: TRANSFER_NAME });
    waitingTimer = setTimeout(() => {
      failSend('Компьютер жооп берген жок. Байланышты текшериңиз.');
    }, ACK_TIMEOUT_MS);
  }

  // Компьютерден келген билдирүү
  function handleMessage(message) {
    if (message.type === 'text:received') {
      clearTimeout(waitingTimer);
      canRetry = false;
      setSending(false);
      textInput.value = '';
      reportTransferStatus('completed', { name: TRANSFER_NAME });
      back(); // башкы экранга кайтабыз
    }
  }

  textButton.addEventListener('click', open);
  sendButton.addEventListener('click', send);
  backButton.addEventListener('click', back);

  return { show, hide, handleMessage };
}