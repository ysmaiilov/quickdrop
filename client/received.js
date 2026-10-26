// QuickDrop: компьютерде телефондон келген маалыматты көрсөтүү (текст, сүрөт, файл).
// 9-этап: келген маалымат ишенимсиз деп эсептелет: аттар тазаланат, лимиттер текшерилет.

const MAX_RECEIVED_TEXT_LENGTH = 20000; // ашыкча чоң текстти кабыл албайбыз
const MAX_RECEIVED_TEXTS = 200; // бир session'до эң көп текст
const MAX_SESSION_RECEIVE_BYTES = 500 * 1024 * 1024; // бир session'до жалпы алынган файлдар: 500 MB
const STATUS_VISIBLE_MS = 3000; // билдирүү канча секунд көрүнөт

// Билдирүүлөрдө колдонулган сөздөр (сүрөт же файл)
const KIND_WORDS = {
  image: { name: 'Сүрөт', accusative: 'Сүрөттү' },
  file: { name: 'Файл', accusative: 'Файлды' },
};

// Алуу катасынын тексти
function getReceiveErrorText(kind, reason) {
  const word = KIND_WORDS[kind] || KIND_WORDS.file;
  if (reason === 'cancelled') return `${word.name} жөнөтүү токтотулду.`;
  if (reason === 'timeout') return `${word.name} келбей калды (жөнөтүүчү жооп бербей калды).`;
  if (reason === 'interrupted' || reason === 'size_mismatch' || reason === 'protocol_error') {
    return `${word.name} толук келген жок. Кайра аракет кылыңыз.`;
  }
  return `${word.accusative} алуу ийгиликсиз болду.`;
}

// send: телефонго JSON билдирүү жөнөтүүчү функция (true/false кайтарат)
// ids: HTML элементтеринин id'лери (компьютер үчүн демейки, телефон өзүнүкүн берет)
// maxFileBytes: бир файлдын эң чоң көлөмү (телефондо азыраак)
function createReceiver({ send, ids = {}, maxFileBytes = MAX_FILE_BYTES }) {
  const elementIds = {
    section: 'received',
    status: 'receivedStatus',
    list: 'receivedList',
    progress: 'receiveProgress',
    progressName: 'receiveProgressName',
    progressBar: 'receiveProgressBar',
    progressLabel: 'receiveProgressLabel',
    ...ids,
  };

  const section = document.getElementById(elementIds.section);
  const statusElement = document.getElementById(elementIds.status);
  const listElement = document.getElementById(elementIds.list);
  const progressBox = document.getElementById(elementIds.progress);
  const progressName = document.getElementById(elementIds.progressName);
  const progressBar = document.getElementById(elementIds.progressBar);
  const progressLabel = document.getElementById(elementIds.progressLabel);

  let statusTimer = null;
  let lastPercent = -1;
  let totalReceivedBytes = 0; // бул session'до алынган файлдардын жалпы көлөмү
  let textCount = 0; // бул session'до алынган тексттердин саны
  const objectUrls = []; // түзүлгөн blob даректери (кийин бошотобуз)

  // Файл алуу модулу (transfer.js)
  const fileReceiver = createFileReceiver({
    send,
    accept: acceptFile,
    onStart: handleFileStart,
    onProgress: handleFileProgress,
    onComplete: handleFileComplete,
    onError: handleFileError,
  });

  // Кандай файлдарды кабыл алабыз? Макул болсо null, болбосо себеби.
  // Бул текшерүү компьютерде жасалат: телефондун текшерүүсүнө ишенбейбиз.
  function acceptFile(meta) {
    if (totalReceivedBytes + meta.size > MAX_SESSION_RECEIVE_BYTES) {
      showStatus('⚠️ Бул session үчүн көлөм чеги толду. Жаңы байланыш түзүңүз.', 'error');
      return 'quota_exceeded';
    }
    if (meta.size > maxFileBytes) return 'too_large';
    if (meta.kind === 'image') {
      if (!IMAGE_MIME_PATTERN.test(meta.mime)) return 'unsupported';
      if (meta.size > MAX_IMAGE_BYTES) return 'too_large';
      return null;
    }

    // Программа катары иштеп кетиши мүмкүн файлдар бөгөттөлөт
    if (isBlockedFileName(meta.name)) {
      showStatus('⚠️ Коопсуздук үчүн программа файлы кабыл алынган жок.', 'error');
      return 'blocked_type';
    }
    return null;
  }

  /* ----- Блокту көрсөтүү / жашыруу ----- */

  function show() {
    section.hidden = false;
  }

  // Баарын тазалап, жашырат (session жабылганда)
  function reset() {
    fileReceiver.cancel();
    clearTimeout(statusTimer);
    statusElement.hidden = true;
    hideProgress();
    listElement.replaceChildren();
    objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    totalReceivedBytes = 0;
    textCount = 0;
    section.hidden = true;
  }

  // Кыска убакытка билдирүү көрсөтөт (type: 'success' же 'error')
  function showStatus(text, type = 'success') {
    clearTimeout(statusTimer);
    statusElement.textContent = text;
    statusElement.className = `message message--${type}`;
    statusElement.hidden = false;
    statusTimer = setTimeout(() => {
      statusElement.hidden = true;
    }, STATUS_VISIBLE_MS);
  }

  /* ----- Прогресс ----- */

  function hideProgress() {
    progressBox.hidden = true;
    progressBar.style.width = '0%';
    lastPercent = -1;
  }

  function handleFileStart(meta) {
    progressName.textContent = `📥 ${makeSafeFileName(meta.name, 'file')} · ${formatFileSize(meta.size)}`;
    progressBar.style.width = '0%';
    progressLabel.textContent = `0% · 0 B / ${formatFileSize(meta.size)}`;
    progressBox.hidden = false;
    lastPercent = -1;
  }

  function handleFileProgress(meta, received) {
    const percent = Math.floor((received / meta.size) * 100);
    if (percent === lastPercent) return; // DOM'ду ашыкча жаңыртпайбыз
    lastPercent = percent;

    progressBar.style.width = `${percent}%`;
    progressLabel.textContent =
      `${percent}% · ${formatFileSize(received)} / ${formatFileSize(meta.size)}`;
  }

  /* ----- Файл келди ----- */

  function handleFileComplete(file) {
    hideProgress();
    totalReceivedBytes += file.size;

    const url = URL.createObjectURL(file.blob);
    objectUrls.push(url);

    if (file.kind === 'image') {
      addImage(file, url);
      showStatus('✓ Сүрөт алынды');
    } else {
      addFile(file, url);
      showStatus('✓ Файл ийгиликтүү алынды');
    }
  }

  function handleFileError(meta, reason) {
    hideProgress();
    showStatus(`⚠️ ${getReceiveErrorText(meta.kind, reason)}`, 'error');
  }

  // "Сактоо" шилтемеси: браузердин өзүнүн жүктөө механизми, сервер керек эмес
  function createSaveLink(url, fileName) {
    const saveLink = document.createElement('a');
    saveLink.className = 'received__copy';
    saveLink.href = url;
    saveLink.download = fileName;
    saveLink.textContent = 'Сактоо';
    return saveLink;
  }

  // Сүрөттү PNG кылат: алмашуу буферине браузерлер PNG'ни гана ишенимдүү кабыл алат
  function toPngBlob(blob) {
    if (blob.type === 'image/png') return Promise.resolve(blob);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('png_failed'))), 'image/png');
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode_failed'));
      };
      image.src = url;
    });
  }

  // "Көчүрүү" кнопкасы: сүрөттү алмашуу буферине салат
  function createImageCopyButton(blob) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'received__copy';
    button.textContent = 'Көчүрүү';

    const flash = (text) => {
      button.textContent = text;
      setTimeout(() => {
        button.textContent = 'Көчүрүү';
      }, 1500);
    };

    button.addEventListener('click', async () => {
      try {
        // Safari колдонуучунун басуусунан кийин гана жазууга уруксат берет: promise'ти түз беребиз
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPngBlob(blob) })]);
        flash('✓ Көчүрүлдү');
      } catch (error) {
        flash('Көчүрүү мүмкүн эмес');
      }
    });
    return button;
  }

  // Тизменин башына сүрөттү preview жана "Сактоо" кнопкасы менен кошот
  function addImage(file, url) {
    // Сактоо аты сүрөттүн чыныгы түрүнө ылайык болот (virus.exe -> virus.png)
    const safeName = makeSafeImageName(file.name, file.mime);

    const item = document.createElement('li');
    item.className = 'received__item';

    const image = document.createElement('img');
    image.className = 'received__image';
    image.src = url;
    image.alt = safeName;
    // Браузер форматты көрсөтө албаса (мисалы HEIC), preview'ду жашырабыз
    image.addEventListener('error', () => {
      image.hidden = true;
    });

    const meta = document.createElement('p');
    meta.className = 'received__meta';
    meta.textContent = `${safeName} · ${formatFileSize(file.size)}`;

    const actions = document.createElement('div');
    actions.className = 'received__actions';
    actions.append(createImageCopyButton(file.blob), createSaveLink(url, safeName));

    item.append(image, meta, actions);
    listElement.prepend(item);
  }

  // Тизменин башына файлды аты, көлөмү жана "Сактоо" кнопкасы менен кошот
  function addFile(file, url) {
    const safeName = makeSafeFileName(file.name, 'file');

    const item = document.createElement('li');
    item.className = 'received__item';

    const row = document.createElement('div');
    row.className = 'received__file';

    const icon = document.createElement('span');
    icon.className = 'received__file-icon';
    icon.textContent = getFileIcon(safeName);

    const info = document.createElement('div');

    // textContent колдонобуз: файлдын аты HTML катары иштебейт (коопсуздук)
    const nameElement = document.createElement('p');
    nameElement.className = 'received__file-name';
    nameElement.textContent = safeName;

    const meta = document.createElement('p');
    meta.className = 'received__meta';
    meta.textContent = formatFileSize(file.size);

    info.append(nameElement, meta);
    row.append(icon, info);

    item.append(row, createSaveLink(url, safeName));
    listElement.prepend(item);
  }

  /* ----- Текст келди ----- */

  // Текстти алмашуу буферине көчүрөт
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Эски жол: clipboard API иштебесе (мисалы http дарек аркылуу ачылса)
      const helper = document.createElement('textarea');
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
  }

  // Тизменин башына жаңы текст кошот
  function addText(text) {
    const item = document.createElement('li');
    item.className = 'received__item';

    // textContent колдонобуз: келген текст HTML катары иштебейт (коопсуздук)
    const textElement = document.createElement('p');
    textElement.className = 'received__text';
    textElement.textContent = text;

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'received__copy';
    copyButton.textContent = 'Көчүрүү';
    copyButton.addEventListener('click', async () => {
      await copyText(text);
      copyButton.textContent = '✓ Көчүрүлдү';
      setTimeout(() => {
        copyButton.textContent = 'Көчүрүү';
      }, 1500);
    });

    item.append(textElement, copyButton);
    listElement.prepend(item);
  }

  /* ----- Кирүүчү билдирүүлөр ----- */

  // Телефондон келген JSON билдирүү
  function handleMessage(message) {
    // Алгач файл протоколуна тиешелүүбү, ошону текшеребиз
    if (fileReceiver.handleMessage(message)) return;

    if (message.type === 'text' && typeof message.text === 'string') {
      if (message.text.length > MAX_RECEIVED_TEXT_LENGTH) return;
      if (textCount >= MAX_RECEIVED_TEXTS) {
        showStatus('⚠️ Бул session үчүн тексттердин чеги толду.', 'error');
        return;
      }

      textCount += 1;
      addText(message.text);
      showStatus('✓ Текст алынды');
      reportTransferStatus('completed', { name: 'Текст' });
      send({ type: 'text:received' }); // телефонго "алдым" деп билдиребиз
    }
  }

  // Телефондон келген бинардык бөлүк (файлдын бир бөлүгү)
  function handleBinary(buffer) {
    fileReceiver.handleBinary(buffer);
  }

  // Файл алынып жатабы? (байланыш үзүлгөндө эскертүү үчүн)
  function isReceiving() {
    return fileReceiver.isActive();
  }

  return { show, reset, handleMessage, handleBinary, isReceiving };
}