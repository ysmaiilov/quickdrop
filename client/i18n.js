// QuickDrop: тилдер (ky / ru / en).
// Негизги тил: кыргызча. Сөздүктө ачкыч = кыргызча текст, мааниси = [орусча, англисче].
// Башка JS файлдар текстти эски жол менен (textContent = 'кыргызча текст') коё берет:
// бул файл DOM'ду байкап, тандалган тилге автоматтык которот (MutationObserver).
// Которулбай турган жерлер (колдонуучунун тексти, файл аттары): data-no-i18n атрибуту бар элемент.
//
// Ачкычта {аты} болсо, ал шаблон: "Калган убакыт: {time}" -> "Осталось времени: {time}".

(function () {
  'use strict';

  const LANGS = ['ky', 'ru', 'en'];
  const STORAGE_KEY = 'quickdrop.lang';

  const DICT = {
    // ----- Жалпы / абал белгиси -----
    'Күтүүдө': ['Ожидание', 'Waiting'],
    'Туташууда': ['Подключение', 'Connecting'],
    'Туташты': ['Подключено', 'Connected'],
    'Жөнөтүлүүдө': ['Отправка', 'Sending'],
    'Алынууда': ['Получение', 'Receiving'],
    'Аяктады': ['Готово', 'Done'],
    'Ката': ['Ошибка', 'Error'],
    'Байланыш үзүлдү': ['Связь прервана', 'Disconnected'],
    '{label} · {detail}': ['{label} · {detail}', '{label} · {detail}'],
    '⚠️ {text}': ['⚠️ {text}', '⚠️ {text}'],

    // ----- Компьютер: башкы экран -----
    '📱 Телефонду туташтырыңыз': ['📱 Подключите телефон', '📱 Connect your phone'],
    'QR-код 2 мүнөт жарактуу': ['QR-код действует 2 минуты', 'The QR code is valid for 2 minutes'],
    'QR-код': ['QR-код', 'QR code'],
    'Телефондун камерасын ачыңыз': ['Откройте камеру телефона', 'Open your phone camera'],
    'Камераны QR-кодго багыттаңыз': ['Наведите камеру на QR-код', 'Point the camera at the QR code'],
    'Компьютерде': ['На компьютере нажмите', 'On the computer, press'],
    'Уруксат берүү': ['Разрешить', 'Allow'],
    'басыңыз': ['', ''],
    'Жаңы QR-код': ['Новый QR-код', 'New QR code'],
    'Баш тартуу': ['Отклонить', 'Decline'],
    'Байланышты үзүү': ['Отключиться', 'Disconnect'],
    'Байланышты үзгүңүз келеби?': ['Хотите отключиться?', 'Do you want to disconnect?'],
    'Туташууда...': ['Подключение...', 'Connecting...'],
    'Телефон туташты': ['Телефон подключён', 'Phone connected'],
    '🔒 Коопсуз байланыш': ['🔒 Безопасное соединение', '🔒 Secure connection'],
    '⚡ Катталуу талап кылынбайт': ['⚡ Регистрация не нужна', '⚡ No sign-up required'],
    'QR-код түзүлүүдө...': ['Создаётся QR-код...', 'Creating QR code...'],
    'Телефон күтүлүүдө': ['Ожидание телефона', 'Waiting for the phone'],
    'Телефон уруксат сурап жатат': ['Телефон запрашивает разрешение', 'The phone is asking for permission'],
    'Телефон туташууну сурап жатат': ['Телефон запрашивает подключение', 'The phone wants to connect'],
    'Бул код телефонуңузда да көрүнүп жатабы? Эгер сиз сканерлеген жок болсоңуз, баш тартыңыз.': [
      'Этот код виден и на телефоне? Если вы не сканировали QR-код, отклоните запрос.',
      'Is the same code shown on your phone? If you did not scan the QR code, decline.',
    ],
    'Уруксат берилди': ['Разрешение дано', 'Permission granted'],
    'Түз байланыш түзүлүүдө...': ['Устанавливается прямое соединение...', 'Setting up a direct connection...'],
    'Телефон менен түз байланыш даяр': ['Прямое соединение с телефоном готово', 'Direct connection with the phone is ready'],
    'Калган убакыт: {time}': ['Осталось: {time}', 'Time left: {time}'],
    'Жооп берүүгө калды: {time}': ['Осталось на ответ: {time}', 'Time left to respond: {time}'],

    // ----- Компьютер: билдирүүлөр -----
    'Бул session жабылган. Жаңы QR-код түзүңүз.': ['Эта сессия закрыта. Создайте новый QR-код.', 'This session is closed. Create a new QR code.'],
    'Session жабылган': ['Сессия закрыта', 'Session closed'],
    'Өтө көп аракет': ['Слишком много попыток', 'Too many attempts'],
    'Өтө көп аракет болду. Бир аз күтүп, кайра аракет кылыңыз.': ['Слишком много попыток. Подождите немного и повторите.', 'Too many attempts. Wait a moment and try again.'],
    'Байланыш түзүлгөн жок': ['Соединение не установлено', 'Connection failed'],
    'Байланыш түзүлгөн жок. Эки түзмөк бир Wi-Fi тармагында экенин текшерип, жаңы QR-код менен кайра аракет кылыңыз.': [
      'Соединение не установлено. Убедитесь, что оба устройства в одной сети Wi-Fi, и повторите с новым QR-кодом.',
      'Connection failed. Make sure both devices are on the same Wi-Fi network and try again with a new QR code.',
    ],
    'Байланыш үзүлдү. Кайра туташуу үчүн жаңы QR-код түзүңүз.': ['Связь прервана. Чтобы подключиться снова, создайте новый QR-код.', 'The connection was lost. Create a new QR code to reconnect.'],
    '{msg} Жарым-жартылай алынган файл сакталган жок.': ['{msg} Частично полученный файл не сохранён.', '{msg} The partially received file was not saved.'],
    'QR-коддун мөөнөтү бүттү': ['Срок действия QR-кода истёк', 'The QR code has expired'],
    'QR-коддун мөөнөтү бүттү. Жаңы QR-код түзүү үчүн төмөнкү кнопканы басыңыз.': [
      'Срок действия QR-кода истёк. Нажмите кнопку ниже, чтобы создать новый.',
      'The QR code has expired. Press the button below to create a new one.',
    ],
    'Серверге байланыш үзүлдү. Жаңы QR-код түзүп көрүңүз.': ['Связь с сервером прервана. Создайте новый QR-код.', 'The connection to the server was lost. Create a new QR code.'],
    'Байланыш үзүлдү. Телефон байланышты үздү. Кайра туташуу үчүн жаңы QR-код түзүңүз.': [
      'Связь прервана. Телефон отключился. Чтобы подключиться снова, создайте новый QR-код.',
      'Disconnected. The phone ended the connection. Create a new QR code to reconnect.',
    ],
    'Уруксат убагында берилген жок. Жаңы QR-код түзүңүз.': ['Разрешение не дано вовремя. Создайте новый QR-код.', 'Permission was not given in time. Create a new QR code.'],
    'Туташуу өтүнүчү четке кагылды. Кайра туташуу үчүн жаңы QR-код түзүңүз.': ['Запрос на подключение отклонён. Чтобы подключиться снова, создайте новый QR-код.', 'The connection request was declined. Create a new QR code to reconnect.'],
    'Серверге туташуу мүмкүн болгон жок. Серверди текшерип, кайра аракет кылыңыз.': ['Не удалось подключиться к серверу. Проверьте сервер и повторите.', 'Could not reach the server. Check the server and try again.'],
    'Session түзүлгөн жок': ['Сессия не создана', 'Session was not created'],

    // ----- Компьютер → Телефон / Телефон → Компьютер -----
    'Телефон → Компьютер': ['Телефон → Компьютер', 'Phone → Computer'],
    'Компьютер → Телефон': ['Компьютер → Телефон', 'Computer → Phone'],
    '📱 Телефон → 💻 Компьютер': ['📱 Телефон → 💻 Компьютер', '📱 Phone → 💻 Computer'],
    'Телефондон келген маалымат': ['Данные с телефона', 'Received from the phone'],
    'Компьютерден келген маалымат': ['Данные с компьютера', 'Received from the computer'],
    'Телефонго жөнөтүү': ['Отправить на телефон', 'Send to the phone'],
    'Телефондон жөнөтүлгөн текст, сүрөт жана файлдар ушул жерде көрүнөт': [
      'Текст, изображения и файлы с телефона появятся здесь',
      'Text, images and files sent from the phone will appear here',
    ],
    'Компьютерден жөнөтүлгөн текст, сүрөт жана файлдар ушул жерде көрүнөт': [
      'Текст, изображения и файлы с компьютера появятся здесь',
      'Text, images and files sent from the computer will appear here',
    ],
    'Жөнөтүү түрү': ['Что отправить', 'What to send'],
    'Текст': ['Текст', 'Text'],
    'Сүрөт': ['Фото', 'Image'],
    'Файл': ['Файл', 'File'],
    'Телефонго жөнөтүлө турган текст': ['Текст для отправки на телефон', 'Text to send to the phone'],
    'Телефонго жөнөтө турган текстти жазыңыз...': ['Введите текст для отправки на телефон...', 'Type the text to send to the phone...'],
    'Текст жөнөтүү': ['Отправить текст', 'Send text'],
    'Файлды ушул жерге сүйрөп таштаңыз': ['Перетащите файл сюда', 'Drag a file here'],
    'Сүрөттү ушул жерге сүйрөп таштаңыз же Ctrl+V менен коюңуз': ['Перетащите фото сюда или вставьте через Ctrl+V', 'Drag an image here or paste it with Ctrl+V'],
    'же': ['или', 'or'],
    'Файл тандоо': ['Выбрать файл', 'Choose a file'],
    'Сүрөт тандоо': ['Выбрать фото', 'Choose an image'],
    'Жөнөтүү': ['Отправить', 'Send'],
    'Жөнөтүлүүдө...': ['Отправка...', 'Sending...'],
    'Кайра аракет кылуу': ['Повторить', 'Try again'],
    '✓ Ийгиликтүү жөнөтүлдү': ['✓ Успешно отправлено', '✓ Sent successfully'],
    '✓ Текст жөнөтүлдү': ['✓ Текст отправлен', '✓ Text sent'],
    '✓ Сүрөт жөнөтүлдү': ['✓ Фото отправлено', '✓ Image sent'],
    '✓ Файл жөнөтүлдү': ['✓ Файл отправлен', '✓ File sent'],
    '✓ Сүрөттөр жөнөтүлдү: {count}': ['✓ Фото отправлено: {count}', '✓ Images sent: {count}'],
    '✓ Жөнөтүлдү: {count}': ['✓ Отправлено: {count}', '✓ Sent: {count}'],
    'Жөнөтүү ({count})': ['Отправить ({count})', 'Send ({count})'],
    'Өчүрүү': ['Убрать', 'Remove'],
    'Жөнөтүү тарыхы': ['История отправки', 'Send history'],
    'Азырынча эч нерсе жөнөтүлгөн жок': ['Пока ничего не отправлено', 'Nothing sent yet'],
    'Эң көп {count} сүрөт тандаса болот.': ['Можно выбрать не более {count} фото.', 'You can select up to {count} images.'],
    'Эң көп {count} файл тандаса болот.': ['Можно выбрать не более {count} файлов.', 'You can select up to {count} files.'],

    // ----- Жөнөтүү катасы (экөө тең) -----
    'Алгач текст жазыңыз.': ['Сначала введите текст.', 'Type some text first.'],
    'Текст өтө узун. Кыскараак текст жазыңыз.': ['Текст слишком длинный. Сократите его.', 'The text is too long. Please shorten it.'],
    'Башка өткөрүү жүрүп жатат. Аяктаганча күтүңүз.': ['Идёт другая передача. Дождитесь окончания.', 'Another transfer is in progress. Please wait.'],
    'Бул файл түрү коопсуздук үчүн бөгөттөлгөн (программа файлдары жөнөтүлбөйт).': [
      'Этот тип файлов заблокирован из соображений безопасности (программы не отправляются).',
      'This file type is blocked for security reasons (program files are not sent).',
    ],
    'Файл бош экен. Башка файл тандаңыз.': ['Файл пустой. Выберите другой файл.', 'The file is empty. Choose another file.'],
    'Файл бош экен. Башка сүрөт тандаңыз.': ['Файл пустой. Выберите другое фото.', 'The file is empty. Choose another image.'],
    'Файл өтө чоң. Максимум: {max}.': ['Файл слишком большой. Максимум: {max}.', 'The file is too large. Maximum: {max}.'],
    'Сүрөт өтө чоң. Максимум: {max}.': ['Фото слишком большое. Максимум: {max}.', 'The image is too large. Maximum: {max}.'],
    'Файл өтө чоң. Телефон {max} чейин кабыл алат.': ['Файл слишком большой. Телефон принимает до {max}.', 'The file is too large. The phone accepts up to {max}.'],
    'Бул формат колдоого алынбайт. JPG, PNG, WEBP же GIF тандаңыз.': ['Этот формат не поддерживается. Выберите JPG, PNG, WEBP или GIF.', 'This format is not supported. Choose JPG, PNG, WEBP or GIF.'],
    'Бул сүрөт эмес (же өтө чоң). JPG, PNG, WEBP же GIF тандаңыз, же "Файл" плиткасын колдонуңуз.': [
      'Это не фото (или оно слишком большое). Выберите JPG, PNG, WEBP или GIF либо используйте плитку «Файл».',
      'This is not an image (or it is too large). Choose JPG, PNG, WEBP or GIF, or use the "File" tile.',
    ],
    'Папканы жөнөтүүгө болбойт. Алгач аны ZIP кылыңыз.': ['Папку отправить нельзя. Сначала упакуйте её в ZIP.', 'Folders cannot be sent. Zip it first.'],
    'Бир убакта бир гана файл жөнөтүлөт: биринчи файл тандалды.': ['За раз отправляется один файл: выбран первый.', 'Only one file is sent at a time: the first one was selected.'],

    // ----- Телефон → Компьютер ката тексттери -----
    'Байланыш жок. Компьютерден жаңы QR-код түзүп, кайра туташыңыз.': ['Нет соединения. Создайте новый QR-код на компьютере и подключитесь снова.', 'No connection. Create a new QR code on the computer and reconnect.'],
    'Байланыш үзүлдү. Компьютерден жаңы QR-код түзүп, кайра туташыңыз.': ['Связь прервана. Создайте новый QR-код на компьютере и подключитесь снова.', 'Disconnected. Create a new QR code on the computer and reconnect.'],
    'Компьютер жооп берген жок. Байланышты текшериңиз.': ['Компьютер не ответил. Проверьте соединение.', 'The computer did not respond. Check the connection.'],
    'Компьютер файлды ырастаган жок. Байланышты текшериңиз.': ['Компьютер не подтвердил получение файла. Проверьте соединение.', 'The computer did not confirm the file. Check the connection.'],
    'Компьютер файлды кабыл ала албады.': ['Компьютер не смог принять файл.', 'The computer could not accept the file.'],
    'Файл өтө чоң.': ['Файл слишком большой.', 'The file is too large.'],
    'Файл толук жетпеди. Кайра аракет кылыңыз.': ['Файл дошёл не полностью. Повторите попытку.', 'The file did not arrive completely. Try again.'],
    'Компьютер бул байланыш үчүн көбүрөөк файл кабыл албайт. Жаңы байланыш түзүңүз.': ['Компьютер больше не принимает файлы в этом соединении. Создайте новое соединение.', 'The computer will not accept more files in this connection. Start a new connection.'],
    'Компьютер файлды күтүп туруп токтотуп койду. Кайра аракет кылыңыз.': ['Компьютер перестал ждать файл. Повторите попытку.', 'The computer stopped waiting for the file. Try again.'],
    'Файл өткөрүүдө ката кетти. Кайра аракет кылыңыз.': ['Ошибка при передаче файла. Повторите попытку.', 'Error while transferring the file. Try again.'],
    'Файл жөнөтүлгөн жок. Кайра аракет кылыңыз.': ['Файл не отправлен. Повторите попытку.', 'The file was not sent. Try again.'],
    'Компьютер сүрөттү ырастаган жок. Байланышты текшериңиз.': ['Компьютер не подтвердил получение фото. Проверьте соединение.', 'The computer did not confirm the image. Check the connection.'],
    'Компьютер сүрөттү кабыл ала албады.': ['Компьютер не смог принять фото.', 'The computer could not accept the image.'],
    'Сүрөт өтө чоң.': ['Фото слишком большое.', 'The image is too large.'],
    'Компьютер бул форматты кабыл албайт.': ['Компьютер не принимает этот формат.', 'The computer does not accept this format.'],
    'Сүрөт толук жетпеди. Кайра аракет кылыңыз.': ['Фото дошло не полностью. Повторите попытку.', 'The image did not arrive completely. Try again.'],
    'Компьютер бул байланыш үчүн көбүрөөк маалымат кабыл албайт. Жаңы байланыш түзүңүз.': ['Компьютер больше не принимает данные в этом соединении. Создайте новое соединение.', 'The computer will not accept more data in this connection. Start a new connection.'],
    'Компьютер сүрөттү күтүп туруп токтотуп койду. Кайра аракет кылыңыз.': ['Компьютер перестал ждать фото. Повторите попытку.', 'The computer stopped waiting for the image. Try again.'],
    'Сүрөт өткөрүүдө ката кетти. Кайра аракет кылыңыз.': ['Ошибка при передаче фото. Повторите попытку.', 'Error while transferring the image. Try again.'],
    'Сүрөт жөнөтүлгөн жок. Кайра аракет кылыңыз.': ['Фото не отправлено. Повторите попытку.', 'The image was not sent. Try again.'],

    // ----- Компьютер → Телефон ката тексттери -----
    'Байланыш жок. Жаңы QR-код түзүп, кайра туташыңыз.': ['Нет соединения. Создайте новый QR-код и подключитесь снова.', 'No connection. Create a new QR code and reconnect.'],
    'Байланыш үзүлдү. Жаңы QR-код түзүп, кайра туташыңыз.': ['Связь прервана. Создайте новый QR-код и подключитесь снова.', 'Disconnected. Create a new QR code and reconnect.'],
    'Телефон маалыматты ырастаган жок. Байланышты текшериңиз.': ['Телефон не подтвердил получение. Проверьте соединение.', 'The phone did not confirm receipt. Check the connection.'],
    'Телефон маалыматты кабыл ала албады.': ['Телефон не смог принять данные.', 'The phone could not accept the data.'],
    'Файл телефон үчүн өтө чоң.': ['Файл слишком большой для телефона.', 'The file is too large for the phone.'],
    'Телефон бул форматты кабыл албайт.': ['Телефон не принимает этот формат.', 'The phone does not accept this format.'],
    'Телефон бул байланыш үчүн көбүрөөк маалымат кабыл албайт. Жаңы байланыш түзүңүз.': ['Телефон больше не принимает данные в этом соединении. Создайте новое соединение.', 'The phone will not accept more data in this connection. Start a new connection.'],
    'Телефон күтүп туруп токтотуп койду. Кайра аракет кылыңыз.': ['Телефон перестал ждать. Повторите попытку.', 'The phone stopped waiting. Try again.'],
    'Өткөрүүдө ката кетти. Кайра аракет кылыңыз.': ['Ошибка при передаче. Повторите попытку.', 'Transfer error. Try again.'],
    'Маалымат толук жетпеди. Кайра аракет кылыңыз.': ['Данные дошли не полностью. Повторите попытку.', 'The data did not arrive completely. Try again.'],
    'Телефон жооп берген жок. Байланышты текшериңиз.': ['Телефон не ответил. Проверьте соединение.', 'The phone did not respond. Check the connection.'],
    'Жөнөтүлгөн жок. Кайра аракет кылыңыз.': ['Не отправлено. Повторите попытку.', 'Not sent. Try again.'],

    // ----- Алуу (received.js) -----
    'Сүрөт жөнөтүү токтотулду.': ['Отправка фото остановлена.', 'Image transfer was cancelled.'],
    'Файл жөнөтүү токтотулду.': ['Отправка файла остановлена.', 'File transfer was cancelled.'],
    'Сүрөт келбей калды (жөнөтүүчү жооп бербей калды).': ['Фото не пришло (отправитель перестал отвечать).', 'The image did not arrive (the sender stopped responding).'],
    'Файл келбей калды (жөнөтүүчү жооп бербей калды).': ['Файл не пришёл (отправитель перестал отвечать).', 'The file did not arrive (the sender stopped responding).'],
    'Сүрөт толук келген жок. Кайра аракет кылыңыз.': ['Фото пришло не полностью. Повторите попытку.', 'The image did not arrive completely. Try again.'],
    'Файл толук келген жок. Кайра аракет кылыңыз.': ['Файл пришёл не полностью. Повторите попытку.', 'The file did not arrive completely. Try again.'],
    'Сүрөттү алуу ийгиликсиз болду.': ['Не удалось получить фото.', 'Receiving the image failed.'],
    'Файлды алуу ийгиликсиз болду.': ['Не удалось получить файл.', 'Receiving the file failed.'],
    '⚠️ Бул session үчүн көлөм чеги толду. Жаңы байланыш түзүңүз.': ['⚠️ Лимит объёма для этой сессии исчерпан. Создайте новое соединение.', '⚠️ The size limit for this session has been reached. Start a new connection.'],
    '⚠️ Коопсуздук үчүн программа файлы кабыл алынган жок.': ['⚠️ Файл программы не принят из соображений безопасности.', '⚠️ A program file was not accepted for security reasons.'],
    '⚠️ Бул session үчүн тексттердин чеги толду.': ['⚠️ Лимит текстов для этой сессии исчерпан.', '⚠️ The text limit for this session has been reached.'],
    '✓ Сүрөт алынды': ['✓ Фото получено', '✓ Image received'],
    '✓ Файл ийгиликтүү алынды': ['✓ Файл успешно получен', '✓ File received'],
    '✓ Текст алынды': ['✓ Текст получен', '✓ Text received'],
    'Сактоо': ['Сохранить', 'Save'],
    'Көчүрүү': ['Копировать', 'Copy'],
    '✓ Көчүрүлдү': ['✓ Скопировано', '✓ Copied'],
    'Көчүрүү мүмкүн эмес': ['Копирование недоступно', 'Copy is not available'],

    // ----- Телефон: беттин өзү -----
    'QuickDrop - Туташуу': ['QuickDrop - Подключение', 'QuickDrop - Connect'],
    'Компьютер туташты': ['Компьютер подключён', 'Computer connected'],
    '✓ Компьютер туташты': ['✓ Компьютер подключён', '✓ Computer connected'],
    'Компьютерге туташуу': ['Подключение к компьютеру', 'Connect to a computer'],
    'Текшерилүүдө...': ['Проверка...', 'Checking...'],
    'Туташуу': ['Подключиться', 'Connect'],
    'Туташылууда...': ['Подключаемся...', 'Joining...'],
    '← Артка': ['← Назад', '← Back'],
    '📝 Текст жөнөтүү': ['📝 Отправить текст', '📝 Send text'],
    '🖼️ Сүрөт жөнөтүү': ['🖼️ Отправить фото', '🖼️ Send an image'],
    '📄 Файл жөнөтүү': ['📄 Отправить файл', '📄 Send a file'],
    'PDF, DOC, XLS, PPT, ZIP, TXT жана башка файлдар': ['PDF, DOC, XLS, PPT, ZIP, TXT и другие файлы', 'PDF, DOC, XLS, PPT, ZIP, TXT and other files'],
    'Компьютерге жөнөтүлө турган текст': ['Текст для отправки на компьютер', 'Text to send to the computer'],
    'Текстти ушул жерге жазыңыз...': ['Введите текст здесь...', 'Type your text here...'],
    'Тандалган сүрөт': ['Выбранное фото', 'Selected image'],
    'Бул компьютерге туташкыңыз келеби?': ['Хотите подключиться к этому компьютеру?', 'Do you want to connect to this computer?'],
    'Туташуу үчүн кнопканы басыңыз': ['Нажмите кнопку для подключения', 'Press the button to connect'],
    'Компьютер менен байланыш түзүлүүдө...': ['Устанавливается соединение с компьютером...', 'Connecting to the computer...'],
    'Компьютерге кошулуп жатабыз...': ['Подключаемся к компьютеру...', 'Joining the computer...'],
    'Компьютердин уруксатын күтүүдө...': ['Ожидание разрешения компьютера...', 'Waiting for the computer to allow it...'],
    'Компьютердин экранында ушул эле код чыкканын текшериңиз. Компьютерде "Уруксат берүү" басылышын күтүңүз.': [
      'Убедитесь, что на экране компьютера показан тот же код. Дождитесь, пока на компьютере нажмут «Разрешить».',
      'Check that the same code is shown on the computer screen. Wait for "Allow" to be pressed on the computer.',
    ],
    'Компьютер уруксат бериши күтүлүүдө': ['Ожидание разрешения компьютера', 'Waiting for the computer to allow it'],
    'Байланыш түзүлүүдө...': ['Соединение устанавливается...', 'Establishing connection...'],
    'Бир аз күтө туруңуз.': ['Немного подождите.', 'Please wait a moment.'],
    'Компьютер менен түз байланыш түзүлдү. Эми маалымат жөнөтсөңүз болот.': ['Прямое соединение с компьютером установлено. Теперь можно отправлять данные.', 'The direct connection to the computer is ready. You can send data now.'],
    'Компьютер менен түз байланыш даяр': ['Прямое соединение с компьютером готово', 'Direct connection with the computer is ready'],

    // ----- Телефон: ката экрандары -----
    'Компьютерде "Жаңы QR-код" кнопкасын басып, кайра сканерлеңиз.': ['Нажмите «Новый QR-код» на компьютере и отсканируйте снова.', 'Press "New QR code" on the computer and scan again.'],
    'Бул QR-код жараксыз': ['Этот QR-код недействителен', 'This QR code is invalid'],
    'Бул session жабылган. Эски QR-кодду кайра колдонууга болбойт, компьютерден жаңы QR-код түзүңүз.': [
      'Эта сессия закрыта. Старый QR-код использовать нельзя, создайте новый на компьютере.',
      'This session is closed. The old QR code cannot be reused, create a new one on the computer.',
    ],
    'Бул QR-код колдонулган': ['Этот QR-код уже использован', 'This QR code was already used'],
    'Ар бир QR-код бир гана жолу иштейт. Компьютерден жаңы QR-код түзүңүз.': ['Каждый QR-код работает один раз. Создайте новый на компьютере.', 'Each QR code works only once. Create a new one on the computer.'],
    'Компьютер табылган жок': ['Компьютер не найден', 'Computer not found'],
    'Компьютерде QuickDrop ачык экенин текшерип, жаңы QR-код түзүңүз.': ['Убедитесь, что QuickDrop открыт на компьютере, и создайте новый QR-код.', 'Make sure QuickDrop is open on the computer and create a new QR code.'],
    'Компьютер байланышты үздү. Кайра туташуу үчүн компьютерден жаңы QR-код түзүп, сканерлеңиз.': ['Компьютер отключился. Чтобы подключиться снова, создайте новый QR-код на компьютере и отсканируйте его.', 'The computer ended the connection. To reconnect, create a new QR code on the computer and scan it.'],
    'Компьютер менен байланыш үзүлдү. Кайра туташуу үчүн компьютерден жаңы QR-код түзүңүз.': ['Связь с компьютером прервана. Чтобы подключиться снова, создайте новый QR-код на компьютере.', 'The connection to the computer was lost. Create a new QR code on the computer to reconnect.'],
    'Сиз байланышты үздүңүз. Кайра туташуу үчүн компьютерден жаңы QR-код сканерлеңиз.': ['Вы отключились. Чтобы подключиться снова, отсканируйте новый QR-код с компьютера.', 'You disconnected. To reconnect, scan a new QR code from the computer.'],
    'Эки түзмөк бир Wi-Fi тармагында экенин текшерип, жаңы QR-код менен кайра аракет кылыңыз.': ['Убедитесь, что оба устройства в одной сети Wi-Fi, и повторите с новым QR-кодом.', 'Make sure both devices are on the same Wi-Fi network and try again with a new QR code.'],
    'Туташуу четке кагылды': ['Подключение отклонено', 'Connection declined'],
    'Компьютер туташууга уруксат берген жок. Кайра аракет кылуу үчүн компьютерден жаңы QR-код түзүңүз.': ['Компьютер не разрешил подключение. Для новой попытки создайте QR-код на компьютере.', 'The computer did not allow the connection. Create a new QR code on the computer to try again.'],
    'Уруксат берилген жок': ['Разрешение не получено', 'Permission not given'],
    'Компьютер убагында жооп берген жок. Компьютерден жаңы QR-код түзүп, кайра аракет кылыңыз.': ['Компьютер не ответил вовремя. Создайте новый QR-код на компьютере и повторите.', 'The computer did not respond in time. Create a new QR code on the computer and try again.'],
    'Бир аз күтүп, кайра аракет кылыңыз.': ['Подождите немного и повторите.', 'Wait a moment and try again.'],
    'Серверге туташуу мүмкүн болгон жок': ['Не удалось подключиться к серверу', 'Could not reach the server'],
    'Телефон жана компьютер бир Wi-Fi тармагында экенин текшериңиз.': ['Убедитесь, что телефон и компьютер в одной сети Wi-Fi.', 'Make sure the phone and the computer are on the same Wi-Fi network.'],

    // ----- Тема / тил (кнопкалар) -----
    'Тема: жарык': ['Тема: светлая', 'Theme: light'],
    'Тема: караңгы': ['Тема: тёмная', 'Theme: dark'],
    'Тема: авто': ['Тема: авто', 'Theme: auto'],
    'Тема': ['Тема', 'Theme'],
    'Тил': ['Язык', 'Language'],
  };

  /* ----- Ички индекстер ----- */

  const langIndex = { ky: 0, ru: 1, en: 2 };
  const exact = new Map(); // кандайдыр бир тилдеги текст -> ky ачкыч
  const patterns = []; // шаблондор: { key, regexes: [ky, ru, en] }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "Калган убакыт: {time}" -> /^Калган убакыт: (.+?)$/ жана ['time']
  function compileTemplate(template) {
    const names = [];
    const source = template
      .split(/(\{[a-z]+\})/)
      .map((part) => {
        const match = part.match(/^\{([a-z]+)\}$/);
        if (!match) return escapeRegExp(part);
        names.push(match[1]);
        return '([\\s\\S]+?)';
      })
      .join('');
    return { regex: new RegExp(`^${source}$`), names };
  }

  for (const [key, values] of Object.entries(DICT)) {
    const forms = [key, values[0], values[1]];
    if (key.includes('{')) {
      patterns.push({ key, forms: forms.map(compileTemplate), texts: forms });
    } else {
      forms.forEach((text) => {
        if (text && !exact.has(text)) exact.set(text, key);
      });
    }
  }
  // Узун (конкреттүү) шаблондор алгач текшерилет
  patterns.sort((a, b) => b.key.replace(/\{[a-z]+\}/g, '').length - a.key.replace(/\{[a-z]+\}/g, '').length);

  /* ----- Тил ----- */

  function detectLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (LANGS.includes(saved)) return saved;
    } catch (error) {
      // localStorage жеткиликсиз: демейки тил
    }
    const browser = String(navigator.language || '').toLowerCase();
    if (browser.startsWith('ru')) return 'ru';
    if (browser.startsWith('ky')) return 'ky';
    if (browser.startsWith('en')) return 'en';
    return 'ky';
  }

  let currentLang = detectLang();
  const listeners = [];

  /* ----- Которуу ----- */

  // Текстти (толугу менен) тандалган тилге которот. Белгисиз болсо, өзгөрбөйт.
  function translate(text, lang) {
    const index = langIndex[lang];
    const trimmed = text.trim();
    if (!trimmed) return text;

    const key = exact.get(trimmed);
    if (key !== undefined) {
      const result = index === 0 ? key : DICT[key][index - 1];
      return text.replace(trimmed, () => result);
    }

    for (const pattern of patterns) {
      for (const form of pattern.forms) {
        const match = trimmed.match(form.regex);
        if (!match) continue;
        const values = {};
        form.names.forEach((name, i) => {
          values[name] = translate(match[i + 1], lang);
        });
        const target = pattern.texts[index];
        const result = target.replace(/\{([a-z]+)\}/g, (_, name) => (name in values ? values[name] : ''));
        return text.replace(trimmed, () => result);
      }
    }
    return text;
  }

  // JS кодунан түз колдонуу: t('Жөнөтүү'), t('Файл өтө чоң. Максимум: {max}.', { max: '5 MB' })
  function t(key, params) {
    let text = DICT[key] ? (langIndex[currentLang] === 0 ? key : DICT[key][langIndex[currentLang] - 1]) : key;
    if (params) text = text.replace(/\{([a-z]+)\}/g, (_, name) => (name in params ? params[name] : ''));
    return text;
  }

  /* ----- DOM'ду которуу ----- */

  const ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt', 'data-empty'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
  let applying = false; // биздин өзгөртүүлөр кайра байкалбасын

  function isSkipped(node) {
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) return true;
    if (SKIP_TAGS.has(element.tagName)) return true;
    return Boolean(element.closest('[data-no-i18n]'));
  }

  // Текст түйүнүнүн баштапкы ачкычы: которулган текст бош болуп калса да (мис. "басыңыз" -> ''),
  // тилди кайра алмаштырганда калыбына келтирүү үчүн
  const nodeKeys = new WeakMap();

  function translateTextNode(node) {
    if (isSkipped(node)) return;
    let source = node.data;
    if (!source.trim() && nodeKeys.has(node)) source = nodeKeys.get(node);

    const key = exact.get(source.trim());
    if (key !== undefined) nodeKeys.set(node, key);

    const next = translate(source, currentLang);
    if (next !== node.data) node.data = next;
  }

  function translateAttributes(element) {
    if (element.closest('[data-no-i18n]')) return;
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value) continue;
      const next = translate(value, currentLang);
      if (next !== value) element.setAttribute(name, next);
    }
  }

  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
      node = walker.nextNode();
    }
  }

  function translateDocument() {
    applying = true;
    try {
      document.documentElement.lang = currentLang;
      const title = translate(document.title, currentLang);
      if (title !== document.title) document.title = title;
      if (document.body) translateTree(document.body);
    } finally {
      applying = false;
    }
  }

  // Башка скрипттер DOM'го жаңы кыргызча текст коюшса, аны дароо которобуз
  const observer = new MutationObserver((mutations) => {
    if (applying) return;
    applying = true;
    try {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        else if (mutation.type === 'attributes') translateAttributes(mutation.target);
        else mutation.addedNodes.forEach((node) => translateTree(node));
      }
    } finally {
      applying = false;
      observer.takeRecords(); // биздин өзгөртүүлөрдү кайра иштетпейбиз
    }
  });

  function startObserver() {
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ATTRIBUTES,
    });
  }

  /* ----- Тилди алмаштыруу ----- */

  function setLang(lang) {
    if (!LANGS.includes(lang) || lang === currentLang) return;
    currentLang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (error) {
      // сакталбаса да иштей берет
    }
    translateDocument();
    listeners.forEach((listener) => listener(lang));
  }

  function onLangChange(listener) {
    listeners.push(listener);
  }

  // Тил тандагыч: <select id="langSelect">
  function bindLangSelect() {
    const select = document.getElementById('langSelect');
    if (!select) return;
    select.value = currentLang;
    select.addEventListener('change', () => setLang(select.value));
  }

  function init() {
    translateDocument();
    startObserver();
    bindLangSelect();
  }

  window.QuickDropI18n = { t, setLang, getLang: () => currentLang, onLangChange, translate };
  window.t = t;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
