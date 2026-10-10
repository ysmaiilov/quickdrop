// QuickDrop: байланыш жана өткөрүү абалынын көрсөткүчү (11-этап: дизайн).
// Эки бетте тең жогоруда түстүү белги көрсөтөт:
// Күтүүдө, Туташууда, Туташты, Жөнөтүлүүдө, Алынууда, Аяктады, Ката, Байланыш үзүлдү.
// Дизайн үчүн абал html элементтеринин data-state атрибутуна да жазылат:
//   - белгинин өзүнө: учурдагы абал (убактылуу да)
//   - <body>: туруктуу абал (байланыш абалы), бүт бетти боёо үчүн

const STATUS_STATES = {
  waiting: { icon: '⏳', label: 'Күтүүдө', tone: 'neutral' },
  connecting: { icon: '🔄', label: 'Туташууда', tone: 'progress' },
  connected: { icon: '🟢', label: 'Туташты', tone: 'success' },
  sending: { icon: '📤', label: 'Жөнөтүлүүдө', tone: 'progress' },
  receiving: { icon: '📥', label: 'Алынууда', tone: 'progress' },
  completed: { icon: '✅', label: 'Аяктады', tone: 'success' },
  failed: { icon: '❌', label: 'Ката', tone: 'error' },
  disconnected: { icon: '🔌', label: 'Байланыш үзүлдү', tone: 'error' },
};

const COMPLETED_VISIBLE_MS = 3000; // "Аяктады" канча секунд көрүнөт
const FAILED_VISIBLE_MS = 5000; // өткөрүү катасы канча секунд көрүнөт

function createStatusBadge() {
  const element = document.getElementById('statusBadge');
  const iconElement = document.getElementById('statusBadgeIcon');
  const textElement = document.getElementById('statusBadgeText');
  const spinnerElement = document.getElementById('statusBadgeSpinner');

  let baseState = 'waiting'; // туруктуу абал (байланыш абалы)
  let baseDetail = '';
  let revertTimer = null;

  // Белгини чийет
  function render(stateKey, detail) {
    const state = STATUS_STATES[stateKey] || STATUS_STATES.waiting;
    element.dataset.tone = state.tone;
    element.dataset.state = stateKey;
    iconElement.textContent = state.icon;
    textElement.textContent = detail ? `${state.label} · ${detail}` : state.label;
    spinnerElement.hidden = state.tone !== 'progress'; // жүктөө абалында айлануучу белги
  }

  // Туруктуу абал: байланыштын абалы (убактылуу абал аны басып калбайт)
  function set(stateKey, detail = '') {
    clearTimeout(revertTimer);
    baseState = stateKey;
    baseDetail = detail;
    document.body.dataset.state = stateKey;
    render(stateKey, detail);
  }

  // Убактылуу абал: өткөрүү учурунда. ms > 0 болсо, ошол убакыттан кийин
  // туруктуу абалга өзү кайтат.
  function transient(stateKey, detail = '', ms = 0) {
    clearTimeout(revertTimer);
    render(stateKey, detail);
    if (ms > 0) {
      revertTimer = setTimeout(() => render(baseState, baseDetail), ms);
    }
  }

  // Убактылуу абалды алып салып, туруктуу абалга кайтат
  function restore() {
    clearTimeout(revertTimer);
    render(baseState, baseDetail);
  }

  document.body.dataset.state = baseState;
  render(baseState, baseDetail);
  return { set, transient, restore };
}

// transfer.js'тен келген өткөрүү окуяларын белгиге байлайт
function bindTransferStatus(badge) {
  onTransferStatus((status, detail) => {
    const name = detail.name || '';

    switch (status) {
      case 'sending':
        badge.transient('sending', name);
        break;
      case 'receiving':
        badge.transient('receiving', name);
        break;
      case 'completed':
        badge.transient('completed', name, COMPLETED_VISIBLE_MS);
        break;
      case 'failed':
        badge.transient('failed', name, FAILED_VISIBLE_MS);
        break;
      default: // 'cancelled': өткөрүү токтоду, мурунку абалга кайтабыз
        badge.restore();
        break;
    }
  });
}