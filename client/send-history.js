// QuickDrop: жөнөтүү тарыхы.
// Эмне жөнөтүлгөнүн гана көрсөтөт: түрү (Текст / Сүрөт / Файл) жана убактысы.
// Тексттин мазмуну, файлдын аты жана өзү сакталбайт. Тарых бетте гана турат (сакталбайт),
// бет жаңыртылса же жаңы session башталса тазаланат.

const HISTORY_KINDS = {
  text: { icon: '📝', label: 'Текст' },
  image: { icon: '🖼️', label: 'Сүрөт' },
  file: { icon: '📄', label: 'Файл' },
};
const MAX_HISTORY_ITEMS = 100;

(function () {
  let entries = []; // { kind, time }

  function formatClock(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function render() {
    const list = document.getElementById('historyList');
    const empty = document.getElementById('historyEmpty');
    const count = document.getElementById('historyCount');
    if (!list || !empty || !count) return;

    list.replaceChildren();
    // Жаңысы жогоруда
    for (const entry of entries.slice().reverse()) {
      const kind = HISTORY_KINDS[entry.kind];
      const row = document.createElement('li');
      row.className = 'history__item';

      const icon = document.createElement('span');
      icon.className = 'history__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = kind.icon;

      const label = document.createElement('span');
      label.className = 'history__label';
      label.textContent = kind.label;

      const time = document.createElement('span');
      time.className = 'history__time';
      time.setAttribute('data-no-i18n', '');
      time.textContent = formatClock(entry.time);

      row.append(icon, label, time);
      list.append(row);
    }

    empty.hidden = entries.length > 0;
    count.textContent = entries.length > 0 ? `(${entries.length})` : '';
  }

  // kind: 'text' | 'image' | 'file'. Ийгиликтүү жөнөтүлгөндө чакырылат.
  window.logSent = function logSent(kind) {
    if (!HISTORY_KINDS[kind]) return;
    entries.push({ kind, time: new Date() });
    if (entries.length > MAX_HISTORY_ITEMS) entries = entries.slice(-MAX_HISTORY_ITEMS);
    render();
  };

  window.clearSendHistory = function clearSendHistory() {
    entries = [];
    render();
  };
})();
