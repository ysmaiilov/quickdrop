// QuickDrop: телефондон сүрөт жөнөтүү (6-этап).
// Сүрөт сервер аркылуу эмес, WebRTC DataChannel аркылуу түз компьютерге өтөт.

// getPeer: учурдагы WebRTC байланышын кайтарган функция
function createImageSender({ getPeer }) {
  const statusCard = document.getElementById('statusCard');
  const imageButton = document.getElementById('imageBtn');
  const imageCard = document.getElementById('imageCard');
  const fileInput = document.getElementById('imageInput');
  const pickButton = document.getElementById('pickImageBtn');
  const previewBox = document.getElementById('imagePreview');
  const previewImage = document.getElementById('imagePreviewImg');
  const nameElement = document.getElementById('imageName');
  const sizeElement = document.getElementById('imageSize');
  const progressBox = document.getElementById('imageProgress');
  const progressBar = document.getElementById('imageProgressBar');
  const progressLabel = document.getElementById('imageProgressLabel');
  const messageElement = document.getElementById('imageMessage');
  const sendButton = document.getElementById('sendImageBtn');
  const backButton = document.getElementById('imageBackBtn');

  // Файл жөнөтүү модулу (transfer.js)
  const fileSender = createFileSender({ getPeer });

  let selectedFile = null;
  let previewUrl = null;
  let controller = null; // жөнөтүүнү токтотуу үчүн (AbortController)
    let canRetry = false; // жөнөтүү ийгиликсиз болду: "Кайра аракет кылуу" көрсөтөбүз

  // Ката түрлөрү жана алардын тексттери
  const ERROR_TEXTS = {
    not_connected: 'Байланыш жок. Компьютерден жаңы QR-код түзүп, кайра туташыңыз.',
    channel_closed: 'Байланыш үзүлдү. Компьютерден жаңы QR-код түзүп, кайра туташыңыз.',
    ack_timeout: 'Компьютер сүрөттү ырастаган жок. Байланышты текшериңиз.',
    busy: 'Башка өткөрүү жүрүп жатат. Аяктаганча күтүңүз.',
    receiver_error: 'Компьютер сүрөттү кабыл ала албады.',
    too_large: 'Сүрөт өтө чоң.',
    unsupported: 'Компьютер бул форматты кабыл албайт.',
    size_mismatch: 'Сүрөт толук жетпеди. Кайра аракет кылыңыз.',
        quota_exceeded: 'Компьютер бул байланыш үчүн көбүрөөк маалымат кабыл албайт. Жаңы байланыш түзүңүз.',
    timeout: 'Компьютер сүрөттү күтүп туруп токтотуп койду. Кайра аракет кылыңыз.',
    protocol_error: 'Сүрөт өткөрүүдө ката кетти. Кайра аракет кылыңыз.',
  };

  /* ----- Экрандын элементтери ----- */

  function showMessage(text, type) {
    messageElement.textContent = text;
    messageElement.className = `message message--${type}`;
    messageElement.hidden = false;
  }

  function clearMessage() {
    messageElement.hidden = true;
    messageElement.textContent = '';
  }

  // Кнопкалардын абалын жаңыртат
  function updateControls() {
    const busy = controller !== null;
    pickButton.disabled = busy;
    backButton.disabled = busy;
    sendButton.disabled = busy || !selectedFile;
    sendButton.textContent = busy ? 'Жөнөтүлүүдө...' : 'Жөнөтүү';
        sendButton.textContent = busy ? 'Жөнөтүлүүдө...' : canRetry ? 'Кайра аракет кылуу' : 'Жөнөтүү';
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

  /* ----- Сүрөт тандоо ----- */

  // Тандалган сүрөттү жана preview'ду тазалайт
  function clearSelection() {
    selectedFile = null;
        canRetry = false;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    previewImage.removeAttribute('src');
    previewBox.hidden = true;
    fileInput.value = ''; // ошол эле сүрөттү кайра тандаганга мүмкүндүк берет
    updateControls();
  }

  // Колдонуучу сүрөт тандаганда
  function handleFileChosen() {
    const file = fileInput.files[0];
    if (!file) return;

    clearMessage();
    hideProgress();

    if (!IMAGE_MIME_PATTERN.test(file.type)) {
      clearSelection();
      showMessage('Бул формат колдоого алынбайт. JPG, PNG, WEBP же GIF тандаңыз.', 'error');
      return;
    }
    if (file.size === 0) {
      clearSelection();
      showMessage('Файл бош экен. Башка сүрөт тандаңыз.', 'error');
      return;
    }
        if (file.size > MAX_IMAGE_BYTES) {
      clearSelection();
      showMessage(`Сүрөт өтө чоң. Максимум: ${formatFileSize(MAX_IMAGE_BYTES)}.`, 'error');
      return;
    }

    // Preview, аты жана өлчөмү
    clearSelection();
    selectedFile = file;
    previewUrl = URL.createObjectURL(file);
    previewImage.hidden = false;
    previewImage.onerror = () => {
      previewImage.hidden = true; // браузер форматты көрсөтө албаса
    };
    previewImage.src = previewUrl;
    nameElement.textContent = file.name;
    sizeElement.textContent = formatFileSize(file.size);
    previewBox.hidden = false;
    updateControls();
  }

  /* ----- Жөнөтүү ----- */

  async function send() {
    if (!selectedFile || controller) return;

    const file = selectedFile;
    const currentController = new AbortController();
    controller = currentController;

    clearMessage();
    showProgress(0, file.size);
    updateControls();

    try {
        await fileSender.sendFile(file, {
        kind: 'image',
        onProgress: showProgress,
        signal: currentController.signal,
      });
      showMessage('✓ Ийгиликтүү жөнөтүлдү', 'success');
      clearSelection();
    } catch (error) {
      // Экран жабылып же байланыш үзүлүп, өзүбүз токтоткон болсо, эч нерсе көрсөтпөйбүз
      if (currentController.signal.aborted) return;

      const text =
        ERROR_TEXTS[error.reason] ||
        ERROR_TEXTS[error.code] ||
        'Сүрөт жөнөтүлгөн жок. Кайра аракет кылыңыз.';
      showMessage(text, 'error');
            canRetry = true;
    } finally {
      controller = null;
      hideProgress();
      updateControls();
    }
  }

  /* ----- Экрандарды алмаштыруу ----- */

  // Туташкандан кийин "🖼️ Сүрөт" кнопкасын көрсөтөт
  function show() {
    imageButton.hidden = false;
  }

  // Баарын баштапкы абалга кайтарат (статус картасы гана көрүнөт)
  function hide() {
    if (controller) controller.abort(); // жөнөтүү жүрүп жатса, токтотобуз
    clearSelection();
    clearMessage();
    hideProgress();
    imageButton.hidden = true;
    imageCard.hidden = true;
    statusCard.hidden = false;
  }

  function open() {
    clearMessage();
    statusCard.hidden = true;
    imageCard.hidden = false;
  }

  function back() {
    clearSelection();
    clearMessage();
    imageCard.hidden = true;
    statusCard.hidden = false;
  }

  // Компьютерден келген билдирүү (мисалы "алдым" жообу)
  function handleMessage(message) {
    fileSender.handleMessage(message);
  }

  imageButton.addEventListener('click', open);
  pickButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileChosen);
  sendButton.addEventListener('click', send);
  backButton.addEventListener('click', back);

  return { show, hide, handleMessage };
}