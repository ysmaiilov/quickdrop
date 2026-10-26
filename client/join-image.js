// QuickDrop: телефондон сүрөт жөнөтүү (6-этап).
// Сүрөт сервер аркылуу эмес, WebRTC DataChannel аркылуу түз компьютерге өтөт.
// Бир нече сүрөттү тандаса болот: жөнөтүүдөн мурун ар бирин "✕" менен алып салса болот.

// getPeer: учурдагы WebRTC байланышын кайтарган функция
function createImageSender({ getPeer, onSent, onOpen, onClose }) {
  const statusCard = document.getElementById('statusCard');
  const imageButton = document.getElementById('imageBtn');
  const imageCard = document.getElementById('imageCard');
  const fileInput = document.getElementById('imageInput');
  const pickButton = document.getElementById('pickImageBtn');
  const listElement = document.getElementById('imageList');
  const progressBox = document.getElementById('imageProgress');
  const progressBar = document.getElementById('imageProgressBar');
  const progressLabel = document.getElementById('imageProgressLabel');
  const messageElement = document.getElementById('imageMessage');
  const sendButton = document.getElementById('sendImageBtn');
  const backButton = document.getElementById('imageBackBtn');

  // Файл жөнөтүү модулу (transfer.js)
  const fileSender = createFileSender({ getPeer });

  // Тандалган сүрөттөр (selection-list.js)
  const selection = createSelectionList({ list: listElement, onChange: () => updateControls() });

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
    const count = selection.count();
    pickButton.disabled = busy;
    backButton.disabled = busy;
    sendButton.disabled = busy || count === 0;
    if (busy) sendButton.textContent = 'Жөнөтүлүүдө...';
    else if (canRetry) sendButton.textContent = 'Кайра аракет кылуу';
    else sendButton.textContent = count > 1 ? `Жөнөтүү (${count})` : 'Жөнөтүү';
    selection.setLocked(busy);
  }

  // index/total: бир нече сүрөт болсо, "2/5" көрсөтөбүз
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

  /* ----- Сүрөт тандоо ----- */

  // Тандалган сүрөттөрдү тазалайт
  function clearSelection() {
    canRetry = false;
    fileInput.value = ''; // ошол эле сүрөттү кайра тандаганга мүмкүндүк берет
    selection.clear();
  }

  // Каталуу сүрөттү текшерет: ката тексти же null
  function validate(file) {
    if (!IMAGE_MIME_PATTERN.test(file.type)) return 'Бул формат колдоого алынбайт. JPG, PNG, WEBP же GIF тандаңыз.';
    if (file.size === 0) return 'Файл бош экен. Башка сүрөт тандаңыз.';
    if (file.size > MAX_IMAGE_BYTES) return `Сүрөт өтө чоң. Максимум: ${formatFileSize(MAX_IMAGE_BYTES)}.`;
    return null;
  }

  // Колдонуучу сүрөт(төр) тандаганда: туура келгендери тизмеге кошулат
  function handleFileChosen() {
    const files = Array.from(fileInput.files);
    fileInput.value = '';
    if (files.length === 0) return;

    clearMessage();
    hideProgress();
    canRetry = false;

    let firstError = null;
    let overflow = false;
    for (const file of files) {
      const error = validate(file);
      if (error) {
        firstError = firstError || error;
        continue;
      }
      if (!selection.add(file, 'image')) overflow = true;
    }

    if (overflow) showMessage(`Эң көп ${MAX_SELECTED_FILES} сүрөт тандаса болот.`, 'error');
    else if (firstError) showMessage(firstError, 'error');
    updateControls();
  }

  /* ----- Жөнөтүү ----- */

  // Тизмедеги сүрөттөрдү бирден-бирден жөнөтөт. Жөнөтүлгөнү тизмеден түшөт,
  // ката болсо токтойт жана калгандары "Кайра аракет кылуу" менен жөнөтүлөт.
  async function send() {
    if (selection.count() === 0 || controller) return;

    const currentController = new AbortController();
    controller = currentController;
    const queue = selection.items();
    const total = queue.length;

    clearMessage();
    canRetry = false;
    updateControls();

    try {
      for (let index = 0; index < total; index += 1) {
        const item = queue[index];
        showProgress(0, item.file.size, index + 1, total);
        await fileSender.sendFile(item.file, {
          kind: 'image',
          onProgress: (sent, size) => showProgress(sent, size, index + 1, total),
          signal: currentController.signal,
        });
        selection.drop(item);
        if (window.logSent) logSent('image');
      }
      // Ийгиликтүү болсо, түз башкы экранга кайтабыз (абал көрсөткүчү "Аяктады" дейт)
      back();
      if (onSent) onSent(total > 1 ? `✓ Сүрөттөр жөнөтүлдү: ${total}` : '✓ Сүрөт жөнөтүлдү');
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
    if (onOpen) onOpen();
  }

  function back() {
    clearSelection();
    clearMessage();
    imageCard.hidden = true;
    statusCard.hidden = false;
    if (onClose) onClose();
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

  return { show, hide, handleMessage, back, isBusy: () => controller !== null };
}