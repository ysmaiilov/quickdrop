// QuickDrop: жөнөтүү үчүн тандалган файлдардын тизмеси.
// Ар бир элементтин жогорку оң бурчунда "✕" кнопкасы бар: жөнөтүүдөн мурун каалаганын алып салса болот.
// Эки бетте тең колдонулат (телефондун сүрөт экраны жана компьютердин жөнөтүү панели).

const MAX_SELECTED_FILES = 20; // бир жолу эң көп тандалуучу файлдардын саны

// list: <ul> элементи, onChange(items): тизме өзгөргөндө чакырылат
function createSelectionList({ list, onChange }) {
  let items = []; // { file, kind, url }

  function sameFile(a, b) {
    return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  }

  function render() {
    list.replaceChildren();

    for (const item of items) {
      const row = document.createElement('li');
      row.className = 'sel-item';

      if (item.url) {
        const thumb = document.createElement('img');
        thumb.className = 'sel-item__thumb';
        thumb.src = item.url;
        thumb.alt = '';
        thumb.addEventListener('error', () => {
          thumb.hidden = true; // браузер форматты көрсөтө албаса (мисалы HEIC)
        });
        row.append(thumb);
      } else {
        const icon = document.createElement('span');
        icon.className = 'sel-item__icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = getFileIcon(item.file.name);
        row.append(icon);
      }

      // Файлдын аты ишенимсиз текст: которулбайт жана HTML катары иштебейт (textContent)
      const info = document.createElement('div');
      info.className = 'sel-item__info';
      info.setAttribute('data-no-i18n', '');
      const name = document.createElement('p');
      name.className = 'sel-item__name';
      name.textContent = item.file.name;
      const size = document.createElement('p');
      size.className = 'sel-item__size';
      size.textContent = formatFileSize(item.file.size);
      info.append(name, size);
      row.append(info);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sel-item__remove';
      remove.title = 'Өчүрүү';
      remove.setAttribute('aria-label', 'Өчүрүү');
      remove.textContent = '✕';
      remove.addEventListener('click', () => removeItem(item));
      row.append(remove);

      list.append(row);
    }

    list.hidden = items.length === 0;
    if (onChange) onChange(items);
  }

  // Кошуу: сүрөт болсо preview жасалат. Кайталанган файл кошулбайт.
  // Толуп калса false кайтарат.
  function add(file, kind) {
    if (items.some((item) => sameFile(item.file, file))) return true;
    if (items.length >= MAX_SELECTED_FILES) return false;
    items.push({ file, kind, url: kind === 'image' ? URL.createObjectURL(file) : null });
    render();
    return true;
  }

  function release(item) {
    if (item.url) URL.revokeObjectURL(item.url);
  }

  function removeItem(item) {
    if (list.classList.contains('sel-list--locked')) return;
    release(item);
    items = items.filter((candidate) => candidate !== item);
    render();
  }

  // Жөнөтүлгөн файлды тизмеден алып салат (жөнөтүү учурунда да иштейт)
  function drop(item) {
    release(item);
    items = items.filter((candidate) => candidate !== item);
    render();
  }

  function clear() {
    items.forEach(release);
    items = [];
    render();
  }

  // Жөнөтүү жүрүп жатканда "✕" жашырылат
  function setLocked(locked) {
    list.classList.toggle('sel-list--locked', locked);
  }

  return {
    add,
    drop,
    clear,
    setLocked,
    items: () => items.slice(),
    count: () => items.length,
  };
}
