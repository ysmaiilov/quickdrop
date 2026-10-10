// QuickDrop: компьютерден телефонго жөнөтүү (10-этап).
// 💻 Компьютер → 📱 Телефон: текст, сүрөт жана файл WebRTC DataChannel аркылуу түз өтөт.
// Файлды file picker же Drag & Drop аркылуу тандаса болот.

const SEND_TEXT_MAX_BYTES = 16000; // DataChannel билдирүүсү үчүн коопсуз өлчөм
const SEND_TEXT_ACK_TIMEOUT_MS = 5000; // телефон "алдым" дебесе, канча күтөбүз

// getPeer: учурдагы WebRTC байланышын кайтарган функция
function createSendPanel({ getPeer }) {
  const section = document.getElementById('sendPanel');

  // Текст
  const textInput = document.getElementById('pcTextInput');
  const sendTextButton = document.getElementById('pcSendTextBtn');
  const textMessage = document.getElementById('pcTextMessage');

  // Файл жана сүрөт
  const dropzone = document.getElementById('pcDropzone');
  const pickButton = document.getElementById('pcPickBtn');
  const fileInput = document.getElementById('pcFileInput');
  const fileInfo = document.getElementById('pcFileInfo');
  const thumbElement = document.getElementById('pcFileThumb');
  const iconElement = document.getElementById('pcFileIcon');
  const nameElement = document.getElementById('pcFileName');
  const sizeElement = document.getElementById('pcFileSize');
  const progressBox = document.getElementById('pcFileProgress');
  const progressBar = document.getElementById('pcFileProgressBar');
  const progressLabel = document.getElementById('pcFileProgressLabel');
  const fileMessage = document.getElementById('pcFileMessage');
  const sendFileButton = document.getElementById('pcSendFileBtn');

  // Файл жөнөтүү модулу (transfer.js)
  const fileSender = createFileSender({ getPeer });

  // Текст абалы
  let textSending = false;
  let canRetryText = false;
  let textTimer = null;

  // Файл абалы
  let selectedFile = null;
  let selectedKind = 'file';
  let previewUrl = null;
  let controller = null; // жөнөтүүнү токтотуу үчүн (AbortController)
  let canRetryFile = false;

  // Ката түрлөрү жана алардын тексттери
  const ERROR_TEXTS = {
    not_connected: 'Байланыш жок. Жаңы QR-код түзүп, кайра туташыңыз.',
    channel_closed: 'Байланыш үзүлдү. Жаңы QR-код түзүп, кайра туташыңыз.',
    ack_timeout: 'Телефон маалыматты ырастаган жок. Байланышты текшериңиз.',
    busy: 'Башка өткөрүү жүрүп жатат. Аяктаганча күтүңүз.',
    receiver_error: 'Телефон маалыматты кабыл ала албады.',
    too_large: 'Файл телефон үчүн өтө чоң.',
    unsupported: 'Телефон бул форматты кабыл албайт.',
    blocked_type: 'Бул файл түрү коопсуздук үчүн бөгөттөлгөн (программа файлдары жөнөтүлбөйт).',
    quota_exceeded: 'Телефон бул байланыш үчүн көбүрөөк маалымат кабыл албайт. Жаңы байланыш түзүңүз.',
    timeout: 'Телефон күтүп туруп токтотуп койду. Кайра аракет кылыңыз.',
    protocol_error: 'Өткөрүүдө ката кетти. Кайра аракет кылыңыз.',
    size_mismatch: 'Маалымат толук жетпеди. Кайра аракет кылыңыз.',
  };

  /* ----- Жалпы жардамчылар ----- */

  function showMessage(element, text, type) {
    element.textContent = text;
    element.className = `message message--${type}`;
    element.hidden = false;
  }

  function clearMessage(element) {
    element.hidden = true;
    element.textContent = '';
  }

  /* ----- ТЕКСТ ----- */

  function updateTextControls() {
    sendTextButton.disabled = textSending;
    textInput.disabled = textSending;
    sendTextButton.textContent = textSending
      ? 'Жөнөтүлүүдө...'
      : canRetryText
        ? 'Кайра аракет кылуу'
        : 'Текст жөнөтүү';
  }

  // Текст жөнөтүү ийгиликсиз болду. report: абал көрсөткүчүнө билдиребизби
  function failText(text, report = true) {
    clearTimeout(textTimer);
    textSending = false;
    canRetryText = true;
    updateTextControls();
    showMessage(textMessage, text, 'error');
    if (report) reportTransferStatus('failed', { name: 'Текст' });
  }

  function sendText() {
    if (textSending) return;

    const text = textInput.value.trim();
    if (!text) {
      showMessage(textMessage, 'Алгач текст жазыңыз.', 'error');
      return;
    }
    if (new TextEncoder().encode(text).length > SEND_TEXT_MAX_BYTES) {
      showMessage(textMessage, 'Текст өтө узун. Кыскараак текст жазыңыз.', 'error');
      return;
    }

    // Бир убакта бир гана өткөрүү (жөнөтүү же алуу жүрүп жатса, күтөбүз)
    if (isFileTransferActive()) {
      showMessage(textMessage, ERROR_TEXTS.busy, 'error');
      return;
    }

    const peer = getPeer();
    const sent = peer ? peer.send({ type: 'text', text }) : false;
    if (!sent) {
      failText(ERROR_TEXTS.not_connected, false);
      return;
    }

    clearMessage(textMessage);
    textSending = true;
    updateTextControls();
    reportTransferStatus('sending', { name: 'Текст' });
    textTimer = setTimeout(() => failText('Телефон жооп берген жок. Байланышты текшериңиз.'), SEND_TEXT_ACK_TIMEOUT_MS);
  }

  /* ----- ФАЙЛ ЖАНА СҮРӨТ ----- */

  function updateFileControls() {
    const busy = controller !== null;
    pickButton.disabled = busy;
    sendFileButton.disabled = busy || !selectedFile;
    sendFileButton.textContent = busy
      ? 'Жөнөтүлүүдө...'
      : canRetryFile
        ? 'Кайра аракет кылуу'
        : 'Жөнөтүү';
    dropzone.classList.toggle('dropzone--disabled', busy);
  }

  function showProgress(sent, total) {
    const percent = Math.floor((sent / total) * 100);
    progressBar.style.width = `${percent}%`;
    progressLabel.textContent = `${percent}% · ${formatFileSize(sent)} / ${formatFileSize(total)}`;
    progressBox.hidden = false;
    progressLabel.hidden = false;
  }

  function hideProgress() {
    progressBox.hidden = true;
    progressLabel.hidden = true;
    progressBar.style.width = '0%';
  }

  // Тандалган файлды жана preview'ну тазалайт
  function clearSelection() {
    selectedFile = null;
    selectedKind = 'file';
    canRetryFile = false;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    thumbElement.removeAttribute('src');
    thumbElement.hidden = true;
    fileInfo.hidden = true;
    fileInput.value = ''; // ошол эле файлды кайра тандаганга мүмкүндүк берет
    updateFileControls();
  }

  // Файл тандалды (file picker же Drag & Drop аркылуу)
  function selectFile(file) {
    if (controller) {
      showMessage(fileMessage, ERROR_TEXTS.busy, 'error');
      return;
    }

    clearMessage(fileMessage);
    hideProgress();
    clearSelection();

    if (file.size === 0) {
      showMessage(fileMessage, 'Файл бош экен. Башка файл тандаңыз.', 'error');
      return;
    }
    if (file.size > MAX_MOBILE_FILE_BYTES) {
      showMessage(fileMessage, `Файл өтө чоң. Телефон ${formatFileSize(MAX_MOBILE_FILE_BYTES)} чейин кабыл алат.`, 'error');
      return;
    }
    if (isBlockedFileName(file.name)) {
      showMessage(fileMessage, ERROR_TEXTS.blocked_type, 'error');
      return;
    }

    // Сүрөт болсо, телефондо preview менен көрсөтүлөт; башкасы файл катары өтөт
    const isImage = IMAGE_MIME_PATTERN.test(file.type) && file.size <= MAX_IMAGE_BYTES;
    selectedFile = file;
    selectedKind = isImage ? 'image' : 'file';

    iconElement.textContent = isImage ? '🖼️' : getFileIcon(file.name);
    nameElement.textContent = file.name;
    sizeElement.textContent = formatFileSize(file.size);

    if (isImage) {
      previewUrl = URL.createObjectURL(file);
      thumbElement.onerror = () => {
        thumbElement.hidden = true; // браузер форматты көрсөтө албаса
      };
      thumbElement.src = previewUrl;
      thumbElement.hidden = false;
    }

    fileInfo.hidden = false;
    updateFileControls();
  }

  async function sendSelectedFile() {
    if (!selectedFile || controller) return;

    if (isFileTransferActive()) {
      showMessage(fileMessage, ERROR_TEXTS.busy, 'error');
      return;
    }

    const file = selectedFile;
    const kind = selectedKind;
    const currentController = new AbortController();
    controller = currentController;

    clearMessage(fileMessage);
    showProgress(0, file.size);
    updateFileControls();

    try {
      await fileSender.sendFile(file, {
        kind,
        onProgress: showProgress,
        signal: currentController.signal,
      });
      showMessage(fileMessage, '✓ Ийгиликтүү жөнөтүлдү', 'success');
      clearSelection();
    } catch (error) {
      // Байланыш үзүлүп же панель жабылып, өзүбүз токтоткон болсо, эч нерсе көрсөтпөйбүз
      if (currentController.signal.aborted) return;

      const text =
        ERROR_TEXTS[error.reason] ||
        ERROR_TEXTS[error.code] ||
        'Жөнөтүлгөн жок. Кайра аракет кылыңыз.';
      showMessage(fileMessage, text, 'error');
      canRetryFile = true;
    } finally {
      controller = null;
      hideProgress();
      updateFileControls();
    }
  }

  /* ----- DRAG & DROP ----- */

  // Папка сүйрөп таштаса, аны жөнөтүүгө болбойт
  function containsDirectory(dataTransfer) {
    return Array.from(dataTransfer.items || []).some((item) => {
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      return Boolean(entry) && entry.isDirectory;
    });
  }

  dropzone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dropzone.classList.add('dropzone--active');
  });

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('dropzone--active');
  });

  dropzone.addEventListener('dragleave', (event) => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dropzone--active');
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dropzone--active');

    if (controller) {
      showMessage(fileMessage, ERROR_TEXTS.busy, 'error');
      return;
    }
    if (containsDirectory(event.dataTransfer)) {
      showMessage(fileMessage, 'Папканы жөнөтүүгө болбойт. Алгач аны ZIP кылыңыз.', 'error');
      return;
    }

    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;

    selectFile(files[0]);
    if (files.length > 1 && selectedFile) {
      showMessage(fileMessage, 'Бир убакта бир гана файл жөнөтүлөт: биринчи файл тандалды.', 'error');
    }
  });

  // Файл бетке туура эмес жерге ташталса, браузер аны ачып, байланышты үзүп койбосун
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  // Дропзонанын каалаган жерин басса да файл тандоо ачылат
  dropzone.addEventListener('click', (event) => {
    if (controller || event.target === pickButton) return;
    fileInput.click();
  });

  /* ----- Панелди көрсөтүү / жашыруу ----- */

  function show() {
    section.hidden = false;
  }

  // Баарын тазалап, жашырат (байланыш үзүлгөндө же жаңы session башталганда)
  function hide() {
    if (controller) controller.abort(); // жөнөтүү жүрүп жатса, токтотобуз
    clearTimeout(textTimer);
    textSending = false;
    canRetryText = false;
    textInput.value = '';
    clearMessage(textMessage);
    updateTextControls();

    clearSelection();
    clearMessage(fileMessage);
    hideProgress();
        selectTile('text');
    section.hidden = true;
  }

  // Телефондон келген билдирүү ("алдым" жооптору)
  function handleMessage(message) {
    if (message.type === 'text:received') {
      if (!textSending) return; // биз текст жөнөткөн жокпуз
      clearTimeout(textTimer);
      textSending = false;
      canRetryText = false;
      textInput.value = '';
      updateTextControls();
      showMessage(textMessage, '✓ Ийгиликтүү жөнөтүлдү', 'success');
      reportTransferStatus('completed', { name: 'Текст' });
      return;
    }
    fileSender.handleMessage(message);
  }

  /* ----- Түр тандоо плиткалары: Текст / Сүрөт / Файл (UI гана) ----- */

  const tiles = {
    text: document.getElementById('pcTileText'),
    image: document.getElementById('pcTileImage'),
    file: document.getElementById('pcTileFile'),
  };
  const textBlock = document.getElementById('pcTextBlock');
  const fileBlock = document.getElementById('pcFileBlock');

  // Тандалган түргө жараша керектүү блокту көрсөтөт
  function selectTile(kind) {
    for (const [name, tile] of Object.entries(tiles)) {
      const active = name === kind;
      tile.classList.toggle('tile--active', active);
      tile.setAttribute('aria-pressed', String(active));
    }
    textBlock.hidden = kind !== 'text';
    fileBlock.hidden = kind === 'text';
    fileInput.accept = kind === 'image' ? 'image/*' : ''; // сүрөт плиткасы сүрөттөрдү гана сунуштайт
  }

  for (const [kind, tile] of Object.entries(tiles)) {
    tile.addEventListener('click', () => {
      if (controller || textSending) return; // жөнөтүү жүрүп жатканда которулбайт
      selectTile(kind);
    });
  }
  selectTile('text');

  sendTextButton.addEventListener('click', sendText);
  pickButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selectFile(fileInput.files[0]);
  });
  sendFileButton.addEventListener('click', sendSelectedFile);

  return { show, hide, handleMessage };
}