// QuickDrop: телефондон жалпы файл жөнөтүү (7-этап).
// PDF, DOC, XLSX, ZIP, TXT жана башка файлдар WebRTC DataChannel аркылуу
// түз компьютерге өтөт.

// getPeer: учурдагы WebRTC байланышын кайтарган функция
function createFileScreen({ getPeer }) {
  const statusCard = document.getElementById('statusCard');
  const fileButton = document.getElementById('fileBtn');
  const fileCard = document.getElementById('fileCard');
  const fileInput = document.getElementById('fileInput');
  const pickButton = document.getElementById('pickFileBtn');
  const infoBox = document.getElementById('fileInfo');
  const iconElement = document.getElementById('fileIcon');
  const nameElement = document.getElementById('fileName');
  const sizeElement = document.getElementById('fileSize');
  const progressBox = document.getElementById('fileProgress');
  const progressBar = document.getElementById('fileProgressBar');
  const progressLabel = document.getElementById('fileProgressLabel');
  const messageElement = document.getElementById('fileMessage');
  const sendButton = document.getElementById('sendFileBtn');
  const backButton = document.getElementById('fileBackBtn');

  // Файл жөнөтүү модулу (transfer.js)
  const fileSender = createFileSender({ getPeer });

  let selectedFile = null;
  let controller = null; // жөнөтүүнү токтотуу үчүн (AbortController)
    let canRetry = false; // жөнөтүү ийгиликсиз болду: "Кайра аракет кылуу" көрсөтөбүз

  // Ката түрлөрү жана алардын тексттери
  const ERROR_TEXTS = {
    not_connected: 'Байланыш жок. Компьютерден жаңы QR-код түзүп, кайра туташыңыз.',
    channel_closed: 'Байланыш үзүлдү. Компьютерден жаңы QR-код түзүп, кайра туташыңыз.',
    ack_timeout: 'Компьютер файлды ырастаган жок. Байланышты текшериңиз.',
    busy: 'Башка өткөрүү жүрүп жатат. Аяктаганча күтүңүз.',
    receiver_error: 'Компьютер файлды кабыл ала албады.',
    too_large: 'Файл өтө чоң.',
    size_mismatch: 'Файл толук жетпеди. Кайра аракет кылыңыз.',
    blocked_type: 'Бул файл түрү коопсуздук үчүн бөгөттөлгөн (программа файлдары жөнөтүлбөйт).',
    quota_exceeded: 'Компьютер бул байланыш үчүн көбүрөөк файл кабыл албайт. Жаңы байланыш түзүңүз.',
    timeout: 'Компьютер файлды күтүп туруп токтотуп койду. Кайра аракет кылыңыз.',
    protocol_error: 'Файл өткөрүүдө ката кетти. Кайра аракет кылыңыз.',
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

  /* ----- Файл тандоо ----- */

  // Тандалган файлды тазалайт
  function clearSelection() {
    selectedFile = null;
        canRetry = false;
    infoBox.hidden = true;
    fileInput.value = ''; // ошол эле файлды кайра тандаганга мүмкүндүк берет
    updateControls();
  }

  // Колдонуучу файл тандаганда
  function handleFileChosen() {
    const file = fileInput.files[0];
    if (!file) return;

    clearMessage();
    hideProgress();
    clearSelection();

    if (file.size === 0) {
      showMessage('Файл бош экен. Башка файл тандаңыз.', 'error');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showMessage(`Файл өтө чоң. Максимум: ${formatFileSize(MAX_FILE_BYTES)}.`, 'error');
      return;
    }
        if (isBlockedFileName(file.name)) {
      showMessage('Бул файл түрү коопсуздук үчүн бөгөттөлгөн (программа файлдары жөнөтүлбөйт).', 'error');
      return;
    }

    // Аты, көлөмү жана иконкасы
    selectedFile = file;
    iconElement.textContent = getFileIcon(file.name);
    nameElement.textContent = file.name;
    sizeElement.textContent = formatFileSize(file.size);
    infoBox.hidden = false;
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
        kind: 'file',
        onProgress: showProgress,
        signal: currentController.signal,
      });
      // Ийгиликтүү болсо, түз башкы экранга кайтабыз (абал көрсөткүчү "Аяктады" дейт)
      back();
    } catch (error) {
      // Экран жабылып же байланыш үзүлүп, өзүбүз токтоткон болсо, эч нерсе көрсөтпөйбүз
      if (currentController.signal.aborted) return;

      const text =
        ERROR_TEXTS[error.reason] ||
        ERROR_TEXTS[error.code] ||
        'Файл жөнөтүлгөн жок. Кайра аракет кылыңыз.';
      showMessage(text, 'error');
            canRetry = true;
    } finally {
      controller = null;
      hideProgress();
      updateControls();
    }
  }

  /* ----- Экрандарды алмаштыруу ----- */

  // Туташкандан кийин "📄 Файл" кнопкасын көрсөтөт
  function show() {
    fileButton.hidden = false;
  }

  // Баарын баштапкы абалга кайтарат (статус картасы гана көрүнөт)
  function hide() {
    if (controller) controller.abort(); // жөнөтүү жүрүп жатса, токтотобуз
    clearSelection();
    clearMessage();
    hideProgress();
    fileButton.hidden = true;
    fileCard.hidden = true;
    statusCard.hidden = false;
  }

  function open() {
    clearMessage();
    statusCard.hidden = true;
    fileCard.hidden = false;
  }

  function back() {
    clearSelection();
    clearMessage();
    fileCard.hidden = true;
    statusCard.hidden = false;
  }

  // Компьютерден келген билдирүү (мисалы "алдым" жообу)
  function handleMessage(message) {
    fileSender.handleMessage(message);
  }

  fileButton.addEventListener('click', open);
  pickButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileChosen);
  sendButton.addEventListener('click', send);
  backButton.addEventListener('click', back);

  return { show, hide, handleMessage };
}