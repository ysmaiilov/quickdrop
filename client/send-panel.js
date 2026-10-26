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
  const dropText = document.getElementById('pcDropText');
  const pickButton = document.getElementById('pcPickBtn');
  const fileInput = document.getElementById('pcFileInput');
  const listElement = document.getElementById('pcFileList');
  const progressBox = document.getElementById('pcFileProgress');
  const progressBar = document.getElementById('pcFileProgressBar');
  const progressLabel = document.getElementById('pcFileProgressLabel');
  const fileMessage = document.getElementById('pcFileMessage');
  const sendFileButton = document.getElementById('pcSendFileBtn');

  // Файл жөнөтүү модулу (transfer.js)
  const fileSender = createFileSender({ getPeer });

  // Тандалган файлдар (selection-list.js): ар бирин "✕" менен алып салса болот
  const selection = createSelectionList({ list: listElement, onChange: () => updateFileControls() });

  // Текст абалы
  let textSending = false;
  let canRetryText = false;
  let textTimer = null;

  // Файл абалы
  let tileKind = 'text'; // тандалган плитка: 'text', 'image' же 'file'
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
    const count = selection.count();
    pickButton.disabled = busy;
    sendFileButton.disabled = busy || count === 0;
    if (busy) sendFileButton.textContent = 'Жөнөтүлүүдө...';
    else if (canRetryFile) sendFileButton.textContent = 'Кайра аракет кылуу';
    else sendFileButton.textContent = count > 1 ? `Жөнөтүү (${count})` : 'Жөнөтүү';
    selection.setLocked(busy);
    dropzone.classList.toggle('dropzone--disabled', busy);
  }

  // index/count: бир нече файл болсо, "2/5" көрсөтөбүз
  function showProgress(sent, total, index = 1, count = 1) {
    const percent = Math.floor((sent / total) * 100);
    const prefix = count > 1 ? `${index}/${count} · ` : '';
    progressBar.style.width = `${percent}%`;
    progressLabel.textContent = `${prefix}${percent}% · ${formatFileSize(sent)} / ${formatFileSize(total)}`;
    progressBox.hidden = false;
    progressLabel.hidden = false;
  }

  function hideProgress() {
    progressBox.hidden = true;
    progressLabel.hidden = true;
    progressBar.style.width = '0%';
  }

  // Тандалган файлдарды тазалайт
  function clearSelection() {
    canRetryFile = false;
    fileInput.value = ''; // ошол эле файлды кайра тандаганга мүмкүндүк берет
    selection.clear();
  }

  // Бир файлды текшерет: ката тексти же null. Файл тизмеге кошулат (сүрөт болсо preview менен).
  function validateFile(file) {
    if (file.size === 0) return 'Файл бош экен. Башка файл тандаңыз.';
    if (file.size > MAX_MOBILE_FILE_BYTES) {
      return `Файл өтө чоң. Телефон ${formatFileSize(MAX_MOBILE_FILE_BYTES)} чейин кабыл алат.`;
    }
    if (isBlockedFileName(file.name)) return ERROR_TEXTS.blocked_type;

    const isImage = IMAGE_MIME_PATTERN.test(file.type) && file.size <= MAX_IMAGE_BYTES;
    if (tileKind === 'image' && !isImage) {
      return 'Бул сүрөт эмес (же өтө чоң). JPG, PNG, WEBP же GIF тандаңыз, же "Файл" плиткасын колдонуңуз.';
    }
    return null;
  }

  // Файлдар тандалды (file picker, Drag & Drop же Ctrl+V аркылуу): туура келгендери тизмеге кошулат
  function selectFiles(files) {
    if (controller) {
      showMessage(fileMessage, ERROR_TEXTS.busy, 'error');
      return;
    }

    clearMessage(fileMessage);
    hideProgress();
    canRetryFile = false;

    let firstError = null;
    let overflow = false;
    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        firstError = firstError || error;
        continue;
      }
      // Сүрөт болсо, телефондо preview менен көрсөтүлөт; башкасы файл катары өтөт
      const isImage = IMAGE_MIME_PATTERN.test(file.type) && file.size <= MAX_IMAGE_BYTES;
      if (!selection.add(file, isImage ? 'image' : 'file')) overflow = true;
    }

    if (overflow) showMessage(fileMessage, `Эң көп ${MAX_SELECTED_FILES} файл тандаса болот.`, 'error');
    else if (firstError) showMessage(fileMessage, firstError, 'error');
    updateFileControls();
  }

  // Тизмедеги файлдарды бирден-бирден жөнөтөт. Жөнөтүлгөнү тизмеден түшөт,
  // ката болсо токтойт жана калгандары "Кайра аракет кылуу" менен жөнөтүлөт.
  async function sendSelectedFiles() {
    if (selection.count() === 0 || controller) return;

    if (isFileTransferActive()) {
      showMessage(fileMessage, ERROR_TEXTS.busy, 'error');
      return;
    }

    const currentController = new AbortController();
    controller = currentController;
    const queue = selection.items();
    const total = queue.length;

    clearMessage(fileMessage);
    canRetryFile = false;
    updateFileControls();

    try {
      for (let index = 0; index < total; index += 1) {
        const item = queue[index];
        showProgress(0, item.file.size, index + 1, total);
        await fileSender.sendFile(item.file, {
          kind: item.kind,
          onProgress: (sent, size) => showProgress(sent, size, index + 1, total),
          signal: currentController.signal,
        });
        selection.drop(item);
        if (window.logSent) logSent(item.kind);
      }
      showMessage(
        fileMessage,
        total > 1 ? `✓ Жөнөтүлдү: ${total}` : '✓ Ийгиликтүү жөнөтүлдү',
        'success'
      );
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

    selectFiles(Array.from(files));
  });

  // Файл бетке туура эмес жерге ташталса, браузер аны ачып, байланышты үзүп койбосун
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  // Дропзонанын каалаган жерин басса да файл тандоо ачылат
  dropzone.addEventListener('click', (event) => {
    if (controller || event.target === pickButton) return;
    fileInput.click();
  });

  /* ----- ВСТАВИТЬ (Ctrl+V): алмашуу буферинен сүрөт ----- */

  // Буферде сүрөт болсо, аны тандалган файл кылат (скриншот же көчүрүлгөн сүрөт).
  // Текст гана болсо, браузер өзү текст талаасына коёт.
  document.addEventListener('paste', (event) => {
    if (section.hidden) return;

    const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const file = imageItem ? imageItem.getAsFile() : null;
    if (!file) return;

    event.preventDefault();
    if (controller || textSending) {
      showMessage(fileMessage, ERROR_TEXTS.busy, 'error');
      return;
    }

    selectTile('image');
    selectFiles([file]);
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
      if (window.logSent) logSent('text');
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
    tileKind = kind;
    fileInput.accept = kind === 'image' ? 'image/*' : ''; // сүрөт плиткасы сүрөттөрдү гана сунуштайт
    if (kind === 'image') {
      dropText.textContent = 'Сүрөттү ушул жерге сүйрөп таштаңыз же Ctrl+V менен коюңуз';
      pickButton.textContent = 'Сүрөт тандоо';
    } else {
      dropText.textContent = 'Файлды ушул жерге сүйрөп таштаңыз';
      pickButton.textContent = 'Файл тандоо';
    }
    // Башка түргө которулганда эски тандоо жана билдирүү калбасын
    if (!controller && kind !== 'text') {
      clearMessage(fileMessage);
      clearSelection();
    }
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
    const files = Array.from(fileInput.files);
    fileInput.value = '';
    if (files.length > 0) selectFiles(files);
  });
  sendFileButton.addEventListener('click', sendSelectedFiles);

  return { show, hide, handleMessage };
}