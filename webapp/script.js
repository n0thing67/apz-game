const tg = window.Telegram?.WebApp;
if (tg?.expand) tg.expand();
const mx = window.WebApp;
if (mx?.ready) mx.ready();
// ===== ASSETS: ускоряем загрузку через WebP (с fallback) =====
function supportsWebP() {
    try {
        const c = document.createElement('canvas');
        // Если браузер не умеет WebP, вернёт PNG
        return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) {
        return false;
    }
}
const USE_WEBP = supportsWebP();
function assetPath(name, fallbackExt) {
    return `assets/${name}.${USE_WEBP ? 'webp' : fallbackExt}`;
}

// ==========================================
// PRELOADER: на старте грузим только приветственный экран,
// а ассеты уровней — непосредственно перед запуском уровня.
// ==========================================

const ESSENTIAL_WELCOME_IMAGE_MANIFEST = [
    'max',
    'asya',
    'bubble_left',
    'bubble_right'
];

const LEVEL_IMAGE_MANIFESTS = {
    'puzzle-2x2': ['logo', 'after_puzzle'],
    'puzzle-3x3': ['logo_3x3', 'after_puzzle'],
    'puzzle-4x4': ['logo_4x4', 'after_puzzle'],
    'jumper': ['hero', 'platform', 'spring', 'propeller', 'jetpack', 'part'],
    'factory-2048': ['bolt', 'nut', 'gear', 'chip', 'board', 'case', 'sensor', 'device', 'after_2048'],
    'quiz': ['after_quiz']
};

function preloadOneImage(url, timeoutMs = 8000) {
    // В редких случаях WebView может «повиснуть» на загрузке ресурса
    // без onload/onerror. Ставим страховочный таймаут, чтобы прелоадер
    // не зависал навсегда.
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve();
        };

        const t = setTimeout(finish, timeoutMs);

        img.onload = () => {
            // decode() часто снимает фризы на первом рендере
            if (img.decode) {
                img.decode().catch(() => {}).finally(finish);
            } else {
                finish();
            }
        };
        img.onerror = finish;
        img.src = url;
        // если уже в кэше
        if (img.complete && img.naturalWidth) {
            if (img.decode) img.decode().catch(() => {}).finally(finish);
            else finish();
        }
    });
}

let essentialWelcomeImagesPreloaded = false;
let essentialWelcomePreloadPromise = null;
const levelPreloadPromises = new Map();
const levelPreloadDone = new Set();

function updatePreloadOverlayState({ title = '🏭 Загружаем изображения…', loaded = 0, total = 1, currentFile = '—', visible = true } = {}) {
    const overlay = document.getElementById('preload-overlay');
    const titleEl = overlay?.querySelector?.('.preload-title');
    const bar = document.getElementById('preload-bar');
    const percentEl = document.getElementById('preload-percent');
    const currentEl = document.getElementById('preload-current');
    const barWrap = overlay?.querySelector?.('.preload-bar-wrap');
    if (!overlay) return;

    const safeTotal = Math.max(1, total || 1);
    const pct = Math.max(0, Math.min(100, Math.round((loaded / safeTotal) * 100)));

    if (titleEl) titleEl.textContent = title;
    if (bar) bar.style.width = `${pct}%`;
    if (percentEl) percentEl.textContent = `${pct}%`;
    if (currentEl) currentEl.textContent = `Сейчас загружается: ${currentFile || '—'}`;
    if (barWrap) barWrap.setAttribute('aria-valuenow', String(pct));
    overlay.setAttribute('aria-busy', visible ? 'true' : 'false');
    overlay.classList.toggle('hidden', !visible);
}

async function preloadImageManifest(manifest, title) {
    const list = Array.from(new Set((manifest || []).filter(Boolean)));
    if (!list.length) return;

    updatePreloadOverlayState({ title, loaded: 0, total: list.length, currentFile: '—', visible: true });

    const hardStop = setTimeout(() => {
        updatePreloadOverlayState({ title, loaded: list.length, total: list.length, currentFile: 'Готово', visible: false });
    }, 25000);

    try {
        let loaded = 0;
        for (const name of list) {
            const fallbackExt = /^logo/.test(name) ? 'jpg' : 'png';
            const url = assetPath(name, fallbackExt);
            const file = url.split('/').pop();
            updatePreloadOverlayState({ title, loaded, total: list.length, currentFile: file, visible: true });
            await preloadOneImage(url);
            loaded++;
            updatePreloadOverlayState({ title, loaded, total: list.length, currentFile: file, visible: true });
        }
    } finally {
        clearTimeout(hardStop);
        updatePreloadOverlayState({ title, loaded: list.length, total: list.length, currentFile: 'Готово', visible: false });
    }
}

function startEssentialImagePreloader() {
    if (essentialWelcomeImagesPreloaded) return Promise.resolve();
    if (essentialWelcomePreloadPromise) return essentialWelcomePreloadPromise;

    essentialWelcomePreloadPromise = preloadImageManifest(ESSENTIAL_WELCOME_IMAGE_MANIFEST, '🏭 Загружаем стартовый экран…')
        .finally(() => {
            essentialWelcomeImagesPreloaded = true;
        });

    return essentialWelcomePreloadPromise;
}

function preloadLevelAssets(levelId) {
    if (levelPreloadDone.has(levelId)) return Promise.resolve();
    if (levelPreloadPromises.has(levelId)) return levelPreloadPromises.get(levelId);

    const titleMap = {
        'puzzle-2x2': '🧩 Загружаем уровень…',
        'puzzle-3x3': '🧩 Загружаем уровень…',
        'puzzle-4x4': '🧩 Загружаем уровень…',
        'jumper': '🏃 Загружаем уровень…',
        'factory-2048': '⚙️ Загружаем уровень…',
        'quiz': '🎓 Загружаем уровень…'
    };

    const manifest = LEVEL_IMAGE_MANIFESTS[levelId] || [];
    const promise = preloadImageManifest(manifest, titleMap[levelId] || '🏭 Загружаем уровень…')
        .finally(() => {
            levelPreloadDone.add(levelId);
            levelPreloadPromises.delete(levelId);
        });

    levelPreloadPromises.set(levelId, promise);
    return promise;
}

// ==========================================
// SFX (звуки)
// ==========================================
// Все звуки лежат в папке webapp/sound/
// Важно: в мобильных браузерах звук начинает играть только после первого действия пользователя.

const SFX_BASE = 'sound/';

// Имена ключей — то, что будем вызывать в коде: playSfx('menu-click')
const SFX_FILES = {
    'menu-click': 'menu-click.mp3',

    // Puzzle
    'puzzle-click': 'puzzle-click.mp3',
    'puzzle-slide': 'puzzle-slide.mp3',

    // 2048
    '2048-plastic': '2048-plastic.mp3',
    '2048-slide': '2048-slide.mp3',
    '2048-pop': '2048-pop.mp3',

    // Quiz
    'answer-correct': 'answer-correct.mp3',
    'answer-uncorrect': 'answer-uncorrect.mp3',

    // Jumper
    'jumper-jump': 'jumper-jump.mp3',
    'jumper-bounce': 'jumper-bounce.mp3',
    'jumper-propeller': 'jumper-propeller.mp3',
    'jumper-jetpack': 'jumper-jetpack.mp3',
    // В проекте исторически был файл "jimper-win.mp3" — оставили совместимость
    'jumper-win': 'jumper-win.mp3',
    'jumper-loss': 'jumper-loss.mp3'
};

// Небольшие пулы, чтобы можно было быстро проигрывать один и тот же звук подряд
const SFX_POOL_SIZE = 4;
const sfxPool = new Map();
let sfxUnlocked = false;
const SFX_MUTED_KEY = 'apzSfxMutedV1';
let sfxMuted = false;

try {
    sfxMuted = localStorage.getItem(SFX_MUTED_KEY) === '1';
} catch (e) {
    sfxMuted = false;
}

function updateSoundToggleUI() {
    const btn = document.getElementById('btn-sound-toggle');
    if (!btn) return;
    btn.textContent = sfxMuted ? '🔇 Звук' : '🔊 Звук';
    btn.setAttribute('aria-label', sfxMuted ? 'Звук выключен' : 'Звук включен');
}

function setSfxMuted(v) {
    sfxMuted = !!v;
    try {
        localStorage.setItem(SFX_MUTED_KEY, sfxMuted ? '1' : '0');
    } catch (e) {}
    updateSoundToggleUI();
}

function initSfxPool() {
    // Создаём аудио-объекты один раз
    for (const [key, file] of Object.entries(SFX_FILES)) {
        const arr = [];
        for (let i = 0; i < SFX_POOL_SIZE; i++) {
            const a = new Audio(SFX_BASE + file);
            a.preload = 'auto';
            a.volume = 0.9;
            arr.push(a);
        }
        sfxPool.set(key, { arr, idx: 0 });
    }
}

function unlockSfxOnce() {
    if (sfxUnlocked) return;
    sfxUnlocked = true;
    // Попытка "разлочить" звук на iOS/Android WebView
    try {
        for (const { arr } of sfxPool.values()) {
            const a = arr[0];
            // Быстрый play/pause в рамках пользовательского жеста
            a.muted = true;
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
            a.pause();
            a.currentTime = 0;
            a.muted = false;
        }
    } catch (e) {}
}

function playSfx(key) {
    if (sfxMuted) return;
    const pack = sfxPool.get(key);
    if (!pack) return;
    const a = pack.arr[pack.idx];
    pack.idx = (pack.idx + 1) % pack.arr.length;

    try {
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
    } catch (e) {}
}

initSfxPool();


// ==========================================
// УРОВНИ + СТАТИСТИКА (по каждому уровню отдельно)
// ==========================================
const LEVEL_DEFS = {
    'puzzle-2x2': { title: 'Цех сборки логотипа (2×2)', type: 'puzzle', puzzleSize: 2, stat: 'time' },
    'puzzle-3x3': { title: 'Цех сборки логотипа (3×3)', type: 'puzzle', puzzleSize: 3, stat: 'time' },
    'puzzle-4x4': { title: 'Цех сборки логотипа (4×4)', type: 'puzzle', puzzleSize: 4, stat: 'time' },
    'jumper':      { title: 'Цех проверки ловкости', type: 'jumper', stat: 'score' },
    'factory-2048':{ title: 'Цех сборки деталей', type: '2048',   stat: 'score' },
    'quiz':        { title: 'Цех умных решений', type: 'quiz',   stat: 'score' }
};


// ==========================================
// APTITUDE_TEST (профориентационный тест)
// ==========================================

function scorePuzzleByTime(size, timeMs) {
    const sec = Math.max(1, Math.ceil((Number(timeMs) || 0) / 1000));
    if (size === 2) {
        if (sec <= 1) return 5;
        if (sec === 2) return 4;
        if (sec === 3) return 3;
        if (sec === 4) return 2;
        return 1;
    }
    if (size === 3) {
        if (sec <= 5) return 5;
        if (sec <= 8) return 4;
        if (sec <= 12) return 3;
        if (sec <= 16) return 2;
        return 1;
    }
    if (size === 4) {
        if (sec <= 12) return 5;
        if (sec <= 18) return 4;
        if (sec <= 25) return 3;
        if (sec <= 35) return 2;
        return 1;
    }
    return 0;
}

function scoreJumperByTime(timeMs) {
    const sec = Math.max(1, Math.ceil((Number(timeMs) || 0) / 1000));
    if (sec <= 25) return 5;
    if (sec <= 30) return 4;
    if (sec <= 36) return 3;
    if (sec <= 45) return 2;
    return 1;
}

const APTITUDE_STORAGE_KEY = 'apzAptitudeResultV2';

const APTITUDE_AXES = {
    PEOPLE: {
        name: '🤝 Работа с людьми',
        short: 'Работа с людьми',
        hint: 'Профессии, связанные с обслуживанием, управлением, воспитанием и обучением. Важно уметь и любить общаться, понимать настроение и намерения людей.'
    },
    RESEARCH: {
        name: '🔬 Исследовательская деятельность',
        short: 'Исследовательская',
        hint: 'Профессии, связанные с научной работой. Нужны рациональность, независимость и оригинальность суждений, аналитический склад ума.'
    },
    PRODUCTION: {
        name: '🏭 Работа на производстве',
        short: 'Работа на производстве',
        hint: 'Профессии, связанные с техникой и механизмами: сборка, монтаж, ремонт, наладка, обслуживание оборудования, производство и транспорт.'
    },
    AESTHETIC: {
        name: '🎨 Эстетические виды деятельности',
        short: 'Эстетические',
        hint: 'Творческие профессии: изобразительная, музыкальная, литературно‑художественная, актерско‑сценическая деятельность. Важны оригинальность и стремление к совершенству.'
    },
    EXTREME: {
        name: '🧗 Экстремальные виды деятельности',
        short: 'Экстремальные',
        hint: 'Профессии, связанные со спортом, путешествиями, экспедициями, охраной, службой. Нужны физическая подготовка, здоровье и морально‑волевые качества.'
    },
    PLAN_ECON: {
        name: '📊 Планово‑экономические виды деятельности',
        short: 'Планово-экономические',
        hint: 'Профессии, связанные с расчетами и планированием, документацией, анализом текстов и схем. Требуют собранности и аккуратности.'
    }
};

// Экранирование для вставки строки в HTML-атрибут (data-hint)
function escapeAttr(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function hideAptitudeTooltip() {
    const tt = document.getElementById('aptitude-tooltip');
    if (tt) tt.classList.add('hidden');
}

function showAptitudeTooltip(text, anchorEl) {
    const tt = document.getElementById('aptitude-tooltip');
    if (!tt) return;

    const msg = (text || '').trim();
    if (!msg) { hideAptitudeTooltip(); return; }

    tt.textContent = msg;
    tt.classList.remove('hidden');

    // Позиционируем около нажатой подписи
    const r = anchorEl?.getBoundingClientRect?.();
    const pad = 8;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    // Сначала ставим «сверху», если места мало — «снизу»
    tt.style.left = '0px';
    tt.style.top = '0px';
    // Дадим браузеру посчитать размеры
    const tw = tt.offsetWidth;
    const th = tt.offsetHeight;

    let left = (r ? (r.left + (r.width / 2) - (tw / 2)) : (vw / 2 - tw / 2));
    left = Math.max(pad, Math.min(left, vw - tw - pad));

    let top = r ? (r.top - th - 10) : (vh / 2 - th / 2);
    if (r && top < pad) {
        top = Math.min(vh - th - pad, r.bottom + 10);
    }
    top = Math.max(pad, Math.min(top, vh - th - pad));

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;
}

function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

// 24 вопроса. Каждый вариант даёт +1 к одной шкале.
const APTITUDE_QUESTIONS = [
  {
    q: '1. Мне хотелось бы в своей профессиональной деятельности',
    a: [
      { t: 'а) общаться с самыми разными людьми;', s: 'PEOPLE' },
      { t: 'б) снимать фильмы, писать книги, рисовать, выступать на сцене и т. д.', s: 'AESTHETIC' },
      { t: 'в) заниматься расчетами; вести документацию.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '2. В книге или кинофильме меня больше всего привлекает',
    a: [
      { t: 'а) возможность следить за ходом мыслей автора;', s: 'RESEARCH' },
      { t: 'б) художественная форма, мастерство писателя или режиссера;', s: 'AESTHETIC' },
      { t: 'в) сюжет, действия героев.', s: 'EXTREME' },
    ]
  },
  {
    q: '3. Меня больше обрадует Нобелевская премия',
    a: [
      { t: 'а) за общественную деятельность;', s: 'PEOPLE' },
      { t: 'б) в области науки;', s: 'RESEARCH' },
      { t: 'в) в области искусства.', s: 'AESTHETIC' },
    ]
  },
  {
    q: '4. Я скорее соглашусь стать',
    a: [
      { t: 'а) главным механиком;', s: 'PRODUCTION' },
      { t: 'б) начальником экспедиции;', s: 'EXTREME' },
      { t: 'в) главным бухгалтером.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '5. Будущее людей определяют',
    a: [
      { t: 'а) взаимопонимание между людьми;', s: 'PEOPLE' },
      { t: 'б) научные открытия;', s: 'RESEARCH' },
      { t: 'в) развитие производства.', s: 'PRODUCTION' },
    ]
  },
  {
    q: '6. Если я стану руководителем, то в первую очередь займусь',
    a: [
      { t: 'а) созданием дружного, сплоченного коллектива;', s: 'PEOPLE' },
      { t: 'б) разработкой новых технологий обучения;', s: 'RESEARCH' },
      { t: 'в) работой с документами.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '7. На технической выставке меня больше привлечет',
    a: [
      { t: 'а) внутреннее устройство экспонатов;', s: 'PRODUCTION' },
      { t: 'б) их практическое применение;', s: 'PLAN_ECON' },
      { t: 'в) внешний вид экспонатов (цвет, форма).', s: 'AESTHETIC' },
    ]
  },
  {
    q: '8. В людях я ценю, прежде всего',
    a: [
      { t: 'а) дружелюбие и отзывчивость;', s: 'PEOPLE' },
      { t: 'б) смелость и выносливость;', s: 'EXTREME' },
      { t: 'в) обязательность и аккуратность.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '9. В свободное время мне хотелось бы',
    a: [
      { t: 'а) ставить различные опыты, эксперименты;', s: 'RESEARCH' },
      { t: 'б) писать стихи, сочинять музыку или рисовать;', s: 'AESTHETIC' },
      { t: 'в) тренироваться.', s: 'EXTREME' },
    ]
  },
  {
    q: '10. В заграничных поездках меня скорее заинтересует',
    a: [
      { t: 'а) возможность знакомства с историей и культурой другой страны;', s: 'AESTHETIC' },
      { t: 'б) экстремальный туризм (альпинизм, виндсерфинг, горные лыжи);', s: 'EXTREME' },
      { t: 'в) деловое общение', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '11. Мне интереснее беседовать о',
    a: [
      { t: 'а) человеческих взаимоотношениях;', s: 'PEOPLE' },
      { t: 'б) новой научной гипотезе;', s: 'RESEARCH' },
      { t: 'в) технических характеристиках новой модели машины, компьютера.', s: 'PRODUCTION' },
    ]
  },
  {
    q: '12. Если бы в моей школе было всего три кружка, я бы выбрал',
    a: [
      { t: 'а) технический;', s: 'PRODUCTION' },
      { t: 'б) музыкальный;', s: 'AESTHETIC' },
      { t: 'в) спортивный.', s: 'EXTREME' },
    ]
  },
  {
    q: '13. В школе следует обратить особое внимание на',
    a: [
      { t: 'а) улучшение взаимопонимания между учителями и учениками;', s: 'PEOPLE' },
      { t: 'б) поддержание здоровья учащихся, занятия спортом;', s: 'EXTREME' },
      { t: 'в) укрепление дисциплины.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '14. Я с большим удовольствием смотрю',
    a: [
      { t: 'а) научно‑популярные фильмы;', s: 'RESEARCH' },
      { t: 'б) программы о культуре и искусстве;', s: 'AESTHETIC' },
      { t: 'в) спортивные программы.', s: 'EXTREME' },
    ]
  },
  {
    q: '15. Мне хотелось бы работать',
    a: [
      { t: 'а) с детьми или сверстниками;', s: 'PEOPLE' },
      { t: 'б) с машинами, механизмами;', s: 'PRODUCTION' },
      { t: 'в) с объектами природы.', s: 'RESEARCH' },
    ]
  },
  {
    q: '16. Школа в первую очередь должна',
    a: [
      { t: 'а) учить общению с другими людьми;', s: 'PEOPLE' },
      { t: 'б) давать знания;', s: 'RESEARCH' },
      { t: 'в) обучать навыкам работы.', s: 'PRODUCTION' },
    ]
  },
  {
    q: '17. Главное в жизни',
    a: [
      { t: 'а) иметь возможность заниматься творчеством;', s: 'AESTHETIC' },
      { t: 'б) вести здоровый образ жизни;', s: 'EXTREME' },
      { t: 'в) тщательно планировать свои дела.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '18. Государство должно в первую очередь заботиться о',
    a: [
      { t: 'а) защите интересов и прав граждан;', s: 'PEOPLE' },
      { t: 'б) достижениях в области науки и техники;', s: 'RESEARCH' },
      { t: 'в) материальном благополучии граждан.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '19. Мне больше всего нравятся уроки',
    a: [
      { t: 'а) труда;', s: 'PRODUCTION' },
      { t: 'б) физкультуры;', s: 'EXTREME' },
      { t: 'в) математики.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '20. Мне интереснее было бы',
    a: [
      { t: 'а) заниматься сбытом товаров;', s: 'PEOPLE' },
      { t: 'б) изготавливать изделия;', s: 'PRODUCTION' },
      { t: 'в) планировать производство товаров.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '21. Я предпочитаю читать статьи о',
    a: [
      { t: 'а) выдающихся ученых и их открытиях;', s: 'RESEARCH' },
      { t: 'б) интересных изобретениях;', s: 'PRODUCTION' },
      { t: 'в) жизни и творчестве писателей, художников, музыкантов.', s: 'AESTHETIC' },
    ]
  },
  {
    q: '22. В свободное время я люблю',
    a: [
      { t: 'а) читать, думать, рассуждать;', s: 'RESEARCH' },
      { t: 'б) что-нибудь мастерить, шить, ухаживать за животными, растениями;', s: 'PRODUCTION' },
      { t: 'в) ходить на выставки, концерты, в музеи.', s: 'AESTHETIC' },
    ]
  },
  {
    q: '23. Больший интерес у меня вызовет сообщение о',
    a: [
      { t: 'а) научном открытии;', s: 'RESEARCH' },
      { t: 'б) художественной выставке;', s: 'AESTHETIC' },
      { t: 'в) экономической ситуации.', s: 'PLAN_ECON' },
    ]
  },
  {
    q: '24. Я предпочту работать',
    a: [
      { t: 'а) в помещении, где много людей;', s: 'PEOPLE' },
      { t: 'б) в необычных условиях;', s: 'EXTREME' },
      { t: 'в) в обычном кабинете.', s: 'PLAN_ECON' },
    ]
  },
];

// Профили: текст результата + примеры направлений + рекомендации по играм (⭐).
// Структуру (подсказки, рекомендованные игры и т. д.) не меняем — обновляем только содержимое.
const APTITUDE_PROFILES = {
  PEOPLE: {
    explain:
      'Склонность к работе с людьми. Профессии, связанные с обслуживанием (бытовым, медицинским, справочно‑информационным), управлением, воспитанием и обучением. Людям этой группы важно уметь и любить общаться, находить общий язык с разными людьми.',
    careers: ['сервис', 'медицина', 'педагогика', 'управление', 'консультирование'],
    games: ['quiz','jumper']
  },
  RESEARCH: {
    explain:
      'Склонность к исследовательской деятельности. Профессии, связанные с научной работой. Важны рациональность, независимость и оригинальность суждений, аналитический склад ума. Часто интереснее размышлять о проблеме, чем заниматься её реализацией.',
    careers: ['научные исследования', 'лаборатория', 'аналитика', 'R&D', 'разработка гипотез'],
    games: ['quiz','puzzle-4x4']
  },
  PRODUCTION: {
    explain:
      'Склонность к работе на производстве. Профессии: обработка и сборка, монтаж приборов и механизмов, ремонт и наладка оборудования, монтаж и ремонт зданий и конструкций, управление транспортом. Требуются внимание, координация движений и хорошее здоровье.',
    careers: ['инженерия', 'механика', 'электроника', 'монтаж и ремонт', 'транспорт'],
    games: ['factory-2048','puzzle-3x3','puzzle-2x2']
  },
  AESTHETIC: {
    explain:
      'Склонность к эстетическим видам деятельности. Творческие профессии: изобразительная, музыкальная, литературно‑художественная, актерско‑сценическая деятельность. Важны оригинальность мышления, независимость характера и стремление к совершенству.',
    careers: ['дизайн', 'музыка', 'литература', 'театр/сцена', 'искусство'],
    games: ['puzzle-2x2','puzzle-3x3','quiz']
  },
  EXTREME: {
    explain:
      'Склонность к экстремальным видам деятельности. Профессии, связанные со спортом, путешествиями, экспедиционной работой, охраной и службой. Все они предъявляют особые требования к физической подготовке, здоровью и морально‑волевым качествам.',
    careers: ['спорт', 'туризм', 'экспедиции', 'служба', 'безопасность'],
    games: ['jumper']
  },
  PLAN_ECON: {
    explain:
      'Склонность к планово‑экономическим видам деятельности. Профессии, связанные с расчетами и планированием (бухгалтер, экономист), делопроизводством и анализом текстов (редактор, переводчик), схемами и чертежами. Эти профессии требуют собранности и аккуратности.',
    careers: ['экономика', 'бухгалтерия', 'планирование', 'документооборот', 'аналитика'],
    games: ['factory-2048','quiz']
  }
};

function newAptitudeScores() {
    return { PEOPLE:0, RESEARCH:0, PRODUCTION:0, AESTHETIC:0, EXTREME:0, PLAN_ECON:0 };
}

let aptitudeIndex = 0;
let aptitudeScores = newAptitudeScores();
let aptitudeQuestionOrder = null;

function shuffleArrayInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function startAptitudeTest() {
    aptitudeIndex = 0;
    aptitudeScores = newAptitudeScores();

    // Вопросы идут строго по порядку (1→24), как в тексте теста
    aptitudeQuestionOrder = APTITUDE_QUESTIONS;

    // На время перепрохождения убираем старые рекомендации (⭐) из меню
    try { clearAptitudeMenuRecommendations(); } catch (e) {}

    showScreen('screen-aptitude');
    renderAptitudeQuestion();
    lockClicks(300);
}

// Вход в режим профтеста:
// если результат уже есть — показываем его; сбрасываем только по кнопке "Пройти ещё раз".
function openAptitudeMode() {
    const saved = loadSavedAptitudeResult();
    if (saved) {
        renderAptitudeResult(saved);
        showScreen('screen-aptitude-result');
        try { applyAptitudeRecommendationsToMenu(saved); } catch (e) {}
        lockClicks(200);
        return;
    }
    startAptitudeTest();
}

function renderAptitudeQuestion() {
    const total = APTITUDE_QUESTIONS.length;
    const qEl = document.getElementById('aptitude-question');
    const aEl = document.getElementById('aptitude-answers');
    const pEl = document.getElementById('aptitude-progress');
    if (!qEl || !aEl || !pEl) return;

    const qList = aptitudeQuestionOrder || APTITUDE_QUESTIONS;
    const item = qList[aptitudeIndex];
    pEl.textContent = `Вопрос ${aptitudeIndex + 1} из ${total}`;
    qEl.textContent = item.q;

    aEl.innerHTML = '';
    // Ответы идут в порядке а/б/в, как в тексте теста.
    const answers = item.a;
    for (const ans of answers) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.type = 'button';
        btn.textContent = ans.t;
        btn.dataset.action = 'aptitude-answer';
        btn.dataset.score = ans.s;
        aEl.appendChild(btn);
    }
}

function finishAptitudeTest() {
    // Ранжируем
    const entries = Object.entries(aptitudeScores);
    entries.sort((a,b)=>b[1]-a[1]);

    const [mainK, mainV] = entries[0];
    const [secondK, secondV] = entries[1] || [mainK, 0];

    const total = APTITUDE_QUESTIONS.length;
    const percent = (v) => Math.round((v / total) * 100);

    const result = {
        scores: { ...aptitudeScores },
        order: entries.map(([k,v]) => ({ k, v, p: percent(v) })),
        main: mainK,
        second: secondK,
        ts: Date.now()
    };

    try { localStorage.setItem(APTITUDE_STORAGE_KEY, JSON.stringify(result)); } catch(e) {}

    // ВАЖНО: Telegram.WebApp.sendData() автоматически закрывает WebApp.
    // Поэтому во время прохождения теста мы НЕ отправляем данные боту напрямую,
    // иначе результат не успеет показаться и игра "закроется".
    // Ведущее направление добавляется в общий payload статистики при финальной отправке.

    renderAptitudeResult(result);
    showScreen('screen-aptitude-result');
    // Помечаем рекомендации в меню уровней (звёздочкой)
    try { applyAptitudeRecommendationsToMenu(result); } catch (e) {}
}

function renderAptitudeResult(result) {
    const mainEl = document.getElementById('aptitude-main');
    const secondEl = document.getElementById('aptitude-second');
    const explainEl = document.getElementById('aptitude-explain');
    const barsEl = document.getElementById('aptitude-bars');
    const careersEl = document.getElementById('aptitude-careers');
    const gamesEl = document.getElementById('aptitude-games');

    if (mainEl) mainEl.textContent = APTITUDE_AXES[result.main]?.name || result.main;
    if (secondEl) secondEl.textContent = APTITUDE_AXES[result.second]?.name || result.second;

    const prof = APTITUDE_PROFILES[result.main] || {};
    if (explainEl) explainEl.textContent = prof.explain || '—';

    if (barsEl) {
        barsEl.innerHTML = '';
        for (const it of result.order) {
            const axis = APTITUDE_AXES[it.k] || {};
            const row = document.createElement('div');
            row.className = 'result-bar';
            row.innerHTML = `
              <div>
                <button type="button" class="apt-label" data-action="aptitude-hint" data-hint="${escapeAttr(axis.hint || '')}">${axis.short || it.k}</button>
              </div>
              <div class="bar"><div class="fill" style="width:${it.p}%"></div></div>
              <div style="text-align:right; opacity:0.9;">${it.p}%</div>
            `;
            barsEl.appendChild(row);
        }
    }

    if (careersEl) {
        careersEl.innerHTML = '';
        for (const c of (prof.careers || [])) {
            const li = document.createElement('li');
            li.textContent = c;
            careersEl.appendChild(li);
        }
    }

    if (gamesEl) {
        gamesEl.innerHTML = '';
        const games = prof.games || [];
        for (const g of games) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = LEVEL_DEFS[g]?.title ? `⭐ ${LEVEL_DEFS[g].title}` : `⭐ ${g}`;
            gamesEl.appendChild(chip);
        }
    }
}

function clearAptitudeMenuRecommendations() {
    // Убираем отметки ⭐ и подсветку с карточек уровней в меню
    document.querySelectorAll('.level-card.recommended').forEach(c => c.classList.remove('recommended'));
    document.querySelectorAll('.recommend-badge').forEach(b => b.remove());
}

function applyAptitudeRecommendationsToMenu(result) {
    // Снимаем старые отметки
    document.querySelectorAll('.level-card.recommended').forEach(c => c.classList.remove('recommended'));
    document.querySelectorAll('.recommend-badge').forEach(b => b.remove());

    const prof = APTITUDE_PROFILES[result.main] || {};
    const rec = new Set(prof.games || []);

    // Отмечаем карточки уровней
    document.querySelectorAll('.level-card').forEach(card => {
        const btn = card.querySelector('button[data-level]');
        if (!btn) return;
        const key = btn.dataset.level;
        if (!rec.has(key)) return;

        card.classList.add('recommended');
        const title = card.querySelector('.level-title');
        if (title && !title.querySelector('.recommend-badge')) {
            const badge = document.createElement('span');
            badge.className = 'recommend-badge';
            badge.textContent = '⭐';
            title.appendChild(badge);
        }
    });
}

function loadSavedAptitudeResult() {
    try {
        const raw = localStorage.getItem(APTITUDE_STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !data.scores || !data.main) return null;
        return data;
    } catch (e) {
        return null;
    }
}


// ==========================================
// Доступность уровней (админ может временно выключать)
// ==========================================
let LEVEL_AVAIL = null; // { level_key: true/false }

// Если игра открыта с GitHub Pages, API находится на Render.
// Бот передает адрес API параметром: ?api=https://<render-app>.onrender.com
// Также сохраняем его в localStorage, чтобы работало и при перезапуске.
function decodeBase64Url(value) {
    try {
        const s = String(value || '').trim();
        if (!s) return '';
        const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
        return atob(padded);
    } catch (e) {
        return '';
    }
}

function normalizeApiBase(value) {
    const s = String(value || '').trim();
    if (!/^https?:\/\//i.test(s)) return '';
    return s.replace(/\/$/, '');
}

function extractApiBaseFromStartParam(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';

    if (/^https?:\/\//i.test(value)) {
        return normalizeApiBase(value);
    }

    const mPacked = value.match(/(?:^|[|;&?])api=([^|;&]+)/i);
    if (mPacked) {
        try {
            return normalizeApiBase(decodeURIComponent(mPacked[1]));
        } catch (e) {}
    }

    const marker = 'game__api__';
    const idx = value.indexOf(marker);
    if (idx >= 0) {
        const encoded = value.slice(idx + marker.length).split(/[|;&?]/, 1)[0];
        return normalizeApiBase(decodeBase64Url(encoded));
    }

    return '';
}

function parseBridgeInitData(raw) {
    const candidates = [];
    try {
        const s = String(raw || '').trim();
        if (!s) return candidates;

        try {
            const obj = JSON.parse(s);
            if (obj && typeof obj === 'object') {
                candidates.push(obj.start_param, obj.startapp, obj.startApp, obj.api);
            }
        } catch (e) {}

        try {
            const params = new URLSearchParams(s);
            candidates.push(
                params.get('start_param'),
                params.get('startapp'),
                params.get('startApp'),
                params.get('api')
            );
        } catch (e) {}
    } catch (e) {}
    return candidates;
}

function getApiBaseFromBridge() {
    const candidates = [
        tg?.initDataUnsafe?.start_param,
        tg?.initDataUnsafe?.startapp,
        tg?.initDataUnsafe?.startApp,
        tg?.initDataUnsafe?.api,
        mx?.initDataUnsafe?.start_param,
        mx?.initDataUnsafe?.startapp,
        mx?.initDataUnsafe?.startApp,
        mx?.initDataUnsafe?.api,
        mx?.startParam,
        mx?.start_param,
        mx?.startapp,
        mx?.api,
        ...parseBridgeInitData(mx?.initData),
        ...parseBridgeInitData(tg?.initData),
    ];

    for (const item of candidates) {
        const api = extractApiBaseFromStartParam(item);
        if (api) return api;
    }
    return '';
}

let API_BASE = '';
try {
    const url = new URL(window.location.href);
    const qp = normalizeApiBase(url.searchParams.get('api') || '');
    const bridgeApi = getApiBaseFromBridge();
    const savedApi = normalizeApiBase(localStorage.getItem('apzApiBaseV1') || '');

    API_BASE = qp || bridgeApi || savedApi;
    if (API_BASE) {
        localStorage.setItem('apzApiBaseV1', API_BASE);
    }
} catch (e) {
    API_BASE = '';
}

function apiUrl(path) {
    if (!API_BASE) return path;
    if (path.startsWith('http')) return path;
    return API_BASE + path;
}


// Синхронизация профтеста ("Что тебе больше подходит") с сервером.
// Если админ удалил пользователя/сбросил статистику, локальный localStorage может
// «сохранить» старый результат и показывать его после повторной регистрации.
// Здесь мы аккуратно очищаем только результат профтеста, если на сервере его нет.
async function syncAptitudeWithServer() {
    try {
        // API_BASE может быть пустым, если WebApp и API находятся на одном домене.
        // В этом случае apiUrl('/api/me') вернёт относительный путь и fetch() должен работать.
        if (!tg?.initData) return;

        const res = await fetch(apiUrl('/api/me'), {
            method: 'GET',
            cache: 'no-store',
            headers: { 'X-Telegram-InitData': tg.initData }
        });
        if (!res.ok) return;

        const data = await res.json();

        // 1) Глобальный сброс статистики админом:
        // если на сервере изменилась метка сброса — очищаем локальные данные (очки, рекомендации, результаты).
        const serverReset = String(data?.reset_token ?? '0');
        let localReset = '0';
        try { localReset = String(localStorage.getItem(RESET_TOKEN_KEY) ?? '0'); } catch (e) { localReset = '0'; }

        if (serverReset && serverReset !== localReset) {
            try { localStorage.removeItem(STATS_KEY); } catch (e) {}
            try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
            try { localStorage.setItem(RESET_TOKEN_KEY, serverReset); } catch (e) {}
            // сбрасываем in-memory статы, чтобы сразу обновились очки/рекомендации в интерфейсе
            try { stats = {}; } catch (e) {}
            try { clearAptitudeMenuRecommendations(); } catch (e) {}
        }

        // Если админ удалил пользователя: при следующем открытии WebApp нужно очистить localStorage.
        // Делаем это по тем же правилам, как и подхват отключённых уровней (через /api/levels без initData).
        try {
            const serverExists = data?.user_exists;
            const serverDeleted = String(data?.user_deleted_token ?? '0');
            const localDeleted = String(localStorage.getItem(USER_DELETED_TOKEN_KEY) ?? '0');
            if (serverExists === false && (serverDeleted !== localDeleted)) {
                try { localStorage.removeItem(STATS_KEY); } catch (e) {}
                try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
                try { localStorage.setItem(USER_DELETED_TOKEN_KEY, serverDeleted); } catch (e) {}
                try { stats = {}; } catch (e) {}
                try { clearAptitudeMenuRecommendations(); } catch (e) {}
            }
        } catch (e) {}

        // Локальный сброс только одного пользователя (через админку):
        // токен приходит из /api/levels без initData, поэтому работает так же надёжно,
        // как и отключение уровней.
        try {
            const serverUserReset = String(data?.user_reset_token ?? '0');
            const localUserReset = String(localStorage.getItem(USER_RESET_TOKEN_KEY) ?? '0');
            if (serverUserReset && serverUserReset !== localUserReset) {
                try { localStorage.removeItem(STATS_KEY); } catch (e) {}
                try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
                try { localStorage.setItem(USER_RESET_TOKEN_KEY, serverUserReset); } catch (e) {}
                try { stats = {}; } catch (e) {}
                try { clearAptitudeMenuRecommendations(); } catch (e) {}
                try { renderLevelMenuStats(); } catch (e) {}
            }
        } catch (e) {}

        // Если админ сбросил статистику ТОЛЬКО у этого пользователя —
        // очищаем localStorage, не затрагивая остальных.
        try {
            const serverUserReset = String(data?.user_reset_token ?? '0');
            const localUserReset = String(localStorage.getItem(USER_RESET_TOKEN_KEY) ?? '0');
            if (serverUserReset && serverUserReset !== localUserReset) {
                try { localStorage.removeItem(STATS_KEY); } catch (e) {}
                try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
                try { localStorage.setItem(USER_RESET_TOKEN_KEY, serverUserReset); } catch (e) {}
                try { stats = {}; } catch (e) {}
                try { clearAptitudeMenuRecommendations(); } catch (e) {}
            }
        } catch (e) {}

        // 2) Частный случай: если пользователя удалили/сбросили и на сервере нет результата профтеста —
        // локальный localStorage может «сохранить» старый результат и показывать его после повторной регистрации.
        const serverTop = data?.user?.aptitude_top;

        if (!data?.exists || !serverTop) {
            try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
            try { clearAptitudeMenuRecommendations(); } catch (e) {}
        }
    } catch (e) {
        // silently ignore
    }
}

// Telegram WebApp часто НЕ перезагружает страницу при повторном открытии мини‑веба.
// Из-за этого DOMContentLoaded может не сработать повторно, и синхронизация со сбросом
// статистики из админки не выполняется. Поэтому делаем принудительную синхронизацию
// при возврате в WebView (focus/visibilitychange) и после синка обновляем UI.
async function syncResetAndRefreshUI() {
    await syncAptitudeWithServer();
    // После возможной очистки localStorage перезагружаем in-memory статы и обновляем меню.
    try { stats = loadStats(); } catch (e) {}
    try { renderLevelMenuStats(); } catch (e) {}
    try {
        const savedApt = loadSavedAptitudeResult();
        if (savedApt) applyAptitudeRecommendationsToMenu(savedApt);
        else clearAptitudeMenuRecommendations();
    } catch (e) {}
}

let _syncResetBusy = false;
let _syncResetLastAt = 0;
function syncResetAndRefreshUIThrottled() {
    const now = Date.now();
    if (_syncResetBusy) return;
    // Не чаще, чем раз в 2 секунды — чтобы не спамить /api/me.
    if (now - _syncResetLastAt < 2000) return;
    _syncResetLastAt = now;
    _syncResetBusy = true;
    Promise.resolve(syncResetAndRefreshUI()).finally(() => {
        _syncResetBusy = false;
    });
}

async function loadLevelAvailability() {
    try {
        const uid = tg?.initDataUnsafe?.user?.id;
        const levelsPath = uid ? `/api/levels?uid=${encodeURIComponent(String(uid))}` : '/api/levels';
        const res = await fetch(apiUrl(levelsPath), { cache: 'no-store' });
        const data = await res.json();
        // Сброс статистики в админке должен подхватываться в WebApp так же,
        // как и отключение уровней (и без зависимости от initData / CORS-preflight).
        // Поэтому используем reset_token, который сервер возвращает в /api/levels.
        try {
            const serverReset = String(data?.reset_token ?? '0');
            const localReset = String(localStorage.getItem(RESET_TOKEN_KEY) ?? '0');
            if (serverReset && serverReset !== localReset) {
                try { localStorage.removeItem(STATS_KEY); } catch (e) {}
                try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
                try { localStorage.setItem(RESET_TOKEN_KEY, serverReset); } catch (e) {}
                // сбрасываем in-memory, чтобы UI обновился сразу
                try { stats = {}; } catch (e) {}
                try { clearAptitudeMenuRecommendations(); } catch (e) {}
                try { renderLevelMenuStats(); } catch (e) {}
            }
        } catch (e) {}
        // Если админ удалил пользователя: при следующем открытии WebApp нужно очистить localStorage.
        // Делаем это так же надёжно, как и подхват отключённых уровней — через /api/levels (без initData).
        try {
            const serverExists = data?.user_exists;
            const serverDeleted = String(data?.user_deleted_token ?? '0');
            const localDeleted = String(localStorage.getItem(USER_DELETED_TOKEN_KEY) ?? '0');
            if (serverExists === false && serverDeleted && serverDeleted !== localDeleted) {
                try { localStorage.removeItem(STATS_KEY); } catch (e) {}
                try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
                try { localStorage.setItem(USER_DELETED_TOKEN_KEY, serverDeleted); } catch (e) {}
                // сбрасываем in-memory, чтобы UI обновился сразу
                try { stats = {}; } catch (e) {}
                try { clearAptitudeMenuRecommendations(); } catch (e) {}
                try { renderLevelMenuStats(); } catch (e) {}
            }
        } catch (e) {}

        // Локальный сброс только одного пользователя (через админку).
        try {
            const serverUserReset = String(data?.user_reset_token ?? '0');
            const localUserReset = String(localStorage.getItem(USER_RESET_TOKEN_KEY) ?? '0');
            if (serverUserReset && serverUserReset !== localUserReset) {
                try { localStorage.removeItem(STATS_KEY); } catch (e) {}
                try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
                try { localStorage.setItem(USER_RESET_TOKEN_KEY, serverUserReset); } catch (e) {}
                // сбрасываем in-memory, чтобы UI обновился сразу
                try { stats = {}; } catch (e) {}
                try { clearAptitudeMenuRecommendations(); } catch (e) {}
                try { renderLevelMenuStats(); } catch (e) {}
            }
        } catch (e) {}
        LEVEL_AVAIL = data && data.levels ? data.levels : null;
    } catch (e) {
        LEVEL_AVAIL = null;
    }
}

function isLevelActive(levelKey) {
    if (!LEVEL_AVAIL) return true; // если сервер недоступен/не настроен — ничего не блокируем
    if (LEVEL_AVAIL[levelKey] === undefined) return true;
    return !!LEVEL_AVAIL[levelKey];
}

function applyLevelAvailabilityToMenu() {
    try {
        document.querySelectorAll('[data-level]').forEach((btn) => {
            const key = btn.dataset.level;
            const active = isLevelActive(key);

            // Скрываем/показываем карточку уровня целиком
            const card = btn.closest('.level-card');
            const target = card || btn;

            if (!active) {
                target.style.display = 'none';
                return;
            } else {
                target.style.display = '';
            }

            // На всякий случай: если где-то остались старые стили блокировки
            btn.disabled = false;
            btn.style.opacity = '';
            if (btn.dataset._origText) btn.textContent = btn.dataset._origText;
        });
    } catch (e) {}
}

const STATS_KEY = 'apzQuestStatsV1';
const RESET_TOKEN_KEY = 'apzStatsResetTokenV1';
const USER_DELETED_TOKEN_KEY = 'apzUserDeletedTokenV1';
const USER_RESET_TOKEN_KEY = 'apzUserResetTokenV1';

// Локальная статистика хранится в localStorage и должна сохраняться между запусками WebApp.
// Локальная статистика хранится в localStorage и должна сохраняться между запусками WebApp.

// Результаты профтеста "что тебе подходит?" и рекомендации (⭐)
// должны сохраняться между запусками WebApp.
// Сброс результата теста выполняется при перепрохождении (кнопка «Пройти ещё раз» в тесте) или при админском сбросе/удалении пользователя.

function loadStats() {
    try {
        const raw = localStorage.getItem(STATS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}
function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
}
let stats = loadStats();

function formatTime(ms) {
    if (!ms && ms !== 0) return '—';
    const sec = Math.round(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}м ${s}с` : `${s}с`;
}

function formatPoints(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return '—';
    const abs = Math.abs(score) % 100;
    const last = abs % 10;
    let word = 'баллов';
    if (abs < 11 || abs > 14) {
        if (last === 1) word = 'балл';
        else if (last >= 2 && last <= 4) word = 'балла';
    }
    return `${score} ${word}`;
}

function renderLevelMenuStats() {
    // Пазлы (время)
    const p22 = document.getElementById('stat-puzzle-2x2');
    const p33 = document.getElementById('stat-puzzle-3x3');
    const p44 = document.getElementById('stat-puzzle-4x4');
    if (p22) p22.textContent = formatTime(stats['puzzle-2x2']?.bestTimeMs);
    if (p33) p33.textContent = formatTime(stats['puzzle-3x3']?.bestTimeMs);
    if (p44) p44.textContent = formatTime(stats['puzzle-4x4']?.bestTimeMs);

    // Скоринговые уровни
    const j = document.getElementById('stat-jumper');
    const g = document.getElementById('stat-2048');
    const q = document.getElementById('stat-quiz');
    if (j) j.textContent = formatPoints(stats['jumper']?.bestScore);
    if (g) g.textContent = formatPoints(stats['factory-2048']?.bestScore);
    if (q) q.textContent = formatPoints(stats['quiz']?.bestScore);
}

function notify(msg) {
    try {
        if (tg?.showPopup) {
            tg.showPopup({ message: msg, buttons: [{ type: 'ok', text: 'OK' }] });
        } else if (typeof alert === 'function') {
            alert(msg);
        }
    } catch (e) {}
}

function exportStats() {
    // По требованиям: экран "Финиш" показываем ТОЛЬКО когда пользователь нажимает "Сохранить статистику".
    // Уже с этого экрана он решит: вернуться в игру или уйти в Telegram к статистике.
    showFinalScreenFromStats();
}

// Итоговый счёт: сумма bestScore по сыгранным уровням.
// Это значение отправляем боту в поле `score`, чтобы команда /stats показывала корректные данные.
function computeTotalScore() {
    try {
        const order = ['puzzle-2x2', 'puzzle-3x3', 'puzzle-4x4', 'jumper', 'factory-2048', 'quiz'];
        let total = 0;
        for (const id of order) {
            const s = stats?.[id];
            if (!s || (s.plays || 0) <= 0) continue;
            const bs = s.bestScore;
            if (typeof bs === 'number' && Number.isFinite(bs)) total += bs;
        }
        return total;
    } catch (e) {
        return 0;
    }
}

function buildStatsPayload() {
    const savedApt = loadSavedAptitudeResult();
    return {
        type: 'apz_stats',
        version: 1,
        exportedAt: new Date().toISOString(),
        message: 'Игра завершена. Открываю статистику.',
        // Главное поле для бота (таблица лидеров)
        score: computeTotalScore(),
        // Ведущее направление по профтесту (если проходили)
        aptitude_top: (savedApt && savedApt.main) ? savedApt.main : null,
        // Подробная статистика остаётся в payload на будущее
        stats
    };
}

function showFinalScreenFromStats() {
    // Финал — это НЕ автопереход после квиза, а ручной вызов из меню уровней.
    // Обновляем список сыгранных уровней и общий итог.
    const list = document.getElementById('final-stats-list');
    if (list) list.innerHTML = '';

    let totalScore = 0;
    const playedIds = Object.keys(LEVEL_DEFS).filter(id => (stats[id]?.plays || 0) > 0);

    // Удобный порядок показа
    const order = ['puzzle-2x2', 'puzzle-3x3', 'puzzle-4x4', 'jumper', 'factory-2048', 'quiz'];
    const ids = order.filter(id => playedIds.includes(id));

    if (ids.length === 0 && list) {
        list.innerHTML = '<div class="score-row"><span>Пока нет сыгранных уровней</span><span>—</span></div>';
    }

    ids.forEach(id => {
        const def = LEVEL_DEFS[id];
        const s = stats[id] || {};

        // Значение для отображения
        let valueText = '—';
        let scoreForTotal = 0;

        if (def.stat === 'time') {
            // Для пазлов показываем лучшее время и набранные за него баллы.
            const bestTimeText = formatTime(s.bestTimeMs);
            scoreForTotal = (typeof s.bestScore === 'number') ? s.bestScore : 0;
            valueText = (bestTimeText !== '—' && scoreForTotal > 0)
                ? `${bestTimeText} - ${scoreForTotal}б`
                : bestTimeText;
        } else {
            scoreForTotal = (typeof s.bestScore === 'number') ? s.bestScore : 0;
            valueText = (typeof s.bestScore === 'number' && Number.isFinite(s.bestScore))
                ? `${scoreForTotal}б`
                : '—';
        }

        totalScore += scoreForTotal;

        if (list) {
            const row = document.createElement('div');
            row.className = 'score-row';
            row.innerHTML = `<span>${def.title}:</span> <span>${valueText}</span>`;
            list.appendChild(row);
        }
    });

    // Плавная анимация итогового счёта
    const scoreVal = document.getElementById('final-score-val');
    if (scoreVal) {
        let displayScore = 0;
        const step = Math.max(1, Math.ceil(totalScore / 50));
        scoreVal.textContent = '0';
        const timer = setInterval(() => {
            displayScore += step;
            if (displayScore >= totalScore) {
                displayScore = totalScore;
                clearInterval(timer);
            }
            scoreVal.textContent = String(displayScore);
        }, 30);
    }

// Показываем "Твой профиль..." ТОЛЬКО если в текущем запуске проходили профтест
const savedApt = loadSavedAptitudeResult();
const statLine = document.getElementById('aptitude-stat-line');
const statMain = document.getElementById('stat-aptitude-main');
if (statLine && statMain && savedApt && savedApt.main) {
    const LABEL = {
        PEOPLE: '🤝 Работа с людьми',
        RESEARCH: '🔬 Исследовательская деятельность',
        PRODUCTION: '🏭 Работа на производстве',
        AESTHETIC: '🎨 Эстетические виды деятельности',
        EXTREME: '🧗 Экстремальные виды деятельности',
        PLAN_ECON: '📊 Планово‑экономические виды деятельности',
    };
    statMain.textContent = LABEL[savedApt.main] || savedApt.main;
    statLine.style.display = '';
} else if (statLine) {
    if (statMain) statMain.textContent = '—';
    statLine.style.display = 'none';
}

    showScreen('screen-final');
}

async function saveStatsForMax(payload) {
    if (!mx?.initData) return false;

    const res = await fetch(apiUrl('/api/max/save_stats'), {
        method: 'POST',
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
            'X-Max-InitData': mx.initData
        },
        body: JSON.stringify(payload)
    });

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data?.ok) {
        const msg = data?.message || 'Не удалось сохранить статистику. Попробуйте открыть игру из MAX ещё раз.';
        throw new Error(msg);
    }
    return true;
}

async function sendStatsAndClose() {
    const payload = buildStatsPayload();

    // В Telegram WebApp: отправляем данные и закрываем WebApp
    if (tg?.sendData) {
        try {
            tg.sendData(JSON.stringify(payload));
            // Закрываем, чтобы пользователь вернулся в Telegram и увидел сообщение бота
            tg.close();
            return;
        } catch (e) {}
    }

    // В MAX Mini App: сначала сохраняем статистику на сервере, потом закрываем mini app.
    if (mx?.initData) {
        try {
            await saveStatsForMax(payload);
        } catch (e) {
            notify((e && e.message) ? e.message : 'Не удалось сохранить статистику 😕');
            return;
        }

        if (mx?.close) {
            try {
                mx.close();
                return;
            } catch (e) {}
        }
    }

    // В MAX Mini App (MAX Bridge): просто закрываем мини‑приложение.
    // ВАЖНО: close() работает только внутри MAX. Если страница открыта во внешнем браузере — этого метода нет.
    if (mx?.close) {
        try {
            mx.close();
            return;
        } catch (e) {}
    }

    // Если мы оказались во внешнем браузере (часто так бывает в MAX, когда бот отправляет обычную ссылку),
    // то "закрыть" и вернуться в MAX программно нельзя. Единственный рабочий путь — открыть диплинк MAX.
    // Ссылка https://max.ru обычно подхватывается приложением MAX (если установлено).
    try {
        const returnUrl = (new URL(window.location.href)).searchParams.get('return') || '';
        const target = returnUrl && /^https:\/\/max\.ru\//.test(returnUrl) ? returnUrl : 'https://max.ru';
        window.location.href = target;
        return;
    } catch (e) {}


    // В обычном браузере: скачиваем JSON
    try {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'apz_stats.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify('Файл статистики сохранён ✅');
    } catch (e) {
        notify('Не удалось сохранить статистику 😕');
    }
}

// Подтверждение перед закрытием WebApp и переходом в Telegram к статистике.
// Требование: при нажатии «Отмена» пользователь остаётся в WebApp и может продолжать играть.
function confirmSendStatsAndClose() {
    const msg =
        'Сейчас будет переход в Telegram для отображения статистики.\n\n' +
        'Если хотите продолжить играть — нажмите «Отмена».\n' +
        'Чтобы открыть статистику — нажмите «К статистике».\n\n' +
        'После перехода веб‑приложение будет закрыто.';

    // Telegram WebApp: показываем системный popup с 2 кнопками.
    if (tg?.showPopup) {
        try {
            tg.showPopup(
                {
                    message: msg,
                    buttons: [
                        { id: 'go', type: 'default', text: 'К статистике' },
                        { id: 'cancel', type: 'cancel', text: 'Отмена' }
                    ]
                },
                (btnId) => {
                    if (btnId === 'go') sendStatsAndClose();
                }
            );
            return;
        } catch (e) {}
    }

    // Фолбэк (браузер/не Telegram): стандартный confirm.
    try {
        if (typeof confirm === 'function') {
            const ok = confirm(
                'Сейчас будет переход к статистике.\n\n' +
                'Нажмите OK, чтобы продолжить, или Отмена, чтобы вернуться в игру.'
            );
            if (ok) sendStatsAndClose();
            return;
        }
    } catch (e) {}

    // Если ни confirm ни popup недоступны — просто выполняем действие.
    sendStatsAndClose();
}

const WELCOME_DIALOGUES = {
    max: [
        'Макс: Привет! Давайте знакомиться, я Макс',
        'Макс: Я покажу тебе, как у нас всё устроено',
        'Макс: Готов пройти смену?'
    ],
    asya: [
        'Ася: А я Ася, <br>мы сотрудники завода',
        'Ася: Поможем тебе<br> освоиться',
        'Ася: Будет интересно!'
    ]
};

let welcomeDialogueTimer = null;
let welcomeDialogueStartTimer = null;
let welcomeDialogueStep = 0;

const WELCOME_DIALOGUE_INTERVAL_MS = 3200;
const WELCOME_DIALOGUE_FIRST_EXTRA_MS = 3000;

function setWelcomeSpeechText(el, text) {
    if (!el) return;
    const safeText = String(text || '');
    const colonIndex = safeText.indexOf(':');
    if (colonIndex !== -1) {
        const speaker = safeText.slice(0, colonIndex + 1);
        const phrase = safeText.slice(colonIndex + 1).trim();
        el.innerHTML = `<strong>${speaker}</strong> ${phrase ? `«${phrase}»` : ''}`;
        return;
    }
    el.textContent = safeText;
}

function switchWelcomeSpeech(el, nextText) {
    if (!el) return;
    el.classList.add('fade-out');
    setTimeout(() => {
        setWelcomeSpeechText(el, nextText);
        el.classList.remove('fade-out');
    }, 350);
}

function stopWelcomeDialogueRotation() {
    if (welcomeDialogueTimer) {
        clearInterval(welcomeDialogueTimer);
        welcomeDialogueTimer = null;
    }
    if (welcomeDialogueStartTimer) {
        clearTimeout(welcomeDialogueStartTimer);
        welcomeDialogueStartTimer = null;
    }
}

function startWelcomeDialogueRotation() {
    const maxEl = document.getElementById('max-speech-text');
    const asyaEl = document.getElementById('asya-speech-text');
    if (!maxEl || !asyaEl) return;

    stopWelcomeDialogueRotation();
    welcomeDialogueStep = 0;
    setWelcomeSpeechText(maxEl, WELCOME_DIALOGUES.max[0]);
    setWelcomeSpeechText(asyaEl, WELCOME_DIALOGUES.asya[0]);

    const rotateWelcomeDialogue = () => {
        welcomeDialogueStep = (welcomeDialogueStep + 1) % WELCOME_DIALOGUES.max.length;
        switchWelcomeSpeech(maxEl, WELCOME_DIALOGUES.max[welcomeDialogueStep]);
        switchWelcomeSpeech(asyaEl, WELCOME_DIALOGUES.asya[welcomeDialogueStep]);
    };

    welcomeDialogueStartTimer = setTimeout(() => {
        rotateWelcomeDialogue();
        welcomeDialogueTimer = setInterval(rotateWelcomeDialogue, WELCOME_DIALOGUE_INTERVAL_MS);
        welcomeDialogueStartTimer = null;
    }, WELCOME_DIALOGUE_INTERVAL_MS + WELCOME_DIALOGUE_FIRST_EXTRA_MS);
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const s = document.getElementById(screenId);
    if (s) s.classList.add('active');

    if (screenId === 'screen-welcome') startWelcomeDialogueRotation();
    else stopWelcomeDialogueRotation();

    const isLevelScreen = (screenId === 'screen-level1' || screenId === 'screen-level2' || screenId === 'screen-level3' || screenId === 'screen-level4');
    const isAptitudeTest = (screenId === 'screen-aptitude');
    const isAptitudeResult = (screenId === 'screen-aptitude-result');
    const isProfessionsScreen = (screenId === 'screen-professions');

    // Верхняя кнопка "К уровням":
    // - во время прохождения уровня: видна сверху
    // - в тесте: видна сверху
    // - уровень пройден: сверху пропадает
    // - на приветствии и в меню уровней: скрыта
    const topbar = document.getElementById('global-topbar');
    if (topbar) {
        const showTop = ((isLevelScreen && !levelCompleted) || isAptitudeTest || isProfessionsScreen);
        topbar.classList.toggle('hidden', !showTop);
    }

    // Нижняя кнопка "К уровням":
    // - на уровнях появляется только когда уровень пройден
    // - на экране результатов теста всегда видна снизу
    const bottombar = document.getElementById('global-bottombar');
    if (bottombar) {
        const showBottom = ((isLevelScreen && afterLevelShown) || isAptitudeResult);
        bottombar.classList.toggle('hidden', !showBottom);
    }

    // Кнопка звука скрыта на стартовом экране и появляется после нажатия «Начать смену»
    const soundBtn = document.getElementById('btn-sound-toggle');
    if (soundBtn) {
        const isLevelScreen = /^screen-level[1-4]$/.test(screenId);
        const showSound = (screenId === 'screen-levels' || isAptitudeTest || isAptitudeResult || isProfessionsScreen || isLevelScreen);
        soundBtn.classList.toggle('hidden', !showSound);
    }
}


function showLevels() {
    hideAfterLevel();

    showScreen('screen-levels');
    renderLevelMenuStats();
    loadLevelAvailability().then(() => applyLevelAvailabilityToMenu());
    // Подсветка рекомендаций по тесту (если уже проходили)
    const savedApt = loadSavedAptitudeResult();
// Показываем в статистике только ведущее направление (если есть)
const statLine = document.getElementById('aptitude-stat-line');
const statMain = document.getElementById('stat-aptitude-main');
if (statLine && statMain && savedApt && savedApt.main) {
    const LABEL = {
        PEOPLE: '🤝 Работа с людьми',
        RESEARCH: '🔬 Исследовательская деятельность',
        PRODUCTION: '🏭 Работа на производстве',
        AESTHETIC: '🎨 Эстетические виды деятельности',
        EXTREME: '🧗 Экстремальные виды деятельности',
        PLAN_ECON: '📊 Планово‑экономические виды деятельности',
    };
    statMain.textContent = LABEL[savedApt.main] || savedApt.main;
    statLine.style.display = '';
} else if (statLine) {
    statLine.style.display = 'none';
}
    if (savedApt) {
        try { applyAptitudeRecommendationsToMenu(savedApt); } catch (e) {}
    }
    // Защита от "тапа-сквозь": сразу после перехода в меню уровней.
    // На некоторых Android/WebView "стартовый" тап прилетает с задержкой,
    // поэтому держим блокировку чуть дольше.
    lockClicks(900);
}

// При выходе из уровня важно остановить активные игровые циклы (особенно Jumper),
// иначе они продолжат жечь CPU в фоне.
function stopJumperNow() {
    try {
        gameActive = false;
        if (doodleGameLoop) cancelAnimationFrame(doodleGameLoop);
        doodleGameLoop = 0;
        keys.left = false; keys.right = false;
        pendingTouchMove = 0; pendingTouchSide = 0;
        if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }

        const container = document.getElementById('doodle-container');
        const ui = document.getElementById('doodle-ui');
        const startMsg = document.getElementById('doodle-start-msg');
        const gate = document.getElementById('after-level-container');
        const over = document.getElementById('game-over-overlay');
        const victory = document.getElementById('victory-overlay');

        if (container) {
            container.classList.remove('game-running');
            container.style.display = '';
        }
        if (ui) ui.style.display = '';
        if (startMsg) startMsg.style.display = '';
        if (gate) {
            gate.style.display = 'none';
            gate.classList.remove('gate-visible', 'lights-on');
        }
        if (over) over.classList.remove('visible');
        if (victory) victory.classList.remove('visible');
        setDoodleControlsState(false);
    } catch (e) {}
}


// ==========================================
// ЭКРАН ПОСЛЕ ПРОХОЖДЕНИЯ УРОВНЯ (картинка + текст)
// ==========================================
const AFTER_LEVEL_DATA = {
    // Пазлы (все размеры)
    'puzzle-2x2': { title: '🧩 Мастерская деталей открыта!', text: 'Ты собрал все части вместе. Настоящий мастер своего дела 🔧', img: 'assets/after_puzzle.webp' },
    'puzzle-3x3': { title: '🧩 Мастерская деталей открыта!', text: 'Ты собрал все части вместе. Настоящий мастер своего дела 🔧', img: 'assets/after_puzzle.webp' },
    'puzzle-4x4': { title: '🧩 Мастерская деталей открыта!', text: 'Ты собрал все части вместе. Настоящий мастер своего дела 🔧', img: 'assets/after_puzzle.webp' },

    // Jumper
    'jumper': { title: '🏁 Испытания пройдены!', text: 'Ты ловкий и быстрый! Завод может на тебя положиться 💪', img: 'assets/after_jumper.webp' },

    // 2048
    'factory-2048': { title: '🔓 Сборочный цех пройден!', text: 'Ты правильно собрал детали! Линия сборки работает без сбоев 🚀', img: 'assets/after_2048.webp' },

    // Quiz
    'quiz': { title: '🎓 Экзамен сдан!', text: 'Ты доказал, что знаешь, как работает завод 🧠⚙️', img: 'assets/after_quiz.webp' }
};

function hideAfterLevel() {
    const c = document.getElementById('after-level-container');
    if (c) {
        c.style.display = 'none';
        c.classList.remove('gate-visible', 'lights-on');
    }

    // Экран после уровня скрыт — нижняя кнопка "К уровням" не должна показываться
    afterLevelShown = false;
    try {
        const active = document.querySelector('.screen.active');
        if (active && active.id) showScreen(active.id);
    } catch (e) {}

    // Вернём скрытые элементы интерфейса (если прятали для экрана "после уровня")
    try {
        const board = document.getElementById('puzzle-board');
        const status = document.getElementById('puzzle-status');
        if (board) board.style.display = '';
        if (status) status.style.display = '';

        // Пазл: заголовок и подсказка
        const pzH = document.querySelector('#screen-level1 h2');
        const pzP = document.querySelector('#screen-level1 > p');
        if (pzH) pzH.style.display = '';
        if (pzP) pzP.style.display = '';

        const grid = document.getElementById('grid-container');
        if (grid) grid.style.display = '';

        // 2048: заголовок, подсказки, счет и кнопка перезапуска
        const fH = document.querySelector('#screen-level3 h2');
        const fP = document.querySelector('#screen-level3 > p');
        const fHeader = document.querySelector('#screen-level3 .game-2048-header');
        const fSwipe = document.querySelector('#screen-level3 p.instruction');
        if (fH) fH.style.display = '';
        if (fP) fP.style.display = '';
        if (fHeader) fHeader.style.display = '';
        if (fSwipe) fSwipe.style.display = '';

        const qc = document.getElementById('quiz-container');
        if (qc) qc.style.display = '';

        // Квиз: заголовок и статус прогресса
        const qH = document.querySelector('#screen-level4 h2');
        const qProg = document.getElementById('quiz-progress');
        if (qH) qH.style.display = '';
        if (qProg) qProg.style.display = '';

        const dc = document.getElementById('doodle-container');
        const du = document.getElementById('doodle-ui');
        const sm = document.getElementById('doodle-start-msg');
        if (dc) dc.style.display = '';
        if (du) du.style.display = '';
        if (sm) sm.style.display = '';
    } catch (e) {}
}

function showAfterLevel(levelId) {
    const data = AFTER_LEVEL_DATA[levelId];
    const c = document.getElementById('after-level-container');
    if (!c) return;

    // На всякий случай очистим предыдущие классы/состояние
    c.classList.remove('gate-visible', 'lights-on');

    // Подставим контент
    const titleEl = document.getElementById('after-level-title');
    const textEl = document.getElementById('after-level-text');
    const imgEl = document.getElementById('after-level-img');
    const srcEl = document.getElementById('after-level-source');

    if (data) {
        if (titleEl) titleEl.textContent = data.title;
        if (textEl) textEl.textContent = data.text;
        if (imgEl) {
            imgEl.src = data.img;
            imgEl.alt = data.title || 'Экран после уровня';
        }
        if (srcEl) srcEl.srcset = data.img;
    }

    // Спрячем игровые элементы текущего уровня, чтобы не перекрывались
    try {
        if (levelId.startsWith('puzzle')) {
            // На экране "после уровня" не показываем заголовок и подсказку пазла
            const pzH = document.querySelector('#screen-level1 h2');
            const pzP = document.querySelector('#screen-level1 > p');
            if (pzH) pzH.style.display = 'none';
            if (pzP) pzP.style.display = 'none';

            const board = document.getElementById('puzzle-board');
            const status = document.getElementById('puzzle-status');
            if (board) board.style.display = 'none';
            if (status) status.style.display = 'none';
        } else if (levelId === 'factory-2048') {
            // На экране "после уровня" убираем подсказки, счет и кнопку перезапуска
            const fH = document.querySelector('#screen-level3 h2');
            const fP = document.querySelector('#screen-level3 > p');
            const fHeader = document.querySelector('#screen-level3 .game-2048-header');
            const fSwipe = document.querySelector('#screen-level3 p.instruction');
            if (fH) fH.style.display = 'none';
            if (fP) fP.style.display = 'none';
            if (fHeader) fHeader.style.display = 'none';
            if (fSwipe) fSwipe.style.display = 'none';

            const grid = document.getElementById('grid-container');
            if (grid) grid.style.display = 'none';
        } else if (levelId === 'quiz') {
            // На экране "после уровня" для квиза не показываем заголовок и статус прогресса
            const qH = document.querySelector('#screen-level4 h2');
            const qProg = document.getElementById('quiz-progress');
            if (qH) qH.style.display = 'none';
            if (qProg) qProg.style.display = 'none';
            const qc = document.getElementById('quiz-container');
            if (qc) qc.style.display = 'none';
        } else if (levelId === 'jumper') {
            const dc = document.getElementById('doodle-container');
            const du = document.getElementById('doodle-ui');
            const sm = document.getElementById('doodle-start-msg');
            if (dc) dc.style.display = 'none';
            if (du) du.style.display = 'none';
            if (sm) sm.style.display = 'none';
        }
    } catch (e) {}

    // Важно: контейнер #after-level-container изначально находится в разметке экрана Jumper.
    // Чтобы он был видим после прохождения ЛЮБОГО уровня, переносим его в текущий активный экран.
    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen && !activeScreen.contains(c)) {
        activeScreen.appendChild(c);
    }

    c.style.display = 'block';

    // Экран после уровня показан — можно показывать нижнюю кнопку "К уровням"
    afterLevelShown = true;
    try {
        const active = document.querySelector('.screen.active');
        if (active && active.id) showScreen(active.id);
    } catch (e) {}


    // Плавно проявляем блок (CSS transition)
    requestAnimationFrame(() => c.classList.add('gate-visible'));

    // Затем включаем "свет" на картинке
    setTimeout(() => {
        c.classList.add('lights-on');
    }, 150);
}

function exitToLevels() {
    // Останавливаем активные циклы
    stopJumperNow();
    // (2048/quiz/puzzle не крутят rAF-цикл постоянно)
    showLevels();
}

// Текущее прохождение
let currentLevelId = null;
let levelStartTime = 0; // Для засекания времени
let levelCompleted = false; // Для переключения кнопок "К уровням" (верх/низ)
let afterLevelShown = false; // Появление нижней кнопки только на экране после уровня

async function startLevel(levelId) {
    hideAfterLevel();

    // защита от старых вызовов
    if (typeof levelId === 'number') return startGame(levelId);

    if (!isLevelActive(levelId)) {
        // На всякий случай обновим меню (если админ выключил уровень прямо сейчас)
        applyLevelAvailabilityToMenu();
        showLevels();
        return;
    }

    const def = LEVEL_DEFS[levelId];
    if (!def) return showLevels();

    await preloadLevelAssets(levelId);

    currentLevelId = levelId;
    levelStartTime = Date.now();
    levelCompleted = false;

    // Plays++
    stats[levelId] = stats[levelId] || { plays: 0, completions: 0 };
    stats[levelId].plays = (stats[levelId].plays || 0) + 1;
    saveStats(stats);

    if (def.type === 'puzzle') {
        showScreen('screen-level1');
        initPuzzle(def.puzzleSize);
    } else if (def.type === 'jumper') {
        preloadAfterJumperInBackground();
        showScreen('screen-level2');
        initJumper();
    } else if (def.type === '2048') {
        showScreen('screen-level3');
        init2048();
    } else if (def.type === 'quiz') {
        showScreen('screen-level4');
        initQuiz();
    }
}

function finishLevel({ score = null, timeMs = null } = {}) {
    const levelId = currentLevelId;
    if (!levelId) return;

    // Уровень завершён — нужно переключить навигацию: верхняя кнопка скрывается, нижняя появляется.
    levelCompleted = true;

    stats[levelId] = stats[levelId] || { plays: 0, completions: 0 };
    stats[levelId].completions = (stats[levelId].completions || 0) + 1;

    if (typeof timeMs === 'number') {
        const best = stats[levelId].bestTimeMs;
        if (best == null || timeMs < best) stats[levelId].bestTimeMs = timeMs;
        stats[levelId].lastTimeMs = timeMs;
    }
    if (typeof score === 'number') {
        const best = stats[levelId].bestScore;
        if (best == null || score > best) stats[levelId].bestScore = score;
        stats[levelId].lastScore = score;
    }
    saveStats(stats);
    renderLevelMenuStats();

    // Обновим видимость кнопок "К уровням" на текущем экране.
    // (пазл/2048/квиз остаются на том же экране, поэтому важно переключить сразу)
    const active = document.querySelector('.screen.active');
    if (active && active.id) showScreen(active.id);
}


// Совместимость со старым финальным экраном
let levelScores = { 1: 0, 2: 0, 3: 0, 4: 0 };
// ==========================================
// НАВИГАЦИЯ
// ==========================================
function startGame(level) {
    // Совместимость со старой линейной навигацией (кнопки "Далее")
    const map = { 1: 'puzzle-3x3', 2: 'jumper', 3: 'factory-2048', 4: 'quiz' };
    const id = map[level] || 'puzzle-3x3';
    startLevel(id);
}

// ==========================================
// УРОВЕНЬ 1: ПАЗЛ (Логика)
// ==========================================
let puzzleSize = 3;
let puzzleState = [];
let selectedPieceNum = null;
let puzzleSolved = false;
function initPuzzle(size = 3) {
    puzzleSize = size;

    // Заголовок/подсказка
    const h2 = document.querySelector('#screen-level1 h2');
    if (h2) {
        const label = (size === 2) ? '2×2' : (size === 3) ? '3×3' : '4×4';
        h2.textContent = `🧩 Уровень: Логотип (${label})`;
    }

    const status = document.getElementById('puzzle-status');
    if (status) { status.textContent = ''; }

    const total = puzzleSize * puzzleSize;
    puzzleState = Array.from({ length: total }, (_, i) => i + 1);
    puzzleSolved = false;
    selectedPieceNum = null;

    // Перемешиваем так, чтобы пазл НЕ стартовал уже собранным
    // (в 2×2 шанс «сразу собран» заметный, поэтому добавляем проверку).
    const isSolved = (arr) => arr.every((val, idx) => val === idx + 1);
    const fisherYates = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    };
    // На всякий случай ограничим попытки, но обычно хватает 1–2.
    let tries = 0;
    do {
        fisherYates(puzzleState);
        tries++;
    } while (isSolved(puzzleState) && tries < 20);

    createPuzzleElements();
    updatePuzzlePositions();

    if (status) { status.textContent = ''; }
    // Кнопки "Далее" убраны — после прохождения остаётся только возврат в меню уровней.
}
function createPuzzleElements() {
    const board = document.getElementById('puzzle-board');
    board.innerHTML = '';

    const total = puzzleSize * puzzleSize;
    const tilePercent = 100 / puzzleSize;

    for (let i = 1; i <= total; i++) {
        const div = document.createElement('div');
        div.className = 'puzzle-piece';
        div.id = `piece-${i}`;

        // Размер клетки
        div.style.width = `${tilePercent}%`;
        div.style.height = `${tilePercent}%`;

        // Одна картинка (board.webp), показываем нужный кусок
        const correctIndex = i - 1;
        const correctRow = Math.floor(correctIndex / puzzleSize);
        const correctCol = correctIndex % puzzleSize;

        const puzzleImage = (puzzleSize === 2)
            ? assetPath('logo', 'jpg')
            : (puzzleSize === 3)
                ? assetPath('logo_3x3', 'jpg')
                : assetPath('logo_4x4', 'jpg');
        div.style.backgroundImage = `url('${puzzleImage}')`;
        div.style.backgroundSize = `${puzzleSize * 100}% ${puzzleSize * 100}%`;

        const x = (puzzleSize === 1) ? 0 : (correctCol / (puzzleSize - 1)) * 100;
        const y = (puzzleSize === 1) ? 0 : (correctRow / (puzzleSize - 1)) * 100;
        div.style.backgroundPosition = `${x}% ${y}%`;

        div.onclick = () => handlePieceClick(i);
        board.appendChild(div);
    }
}

function updatePuzzlePositions() {
    const tilePercent = 100 / puzzleSize;

    puzzleState.forEach((pieceNum, index) => {
        const div = document.getElementById(`piece-${pieceNum}`);
        if (!div) return;
        const row = Math.floor(index / puzzleSize);
        const col = index % puzzleSize;
        div.style.top = `${row * tilePercent}%`;
        div.style.left = `${col * tilePercent}%`;
        if (selectedPieceNum === pieceNum) div.classList.add('selected');
        else div.classList.remove('selected');
    });

    checkPuzzleWin();
}

function handlePieceClick(clickedNum) {
    if (puzzleSolved) return;
    playSfx('puzzle-click');
    if (selectedPieceNum === null) {
        selectedPieceNum = clickedNum;
        updatePuzzlePositions();
    } else {
        if (selectedPieceNum !== clickedNum) {
            const index1 = puzzleState.indexOf(selectedPieceNum);
            const index2 = puzzleState.indexOf(clickedNum);
            [puzzleState[index1], puzzleState[index2]] = [puzzleState[index2], puzzleState[index1]];
            selectedPieceNum = null;
            playSfx('puzzle-slide');
            updatePuzzlePositions();
        } else {
            selectedPieceNum = null;
            updatePuzzlePositions();
        }
    }
}

function checkPuzzleWin() {
    const isWin = puzzleState.every((val, index) => val === index + 1);
    if (!isWin) return;

    puzzleSolved = true;
    const status = document.getElementById('puzzle-status');
    if (status) {
        status.textContent = "✅ Логотип собран!";
        status.style.color = "#2ecc71";
    }

    const tilePercent = 100 / puzzleSize;
    document.querySelectorAll('.puzzle-piece').forEach(el => {
        el.style.border = "none";
        el.style.borderRadius = "0";
        el.style.width = `${tilePercent}%`;
        el.style.height = `${tilePercent}%`;
        el.style.cursor = "default";
        el.classList.remove('selected');
    });

    const timeMs = Date.now() - levelStartTime;

    const score = scorePuzzleByTime(puzzleSize, timeMs);

    // Сохраняем статистику именно этого варианта пазла
    finishLevel({ score, timeMs });

    // Дадим 1–2 секунды посмотреть на собранное изображение без рамок,
    // а уже потом переходим на следующий этап (экран после уровня).
    setTimeout(() => {
        // "Далее" убрано — пользователь сам выбирает следующий уровень в меню.
        showAfterLevel(currentLevelId);
    }, 2000);
}


// ==========================================
// УРОВЕНЬ 2: JUMP GAME
// ==========================================
let doodleGameLoop;
let ctx;
let canvasWidth = 320;
let canvasHeight = 480;

// ============================
// PERF: общие оптимизации
// ============================
// На телефонах с devicePixelRatio=3 канвас становится слишком тяжёлым (слишком много пикселей),
// что приводит к просадкам FPS. Ограничиваем DPR до 2 — визуально почти не заметно,
// но значительно разгружает GPU/CPU. Логику и картинки не меняем.
const MAX_DPR = 2;

const imgHero = new Image(); imgHero.src = assetPath('hero', 'png');
const imgPlatform = new Image(); imgPlatform.src = assetPath('platform', 'png');
const imgSpring = new Image(); imgSpring.src = assetPath('spring', 'png');
const imgPropeller = new Image(); imgPropeller.src = assetPath('propeller', 'png');
const imgJetpack = new Image(); imgJetpack.src = assetPath('jetpack', 'png');
const imgPart = new Image(); imgPart.src = assetPath('part', 'png');

// ===== PERF: предзагрузка/декодирование изображений (убирает фризы на первом рендере) =====
function decodeImage(img) {
    // decode() доступен в большинстве современных браузеров; если нет — ждём onload
    if (img.decode) return img.decode().catch(() => {});
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
    });
}

let level2AssetsLoaded = false;
let level2AssetsPromise = null;
function preloadLevel2Assets() {
    if (level2AssetsLoaded) return Promise.resolve();
    if (level2AssetsPromise) return level2AssetsPromise;
    level2AssetsPromise = Promise.all([
        decodeImage(imgHero),
        decodeImage(imgPlatform),
        decodeImage(imgSpring),
        decodeImage(imgPropeller),
        decodeImage(imgJetpack),
        decodeImage(imgPart),
    ]).then(() => { level2AssetsLoaded = true; });
    return level2AssetsPromise;
}

let afterJumperPreloaded = false;
function preloadAfterJumperInBackground() {
    if (afterJumperPreloaded) return;
    afterJumperPreloaded = true;
    preloadOneImage(assetPath('after_jumper', 'png')).catch(() => {});
}


const TOTAL_ITEMS = 10;
const GRAVITY = 0.25;
const JUMP_FORCE = -9;
const MOVE_SPEED = 5;

// РАЗМЕРЫ
const HERO_SIZE = 80;
const PLATFORM_WIDTH = 100;
const PLATFORM_HEIGHT = 50;

// --- Sprite cropping ---
// Исходные webp-спрайты «hero/platform» содержат большой прозрачный padding.
// Если рисовать весь исходник в (width,height), видимая картинка смещается
// относительно хитбокса (player/platform), и создаётся эффект «прыжка по воздуху».
// Поэтому рисуем только внутреннюю область с объектом.
// (координаты подобраны под текущие assets/*.webp)
const HERO_SPRITE_CROP = { sx: 31, sy: 39, sw: 969, sh: 892 };
const PLATFORM_SPRITE_CROP = { sx: 63, sy: 366, sw: 896, sh: 259 };

const SPRING_WIDTH = 60; const SPRING_HEIGHT = 50;
const PROPELLER_WIDTH = 60; const PROPELLER_HEIGHT = 50;
const JETPACK_WIDTH = 60; const JETPACK_HEIGHT = 60;

const SPRING_FORCE = -16;
const PROPELLER_FORCE = -25;
const JETPACK_FORCE = -45;

let platforms = [];
let items = [];
let player = { x: 0, y: 0, width: HERO_SIZE, height: HERO_SIZE, vx: 0, vy: 0, isDead: false, equipment: null };

let itemsCollected = 0;
let keys = { left: false, right: false };
let scoreEl;
let timerEl;
let gameActive = false;
let gameStartTime = 0;
// PERF: не обновляем текст таймера каждый кадр (лишние reflow/paint на мобилках)
let lastTimerSecond = -1;

// Чтобы не навешивать обработчики по 5 раз при повторном заходе на уровень
let doodleControlsBound = false;
let doodleCanvasRef = null;

// Throttle для touchmove через requestAnimationFrame (уменьшаем нагрузку)
let touchRAF = 0;
let pendingTouchSide = 0; // -1 = left, +1 = right

// Кнопки управления (кружочки снизу)
let doodleBtnsBound = false;
let doodleControlsEl = null;

function setDoodleControlsState(state) {
    if (!doodleControlsEl) doodleControlsEl = document.getElementById('doodle-controls');
    if (!doodleControlsEl) return;
    doodleControlsEl.classList.remove('controls-hidden', 'controls-hint');
    if (state === 'hidden') {
        doodleControlsEl.classList.add('controls-hidden');
    } else if (state === 'hint') {
        doodleControlsEl.classList.add('controls-hint');
    }
}


function initJumper() {
    // На случай повторного входа на уровень — останавливаем прошлый цикл
    gameActive = false;
    if (doodleGameLoop) cancelAnimationFrame(doodleGameLoop);

    doodleControlsEl = document.getElementById('doodle-controls');

    document.getElementById('doodle-container').style.display = 'block';
    const ui = document.getElementById('doodle-ui');
    ui.style.display = 'flex';
    document.getElementById('after-level-container').style.display = 'none';
    ui.querySelector('h2').textContent = `Собери детали`;
    document.getElementById('doodle-score').textContent = "0";
    document.getElementById('doodle-timer').textContent = "⏱ 00:00";

    const container = document.getElementById('doodle-container');
    container.classList.remove('game-running');
    document.getElementById('game-over-overlay').classList.remove('visible');
    document.getElementById('victory-overlay').classList.remove('visible');
    document.getElementById('doodle-start-msg').style.display = 'flex';

    const startMsg = document.getElementById('doodle-start-msg');
    const pTag = startMsg ? startMsg.querySelector('p') : null;
    if (startMsg) {
        startMsg.style.pointerEvents = 'auto';
        startMsg.dataset.ready = '1';
    }
    if (pTag) pTag.textContent = 'Нажми, чтобы начать!';

    // Подсказка управления: стрелки пульсируют на стартовом экране
    setDoodleControlsState('hint');

    // Сбрасываем управление, чтобы не было "залипания" после прошлой сессии
    keys.left = false;
    keys.right = false;
    pendingTouchSide = 0;
    if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }

    // === ИСПРАВЛЕНИЕ КАЧЕСТВА (HiDPI) ===

    // 1. Берем логические размеры контейнера (CSS-пиксели)
    canvasWidth = container.offsetWidth;
    canvasHeight = container.offsetHeight;

    const canvas = document.getElementById('doodle-canvas');
    doodleCanvasRef = canvas;
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

    // 2. Узнаем плотность пикселей устройства (на ПК = 1, на iPhone = 2 или 3)
    const dpr = Math.min((window.devicePixelRatio || 1), MAX_DPR);

    // 3. Устанавливаем РЕАЛЬНОЕ разрешение холста (умножаем на плотность)
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;

    // 4. Фиксируем ВИЗУАЛЬНЫЙ размер через CSS (чтобы холст не стал огромным на экране)
    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";

    // 5. ВАЖНО: сбрасываем transform, иначе при повторной инициализации масштаб накапливается
    // (что даёт мыло и лишнюю нагрузку).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Включаем сглаживание (или выключаем, если хочешь пиксель-арт)
    ctx.imageSmoothingEnabled = true;
    // На мобилках 'high' иногда заметно режет FPS.
    ctx.imageSmoothingQuality = (dpr > 1.5) ? 'low' : 'medium';

    scoreEl = document.getElementById('doodle-score');
    timerEl = document.getElementById('doodle-timer');
    setupControls(canvas);
}

function setupControls(canvas) {
    // Клавиатура: лёгкий контроль для ПК
    window.onkeydown = (e) => {
        if (e.code === 'ArrowLeft') keys.left = true;
        if (e.code === 'ArrowRight') keys.right = true;
    };
    window.onkeyup = (e) => {
        if (e.code === 'ArrowLeft') keys.left = false;
        if (e.code === 'ArrowRight') keys.right = false;
    };

    // Touch: навешиваем обработчики один раз, чтобы не плодить слушатели при повторном запуске
    if (doodleControlsBound) return;
    doodleControlsBound = true;
    // PERF: если вкладка скрыта — стопаем цикл (экономит батарею и CPU)
    if (!setupControls._visBound) {
        setupControls._visBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                gameActive = false;
                if (doodleGameLoop) cancelAnimationFrame(doodleGameLoop);
            }
        }, { passive: true });
    }


    const onTouchStartMove = (e) => {
        e.preventDefault();
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        const rect = canvas.getBoundingClientRect();
        pendingTouchSide = (touch.clientX - rect.left < rect.width / 2) ? -1 : 1;
        if (!touchRAF) {
            touchRAF = requestAnimationFrame(() => {
                touchRAF = 0;
                if (pendingTouchSide < 0) {
                    keys.left = true; keys.right = false;
                } else {
                    keys.left = false; keys.right = true;
                }
            });
        }
    };

    const onTouchEnd = (e) => {
        e.preventDefault();
        keys.left = false;
        keys.right = false;
        pendingTouchSide = 0;
        // ВАЖНО: если rAF уже запланирован, отменяем, иначе он может снова включить направление
        if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }
    };

    canvas.addEventListener('touchstart', onTouchStartMove, { passive: false });
    canvas.addEventListener('touchmove', onTouchStartMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    // --- Кнопки-стрелки снизу (для детей интуитивнее) ---
    if (!doodleBtnsBound) {
        doodleBtnsBound = true;
        const btnL = document.getElementById('doodle-btn-left');
        const btnR = document.getElementById('doodle-btn-right');

        const pressLeft = (e) => {
            e.preventDefault();
            keys.left = true;
            keys.right = false;
            pendingTouchSide = -1;
            if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }
        };
        const pressRight = (e) => {
            e.preventDefault();
            keys.left = false;
            keys.right = true;
            pendingTouchSide = 1;
            if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }
        };
        const releaseBoth = (e) => {
            if (e) e.preventDefault();
            keys.left = false;
            keys.right = false;
            pendingTouchSide = 0;
            if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }
        };

        // Touch
        btnL.addEventListener('touchstart', pressLeft, { passive: false });
        btnL.addEventListener('touchend', releaseBoth, { passive: false });
        btnL.addEventListener('touchcancel', releaseBoth, { passive: false });
        btnR.addEventListener('touchstart', pressRight, { passive: false });
        btnR.addEventListener('touchend', releaseBoth, { passive: false });
        btnR.addEventListener('touchcancel', releaseBoth, { passive: false });

        // Mouse (на ПК тоже удобно)
        btnL.addEventListener('mousedown', pressLeft);
        btnL.addEventListener('mouseup', releaseBoth);
        btnL.addEventListener('mouseleave', releaseBoth);
        btnR.addEventListener('mousedown', pressRight);
        btnR.addEventListener('mouseup', releaseBoth);
        btnR.addEventListener('mouseleave', releaseBoth);
    }
}

function startDoodleLoop() {
    if (!level2AssetsLoaded) return; // ждём декодирования ассетов

    // Если ассеты ещё декодируются — не стартуем (иначе будет фриз)
    const startMsg = document.getElementById('doodle-start-msg');
    if (startMsg && startMsg.dataset && startMsg.dataset.ready === '0') return;

    document.getElementById('doodle-container').classList.add('game-running');
    document.getElementById('doodle-start-msg').style.display = 'none';
    // Во время игры стрелки видны без подсказки
    setDoodleControlsState('play');
    document.getElementById('game-over-overlay').classList.remove('visible');
    resetGame();
    gameActive = true;

    // Сбрасываем управление при старте, чтобы не было "залипания"
    keys.left = false;
    keys.right = false;
    pendingTouchSide = 0;
    if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }

    gameStartTime = Date.now();
    lastTimerSecond = -1;
    levelStartTime = Date.now();
    update();
}

function resetGame() {
    itemsCollected = 0;
    scoreEl.textContent = "0";

    // Ставим игрока ровно на стартовую платформу
    // Y платформы = canvasHeight - 60
    // Y игрока = Y платформы - HERO_SIZE
    player.x = canvasWidth / 2 - player.width / 2;
    player.y = (canvasHeight - 60) - HERO_SIZE - 15;

    player.vx = 0;
    player.vy = JUMP_FORCE;
    player.isDead = false;
    player.equipment = null;
    platforms = [];
    items = [];

    let currentY = canvasHeight - 60;
    platforms.push({ x: canvasWidth / 2 - PLATFORM_WIDTH / 2, y: currentY, width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT, type: 'normal', bonus: null });
    for (let i = 0; i < 7; i++) {
        let gap = 110 + Math.random() * 40;
        currentY -= gap;
        generatePlatformAt(currentY);
    }
}

function generatePlatformAt(yPos) {
    const width = PLATFORM_WIDTH;
    const x = Math.random() * (canvasWidth - width);
    let bonusType = null;
    let spawnItem = false;
    const rand = Math.random();
    if (rand < 0.02) bonusType = 'jetpack';
    else if (rand < 0.06) bonusType = 'propeller';
    else if (rand < 0.14) bonusType = 'spring';
    else { if (Math.random() < 0.15) spawnItem = true; }

    platforms.push({ x, y: yPos, width, height: PLATFORM_HEIGHT, bonus: bonusType });

    // Спавним деталь ниже (ближе к платформе)
    if (spawnItem) items.push({ x: x + width / 2, y: yPos - 10, collected: false });
}

function update() {
    if (!gameActive) return;
    const now = Date.now();
    const elapsed = Math.floor((now - gameStartTime) / 1000);
    // Обновляем DOM только при смене секунды
    if (elapsed !== lastTimerSecond) {
        lastTimerSecond = elapsed;
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        timerEl.textContent = `⏱ ${minutes}:${seconds}`;
    }

    if (keys.left) player.vx = -MOVE_SPEED; else if (keys.right) player.vx = MOVE_SPEED; else player.vx = 0;
    player.x += player.vx; player.vy += GRAVITY; player.y += player.vy;
    if (player.x + player.width < 0) player.x = canvasWidth;
    if (player.x > canvasWidth) player.x = -player.width;
    if (player.y < canvasHeight * 0.45 && player.vy < 0) {
        player.y = canvasHeight * 0.45;
        let shift = -player.vy;
        for (let i = 0; i < platforms.length; i++) platforms[i].y += shift;
        for (let i = 0; i < items.length; i++) items[i].y += shift;
    }
    for (let pi = 0; pi < platforms.length; pi++) {
        const p = platforms[pi];
        if (p.y > canvasHeight) {
            let highestY = canvasHeight;
            for (let j = 0; j < platforms.length; j++) {
                const py = platforms[j].y;
                if (py < highestY) highestY = py;
            }
            const gap = 110 + Math.random() * 40;
            p.y = highestY - gap;
            p.x = Math.random() * (canvasWidth - p.width);
            p.bonus = null;
            const r = Math.random();
            if (r < 0.02) p.bonus = 'jetpack';
            else if (r < 0.06) p.bonus = 'propeller';
            else if (r < 0.14) p.bonus = 'spring';

            // Спавним деталь ниже при респавне
            if (p.bonus === null && Math.random() < 0.18) {
                items.push({ x: p.x + p.width / 2, y: p.y - 10, collected: false });
            }
        }
    }
    // PERF: фильтрация без создания нового массива (меньше нагрузка на GC)
    const cutoff = canvasHeight + 100;
    let write = 0;
    for (let read = 0; read < items.length; read++) {
        const it = items[read];
        if (it.y < cutoff) items[write++] = it;
    }
    items.length = write;
    if (player.vy > 0) {
        const px1 = player.x + player.width * 0.3;
        const px2 = player.x + player.width * 0.7;
        const pyBottom = player.y + player.height;
        const vy = player.vy;
        for (let i = 0; i < platforms.length; i++) {
            const p = platforms[i];
            if (px2 > p.x && px1 < p.x + p.width && pyBottom > p.y && pyBottom < p.y + p.height + vy + 2) {
                if (p.bonus === 'spring') {
                    playSfx('jumper-bounce');
                    player.vy = SPRING_FORCE;
                }
                else if (p.bonus === 'propeller') {
                    playSfx('jumper-propeller');
                    player.vy = PROPELLER_FORCE; player.equipment = 'propeller';
                }
                else if (p.bonus === 'jetpack') {
                    playSfx('jumper-jetpack');
                    player.vy = JETPACK_FORCE; player.equipment = 'jetpack';
                }
                else {
                    playSfx('jumper-jump');
                    player.vy = JUMP_FORCE;
                    if (player.equipment && player.vy > -10) player.equipment = null;
                }
                break;
            }
        }
    }
    if (player.vy > 0) player.equipment = null;
    // Коллизии: без sqrt (быстрее)
    const cx = player.x + player.width / 2;
    const cy = player.y + player.height / 2;
    const R2 = 60 * 60;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.collected) continue;
        const dx = cx - item.x;
        const dy = cy - item.y;
        if ((dx * dx + dy * dy) < R2) {
            item.collected = true;
            itemsCollected++;
            scoreEl.textContent = itemsCollected;
            // Микро-анимацию оставляем, но без лишних reflow: через rAF
            scoreEl.style.transform = "scale(1.5)";
            requestAnimationFrame(() => {
                setTimeout(() => { scoreEl.style.transform = "scale(1)"; }, 200);
            });
            if (itemsCollected >= TOTAL_ITEMS) {
                showVictoryLevel2();
                break;
            }
        }
    }
    if (player.y > canvasHeight) { showGameOver(); return; }
    draw();
    if (gameActive) doodleGameLoop = requestAnimationFrame(update);
}

function draw() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Платформы (рисуем обрезанный спрайт, чтобы картинка совпадала с хитбоксом)
    for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        if (imgPlatform.complete && imgPlatform.naturalWidth !== 0) {
            const c = PLATFORM_SPRITE_CROP;
            ctx.drawImage(imgPlatform, c.sx, c.sy, c.sw, c.sh, p.x, p.y, p.width, p.height);
        } else {
            ctx.fillStyle = '#27ae60';
            ctx.fillRect(p.x, p.y, p.width, p.height);
        }

        if (p.bonus === 'spring') { const bx = p.x + (PLATFORM_WIDTH - SPRING_WIDTH) / 2; const by = p.y - SPRING_HEIGHT + 40; drawBonus(imgSpring, bx, by, SPRING_WIDTH, SPRING_HEIGHT); }
        else if (p.bonus === 'propeller') { const bx = p.x + (PLATFORM_WIDTH - PROPELLER_WIDTH) / 2; const by = p.y - PROPELLER_HEIGHT + 15; drawBonus(imgPropeller, bx, by, PROPELLER_WIDTH, PROPELLER_HEIGHT); }
        else if (p.bonus === 'jetpack') { const bx = p.x + (PLATFORM_WIDTH - JETPACK_WIDTH) / 2; const by = p.y - JETPACK_HEIGHT + 20; drawBonus(imgJetpack, bx, by, JETPACK_WIDTH, JETPACK_HEIGHT); }
    }

    // Детали
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.collected) continue;
        if (imgPart.complete && imgPart.naturalWidth !== 0) ctx.drawImage(imgPart, item.x - 30, item.y - 30, 60, 60);
        else { ctx.beginPath(); ctx.arc(item.x, item.y, 20, 0, Math.PI * 2); ctx.fillStyle = '#3498db'; ctx.fill(); }
    }

    // Игрок (рисуем обрезанный спрайт, без визуальных смещений)
    if (imgHero.complete && imgHero.naturalWidth !== 0) {
         if (player.equipment === 'jetpack') {
            // Рисуем ОДИН большой джетпак по центру
            const jpWidth = 90;  // Ширина джетпака
            const jpHeight = 100; // Высота джетпака

            // Центрируем относительно героя
            const jpX = player.x + (player.width - jpWidth) / 2;
            const jpY = player.y + 10; // Чуть ниже плеч

            ctx.drawImage(imgJetpack, jpX, jpY, jpWidth, jpHeight);

            // Огонь (по центру джетпака)
            ctx.fillStyle = 'orange';
            ctx.beginPath();
            ctx.moveTo(player.x + player.width / 2 - 10, player.y + 70);
            ctx.lineTo(player.x + player.width / 2 + 10, player.y + 70);
            ctx.fill();
        }

        // ГЕРОЙ (Рисуется ПОВЕРХ джетпака)
        const hc = HERO_SPRITE_CROP;
        ctx.drawImage(imgHero, hc.sx, hc.sy, hc.sw, hc.sh, player.x, player.y, player.width, player.height);

        if (player.equipment === 'propeller') {
            // Пропеллер тоже опускаем
            ctx.drawImage(imgPropeller, player.x + 11, player.y - 25, 60, 50);
        }
    } else {
        ctx.fillStyle = '#e67e22';
        // Если картинки нет, рисуем ровно по хитбоксу
        ctx.fillRect(player.x, player.y, player.width, player.height);
    }
}
function drawBonus(img, x, y, w, h) { if (img.complete && img.naturalWidth !== 0) ctx.drawImage(img, x, y, w, h); else { ctx.fillStyle = 'red'; ctx.fillRect(x, y, w, h); } }
function showGameOver() {
    playSfx('jumper-loss');
    gameActive = false;
    cancelAnimationFrame(doodleGameLoop);
    setDoodleControlsState('hidden');
    document.getElementById('game-over-overlay').classList.add('visible');
}

function showVictoryLevel2() {
    playSfx('jumper-win');
    gameActive = false;
    cancelAnimationFrame(doodleGameLoop);
    setDoodleControlsState(false);

    // Сбрасываем управление
    keys.left = false; keys.right = false;
    pendingTouchMove = 0; pendingTouchSide = 0;
    if (touchRAF) { cancelAnimationFrame(touchRAF); touchRAF = 0; }

    const timeMs = Date.now() - levelStartTime;

    const score = scoreJumperByTime(timeMs);
    levelScores[2] = score;
    finishLevel({ score, timeMs });

    document.getElementById('victory-overlay').classList.add('visible');
    setTimeout(() => {
        document.getElementById('victory-overlay').classList.remove('visible');
        finishLevel2();
    }, 2000);
}

function finishLevel2() {
    // Экран после Jumper
    showAfterLevel('jumper');
}

// ==========================================
// УРОВЕНЬ 3: 2048 (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ)
// ==========================================

// PERF: предзагрузка и декодирование картинок плиток.
// Основная причина "долго грузит картинки" на телефоне — декодирование изображений
// в момент первого появления каждой плитки. Предзагружаем один раз заранее.
let tileAssets2048Ready = false;
const tileAssets2048 = {
    2: assetPath('bolt', 'png'),
    4: assetPath('nut', 'png'),
    8: assetPath('gear', 'png'),
    16: assetPath('chip', 'png'),
    32: assetPath('board', 'png'),
    64: assetPath('case', 'png'),
    128: assetPath('sensor', 'png'),
    256: assetPath('device', 'png')
};

function preload2048Assets() {
    if (tileAssets2048Ready) return;
    tileAssets2048Ready = true;

    // Загружаем/декодируем в фоне, без блокировки игры
    Object.values(tileAssets2048).forEach((src) => {
        const img = new Image();
        img.src = src;
        // decode() ускоряет момент первого рендера (где поддерживается)
        if (img.decode) img.decode().catch(() => {});
    });
}

const SIZE = 4;
// Предвычисляем позиции для ускорения (чтобы не считать в цикле)
const TILE_OFFSET = 10;
const TILE_STEP = 72.5;
const TILE_POS = Array.from({ length: SIZE }, (_, i) => (TILE_OFFSET + i * TILE_STEP) + 'px');

// Кэшируем DOM элементы, чтобы не искать их каждый раз
const gridContainer = document.getElementById('grid-container');
const scoreEl2048 = document.getElementById('score-2048');
const overlay2048GameOver = document.getElementById('overlay-2048-gameover');
const overlay2048Victory = document.getElementById('overlay-2048-victory');

// Чтобы не добавлять swipe-слушатели на каждую перезапуск-инициализацию 2048
let swipe2048Bound = false;
let touchStartX2048 = 0;
let touchStartY2048 = 0;

let board2048 = [];
let score2048 = 0;
let game2048Active = false;

// Переиспользуемый массив для пустых клеток (снижает нагрузку на GC)
const emptyCells = [];

function init2048() {
    preload2048Assets();
    score2048 = 0;
    game2048Active = true;
    scoreEl2048.textContent = '0';

    // Сброс UI
    overlay2048GameOver.classList.remove('visible');
    overlay2048Victory.classList.remove('visible');

    gridContainer.innerHTML = '';

    // Создаем фоновые клетки один раз
    const fragment = document.createDocumentFragment();
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.style.top = TILE_POS[r];
            cell.style.left = TILE_POS[c];
            fragment.appendChild(cell);
        }
    }
    gridContainer.appendChild(fragment);

    // Инициализация игрового поля
    board2048 = Array(SIZE);
    for(let r=0; r<SIZE; r++) board2048[r] = Array(SIZE).fill(null);

    addRandomTile();
    addRandomTile();

    setupSwipeListeners();
    document.onkeydown = handle2048Input;

    levelStartTime = Date.now();
}

function addRandomTile() {
    // Очищаем массив без создания нового
    emptyCells.length = 0;

    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            if(board2048[r][c] === null) emptyCells.push({r, c});
        }
    }

    if(emptyCells.length > 0) {
        const rand = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        const val = Math.random() < 0.9 ? 2 : 4;
        createTile(rand.r, rand.c, val);
        playSfx('2048-plastic');
    }
}

function createTile(r, c, val) {
    const tileDom = document.createElement('div');
    tileDom.className = `tile tile-${val} tile-new`;
    // Используем предвычисленные позиции
    tileDom.style.top = TILE_POS[r];
    tileDom.style.left = TILE_POS[c];

    gridContainer.appendChild(tileDom);
    board2048[r][c] = { val: val, dom: tileDom, merged: false };
}

function handle2048Input(e) {
    if(!game2048Active) return;
    if(e.code === 'ArrowUp') moveTiles(-1, 0);
    else if(e.code === 'ArrowDown') moveTiles(1, 0);
    else if(e.code === 'ArrowLeft') moveTiles(0, -1);
    else if(e.code === 'ArrowRight') moveTiles(0, 1);
}

function moveTiles(dr, dc) {
    let moved = false;
    let mergedThisMove = false;

    // Сброс флагов слияния
    for(let r=0; r<SIZE; r++)
        for(let c=0; c<SIZE; c++)
            if(board2048[r][c]) board2048[r][c].merged = false;

    const rStart = dr === 1 ? SIZE - 1 : 0;
    const rEnd = dr === 1 ? -1 : SIZE;
    const rStep = dr === 1 ? -1 : 1;
    const cStart = dc === 1 ? SIZE - 1 : 0;
    const cEnd = dc === 1 ? -1 : SIZE;
    const cStep = dc === 1 ? -1 : 1;

    for (let r = rStart; r !== rEnd; r += rStep) {
        for (let c = cStart; c !== cEnd; c += cStep) {
            const tile = board2048[r][c];
            if (!tile) continue;

            let nextR = r + dr;
            let nextC = c + dc;
            let targetR = r;
            let targetC = c;

            while(nextR >= 0 && nextR < SIZE && nextC >= 0 && nextC < SIZE) {
                const nextTile = board2048[nextR][nextC];
                if (!nextTile) {
                    targetR = nextR; targetC = nextC;
                } else if (nextTile.val === tile.val && !nextTile.merged) {
                    targetR = nextR; targetC = nextC;
                    break;
                } else { break; }
                nextR += dr; nextC += dc;
            }

            if (targetR !== r || targetC !== c) {
                const targetTile = board2048[targetR][targetC];

                if (!targetTile) {
                    board2048[r][c] = null;
                    board2048[targetR][targetC] = tile;
                    updateTilePosition(tile, targetR, targetC);
                    moved = true;
                } else if (targetTile.val === tile.val) {
                    board2048[r][c] = null;
                    updateTilePosition(tile, targetR, targetC);

                    targetTile.val *= 2;
                    targetTile.merged = true;
                    mergedThisMove = true;
                    score2048 += targetTile.val;
                    scoreEl2048.textContent = score2048;
                    mergedThisMove = true;

                    // Удаляем старую плитку после анимации
                    setTimeout(() => {
                        if(tile.dom.parentNode) tile.dom.remove();
                        // Обновляем вид целевой плитки
                        targetTile.dom.className = `tile tile-${targetTile.val} tile-merged`;
                    }, 150);
                    moved = true;
                }
            }
        }
    }

    if (moved) {
        // Звук хода (сначала скольжение, затем при наличии — pop за объединение)
        playSfx('2048-slide');
        if (mergedThisMove) playSfx('2048-pop');
        setTimeout(() => {
            addRandomTile();
            check2048Status();
        }, 150);
    } else {
        check2048Status();
    }
}

function updateTilePosition(tile, r, c) {
    // Используем кэшированные значения координат
    tile.dom.style.top = TILE_POS[r];
    tile.dom.style.left = TILE_POS[c];
}

function check2048Status() {
    // 1. Проверка победы
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            const tile = board2048[r][c];
            if(tile && tile.val >= 256 && game2048Active) {
                showVictory2048();
                return;
            }
        }
    }

    // 2. Проверка поражения
    // Сначала ищем пустые (быстрая проверка)
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            if(board2048[r][c] === null) return; // Есть ход
        }
    }

    // Если пустых нет, ищем слияния
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            const val = board2048[r][c].val;
            if(c < SIZE-1 && board2048[r][c+1].val === val) return;
            if(r < SIZE-1 && board2048[r+1][c].val === val) return;
        }
    }

    // Ходов нет
    showGameOver2048();
}

function showVictory2048() {
    game2048Active = false;

    const timeMs = Date.now() - levelStartTime;

    const score = 5;
    levelScores[3] = score;
    finishLevel({ score, timeMs });

    overlay2048Victory.classList.add('visible');
    setTimeout(() => {
        overlay2048Victory.classList.remove('visible');
        // Показать экран после уровня
        showAfterLevel('factory-2048');
        // Кнопка "Далее" убрана — после победы игрок может вернуться в меню уровней.
    }, 2000);
}

function showGameOver2048() {
    game2048Active = false;
    overlay2048GameOver.classList.add('visible');
}

function setupSwipeListeners() {
    if (swipe2048Bound) return;
    swipe2048Bound = true;

    // Используем уже найденный элемент
    const grid = gridContainer;

    grid.addEventListener('touchstart', function(e) {
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        touchStartX2048 = t.clientX;
        touchStartY2048 = t.clientY;
        e.preventDefault();
    }, {passive: false});

    grid.addEventListener('touchmove', function(e) {
        if (!game2048Active) return;
        // В MAX WebView вертикальный свайп вниз может восприниматься как системный жест
        // закрытия mini app. Жёстко забираем его в пределах игрового поля.
        e.preventDefault();
    }, {passive: false});

    grid.addEventListener('touchend', function(e) {
        e.preventDefault();
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        let dx = t.clientX - touchStartX2048;
        let dy = t.clientY - touchStartY2048;

        if(Math.abs(dx) > Math.abs(dy)) {
            if(Math.abs(dx) > 30) dx > 0 ? moveTiles(0, 1) : moveTiles(0, -1);
        } else {
            if(Math.abs(dy) > 30) dy > 0 ? moveTiles(1, 0) : moveTiles(-1, 0);
        }
    }, {passive: false});
}


// ==========================================
// УРОВЕНЬ 4: КВИЗ
// ==========================================
const questions = [
    { q: "Какой день считается днём рождения АПЗ?", answers: ["22 мая 1957 года", "11 мая 2011 года", "1 сентября 1960 года"], correct: 0 },
    { q: "В каком году была создана многотиражная заводская газета «Новатор»?", answers: ["1960 г.", "1973 г.", "1992 г."], correct: 0 },
    { q: "В каком году на АПЗ была введена в эксплуатацию первая ЭВМ?", answers: ["1973 г.", "1965 г.", "1980 г."], correct: 0 },
    { q: "В каком году началось массовое производство магнитофона «Легенда-404»?", answers: ["1977 г.", "1984 г.", "1991 г."], correct: 0 },
    { q: "В каком году АПЗ начало осваивать выпуск приборов ресурсосбережения?", answers: ["1992 г.", "1988 г.", "2000 г."], correct: 0 },
    { q: "Какой награды был удостоен Павел Иванович Пландин в 1984 году?", answers: ["Стал лауреатом Ленинской премии", "Получил Государственную премию СССР", "Был награждён орденом Трудовой Славы"], correct: 0 },
    { q: "Как называется семейство систем изделий учёта спиртосодержащих жидкостей, выпускаемых на АПЗ?", answers: ["«АЛКО»", "«Ультрафлоу»", "«Барьер»"], correct: 0 },
    { q: "Как называется трёхкомпонентный расходомер для нефтяных скважин, выпускаемый АПЗ?", answers: ["«Ультрафлоу»", "«АЛКО»", "«Легенда-404»"], correct: 0 },
    { q: "Как расшифровывается аббревиатура РВР «Барьер»?", answers: ["Ранцевый водораспылитель «Барьер»", "Ручной водяной распределитель «Барьер»", "Регулятор водного режима «Барьер»"], correct: 0 },
    { q: "Во что в 1991 году было преобразовано Арзамасское приборостроительное производственное объединение им. 50-летия СССР?", answers: ["В Арзамасский приборостроительный завод", "В Арзамасское приборостроительное конструкторское бюро", "В Акционерное приборостроительное производственное товарищество"], correct: 0 },
    { q: "Что находится на рабочем месте инженера-электроника?", answers: ["Мультиметр", "Паяльник", "Микроскоп"], correct: 0 },
    { q: "Какой документ использует в работе инженер-конструктор?", answers: ["Чертёж", "Маршрутная карта", "Годовой отчёт"], correct: 0 },
    { q: "Что должен знать оператор станков с ПУ?", answers: ["Основы теории резания металлов", "Правила разбавления кислот", "Языки программирования"], correct: 0 },
    { q: "С каким материалом работает монтажник РЭАиП?", answers: ["Припой", "Смазка", "Реактив"], correct: 0 },
    { q: "Что означает аббревиатура КИМ?", answers: ["Контрольно-измерительная машина", "Коэффициент измерения металла", "Комплекс инженерной механики"], correct: 0 }
];

// --- Randomization helpers for Quiz (order of questions and answers) ---
let quizQuestions = [];

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function prepareQuizQuestions(sourceQuestions) {
    // Deep-ish copy and shuffle questions + answers.
    // Source format: { q: string, answers: string[], correct: number }
    const qCopy = sourceQuestions.map(q => ({
        q: q.q,
        answers: Array.isArray(q.answers) ? q.answers.slice() : [],
        correct: q.correct
    }));

    shuffleArray(qCopy);

    // Shuffle answers per question and re-map correct index
    qCopy.forEach(q => {
        const order = q.answers.map((_, idx) => idx);
        shuffleArray(order);
        q.answers = order.map(i => q.answers[i]);
        q.correct = order.indexOf(q.correct);
    });

    return qCopy;
}


let currentQuestionIndex = 0;
let questionStartTime = 0;

// Флаг блокировки повторных нажатий во время анимации ответа.
// Должен быть объявлен ДО initQuiz(), т.к. при перепрохождении квиза
// мы сбрасываем его в initQuiz().
let isAnswering = false;

function initQuiz() {
    // Важно: при повторном прохождении квиза без перезагрузки приложения
    // контейнер мог остаться в состоянии .quiz-hidden (pointer-events: none)
    // после анимации последнего ответа. Это делает кнопки ответов «не нажимаемыми».
    // Сбрасываем это состояние перед запуском.
    try {
        const qc = document.getElementById('quiz-container');
        if (qc) qc.classList.remove('quiz-hidden');
    } catch (e) {}

    isAnswering = false;

    // Each run: randomize question order + answer order
    quizQuestions = prepareQuizQuestions(questions);
    currentQuestionIndex = 0;
    levelScores[4] = 0;
    renderQuestion();
}

function renderQuestion() {
    const qData = quizQuestions[currentQuestionIndex];
    document.getElementById('question-text').textContent = qData.q;
    document.getElementById('quiz-progress').textContent = `Вопрос ${currentQuestionIndex + 1} из ${quizQuestions.length}`;
    const container = document.getElementById('answers-block');
    container.innerHTML = '';

    questionStartTime = Date.now(); // Засекаем время на вопрос

    qData.answers.forEach((answerText, index) => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.textContent = answerText;
        btn.onclick = () => handleAnswerClick(btn, index, qData.correct);
        container.appendChild(btn);
    });
}

function handleAnswerClick(btn, index, correctIndex) {
    if (isAnswering) return;
    isAnswering = true;

    if (index === correctIndex) {
        playSfx('answer-correct');
        btn.classList.add('correct');
        btn.innerHTML += ' ✅';
        // Новый подсчёт для уровня "Цех умных решений":
        // 1 правильный ответ = 1 балл, неправильный = 0.
        levelScores[4] += 1;
    } else {
        playSfx('answer-uncorrect');
        btn.classList.add('wrong');
        btn.innerHTML += ' ❌';
        const buttons = document.querySelectorAll('.answer-btn');
        buttons[correctIndex].classList.add('correct');
    }

    // 1. Даем игроку 1.5 секунды осознать результат
    setTimeout(() => {
        const container = document.getElementById('quiz-container');

        // 2. Плавно растворяем текущий вопрос
        container.classList.add('quiz-hidden');

        // 3. Ждем 500мс (время анимации в CSS), пока он полностью исчезнет
        setTimeout(() => {
            isAnswering = false;
            currentQuestionIndex++;

            if (currentQuestionIndex < quizQuestions.length) {
                // Подменяем текст, пока его НЕ ВИДНО
                renderQuestion();

                // 4. Плавно проявляем новый вопрос
                container.classList.remove('quiz-hidden');
            } else {
                finishQuizLevel();
            }
        }, 500); // Синхронизировано с CSS transition: 0.5s

    }, 1500);
}

function finishQuizLevel() {
    // По требованиям: после завершения квиза — такое же поведение, как у остальных уровней:
    // остаёмся на экране уровня и показываем нижнюю кнопку "К уровням".
    const timeMs = Date.now() - levelStartTime;
    const score = levelScores[4] || 0;
    finishLevel({ score, timeMs });

    // UI: показываем сообщение о завершении и убираем варианты ответов
    const qText = document.getElementById('question-text');
    const answers = document.getElementById('answers-block');
    const progress = document.getElementById('quiz-progress');
    if (progress) progress.textContent = '✅ Квиз завершён';
    if (qText) qText.textContent = 'Ты прошёл квиз! Теперь можно вернуться к уровням.';
    if (answers) answers.innerHTML = '';

    // Показать экран после уровня
    showAfterLevel('quiz');
}

// === ФИНАЛ: ОТПРАВКА ДАННЫХ ===
function closeApp() {
    // Отправляем общую сумму
    let totalScore = levelScores[1] + levelScores[2] + levelScores[3] + levelScores[4];
    if (tg?.sendData) tg.sendData(JSON.stringify({score: totalScore}));
    if (tg?.close) tg.close();
}

// Инициализация меню уровней
window.addEventListener('load', () => {
    renderLevelMenuStats();
});

// === Anti-ghost-tap защита для Android/WebView ===
// Частая проблема: первый тап, которым пользователь открывает WebApp в Telegram,
// "проваливается" внутрь WebView и нажимает кнопку (часто — запуск уровня).
// Мы глушим клики на короткое время после загрузки и после перехода на экран уровней.
let ignoreClickUntil = 0;
function lockClicks(ms = 600) {
    ignoreClickUntil = Date.now() + ms;
}

// Доп. защита от автозапуска уровней на Android/WebView.
// Запуск уровня из меню разрешаем только после явного действия пользователя
// (нажал "Выбрать уровень"). Это убирает случаи, когда Telegram "пробрасывает"
// стартовый тап внутрь WebView и он попадает по одной из кнопок уровня.
let levelLaunchArmed = false;

// В некоторых WebView (в т.ч. Telegram) inline onclick может быть отключён политиками безопасности.
// Поэтому для критичных кнопок дублируем обработчики через addEventListener.
window.addEventListener('DOMContentLoaded', () => {
    // Прелоадер изображений при входе в приложение (assets/*) с прогрессом.
    // Никакую игровую логику не меняем — просто прогреваем кэш браузера.
    startEssentialImagePreloader();

    // Синхронизируем профтест с сервером (на случай удаления/сброса пользователя в админке)
    // Важно: Telegram может не перезагружать страницу при повторном открытии мини‑веба,
    // поэтому синк должен выполняться не только один раз на загрузке.
    syncResetAndRefreshUIThrottled();

    // Повторный синх при возврате в WebView (после закрытия/сворачивания/повторного открытия)
    // — именно тут чаще всего «оживают» очки/рекомендации из localStorage.
    window.addEventListener('focus', syncResetAndRefreshUIThrottled);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncResetAndRefreshUIThrottled();
    });

    // Важно: некоторые версии Telegram/WebView НЕ триггерят focus/visibilitychange при повторном открытии
    // (страница как бы остаётся "активной"), из-за чего сброс из админки не подхватывается.
    // Поэтому делаем лёгкий периодический синх (троттлинг внутри syncResetAndRefreshUIThrottled).
    try {
        if (!window.__apzResetSyncTimer) {
            window.__apzResetSyncTimer = setInterval(() => {
                syncResetAndRefreshUIThrottled();
            }, 5000);
        }
    } catch (e) {}

    // Разблокируем звук на первом пользовательском жесте
    // (иначе в Telegram WebView/iOS Safari многие звуки не запускаются)
    document.addEventListener('pointerdown', unlockSfxOnce, { once: true, capture: true });
    document.addEventListener('touchstart', unlockSfxOnce, { once: true, capture: true });

    // Глобальный "menu-click" для кнопок интерфейса.
    // Исключаем кнопки-ответы квиза — у них отдельные звуки correct/uncorrect.
    document.addEventListener('click', (ev) => {
        const btn = ev.target?.closest?.('button');
        if (!btn) return;
        if (btn.classList?.contains('answer-btn')) return;
        // защита от призрачных кликов (Android/WebView)
        if (Date.now() < ignoreClickUntil) return;
        playSfx('menu-click');
    }, true);

    // Глушим клики сразу после загрузки WebView
    lockClicks(900);

    // Подтягиваем доступность уровней (админ мог отключить некоторые)
    // и применяем к меню.
    loadLevelAvailability().then(() => {
        applyLevelAvailabilityToMenu();
    });
    // На некоторых WebView (особенно Android) первый рендер может привести к тому,
    // что глобальные кнопки остаются видимыми. Принудительно синхронизируем UI:
    // на приветственном экране кнопка "К уровням" показываться не должна.
    try {
        levelCompleted = false;
        currentLevelId = null;
        showScreen('screen-welcome');
        updateSoundToggleUI();
        // При запуске восстанавливаем результаты профтеста (если они уже были сохранены)
        // и показываем ⭐ рекомендации в меню.
        try {
            const savedApt = loadSavedAptitudeResult();
            const statLine = document.getElementById('aptitude-stat-line');
            const statMain = document.getElementById('stat-aptitude-main');

            if (savedApt && savedApt.main) {
                const LABEL = {
                    PEOPLE: '🤝 Работа с людьми',
                    RESEARCH: '🔬 Исследовательская деятельность',
                    PRODUCTION: '🏭 Работа на производстве',
                    AESTHETIC: '🎨 Эстетические виды деятельности',
                    EXTREME: '🧗 Экстремальные виды деятельности',
                    PLAN_ECON: '📊 Планово‑экономические виды деятельности',
                };
                if (statMain) statMain.textContent = LABEL[savedApt.main] || savedApt.main;
                if (statLine) statLine.style.display = '';
                applyAptitudeRecommendationsToMenu(savedApt);
            } else {
                if (statMain) statMain.textContent = '—';
                if (statLine) statLine.style.display = 'none';
                clearAptitudeMenuRecommendations();
            }
        } catch (e) {}
    } catch (e) {}

    // Переключатель звука (в меню)
    const btnSound = document.getElementById('btn-sound-toggle');
    if (btnSound) {
        btnSound.addEventListener('click', (e) => {
            // Не даём глобальному обработчику кнопок проигрывать "menu-click" поверх переключения
            e.preventDefault();
            e.stopPropagation();
            // На всякий случай — разлочим звук в рамках жеста пользователя
            unlockSfxOnce();
            setSfxMuted(!sfxMuted);
        });
    }

    const btnChoose = document.getElementById('btn-choose-level');
    const btnApt = document.getElementById('btn-aptitude-test');
    if (btnApt) {
        btnApt.addEventListener('click', (e) => {
            if (Date.now() < ignoreClickUntil) {
                e?.preventDefault?.();
                e?.stopPropagation?.();
                return;
            }
            unlockSfxOnce();
            openAptitudeMode();
        });
    }


    if (btnChoose) {
        const go = (e) => {
            // защита от первого "призрачного" клика
            if (Date.now() < ignoreClickUntil) {
                e?.preventDefault?.();
                e?.stopPropagation?.();
                return;
            }
            levelLaunchArmed = true;
            showLevels();
        };
        // Важно: только click. pointerup/touchend иногда срабатывают призрачно при открытии WebApp.
        btnChoose.addEventListener('click', go);
    }

    // Универсальные обработчики вместо inline onclick (Telegram/WebView может их блокировать)
    const handleAction = (e) => {
        // Закрываем подсказку по клику в любом месте (кроме самой подсказки и подписи шкалы)
        if (e.type === 'click') {
            const tt = document.getElementById('aptitude-tooltip');
            if (tt && !tt.classList.contains('hidden')) {
                const keep = e.target.closest('.apt-tooltip') || e.target.closest('.apt-label');
                if (!keep) hideAptitudeTooltip();
            }
        }

        const el = e.target.closest('[data-action], [data-level]');
        if (!el) return;

        // Общая защита от "ghost click" сразу после открытия WebApp/смены экрана
        if (e.type === 'click' && Date.now() < ignoreClickUntil) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // На некоторых Android/WebView бывают "ghost" pointer/touch события при открытии экрана.
        // Чтобы уровень не запускался сам, старт уровня разрешаем только по обычному click.
        if (el.dataset.level && e.type !== 'click') {
            return;
        }

        // Запуск уровня из меню
        if (el.dataset.level && !el.dataset.action) {
            // Запрещаем автозапуск: уровень можно запускать только когда реально открыт экран уровней
            // и пользователь уже "вооружил" запуск кнопкой "Выбрать уровень".
            const active = document.querySelector('.screen.active');
            const onLevelsScreen = active && active.id === 'screen-levels';
            if (!levelLaunchArmed || !onLevelsScreen) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            // Отдельная логика для игры «Узнать, что мне подходит»
            // Она управляется через те же переключатели уровней, но запускается своим экраном.
            if (el.dataset.level === 'aptitude') {
                if (!enabledLevels.has('aptitude')) {
                    showToast("Эта игра отключена администратором");
                    return;
                }
                openAptitudeMode();
                return;
            }
            startLevel(el.dataset.level);
            return;
        }

        const action = el.dataset.action;
        if (!action) return;

        if (action === 'show-aptitude-test') {
            openAptitudeMode();
        } else if (action === 'show-professions') {
            showScreen('screen-professions');
        } else if (action === 'aptitude-hint') {
            // подсказка по шкале (по тапу)
            showAptitudeTooltip(el.dataset.hint || '', el);
        } else if (action === 'aptitude-answer') {
            // ответ в профтесте
            const s = (el.dataset.score || '').trim();
            if (s) aptitudeScores[s] = (aptitudeScores[s] || 0) + 1;
            aptitudeIndex++;
            if (aptitudeIndex >= APTITUDE_QUESTIONS.length) {
                finishAptitudeTest();
            } else {
                renderAptitudeQuestion();
            }
        } else if (action === 'restart-aptitude-test') {
            // Перепрохождение: сбрасываем результат и убираем старые ⭐ в меню
            try { localStorage.removeItem(APTITUDE_STORAGE_KEY); } catch (e) {}
            try { clearAptitudeMenuRecommendations(); } catch (e) {}
            startAptitudeTest();
        } else if (action === 'go-levels-from-test') {
            exitToLevels();
        } else if (action === 'show-levels') {
            exitToLevels();
        }
else if (action === 'save-stats') {
            exportStats();
        } else if (action === 'final-send-stats') {
            confirmSendStatsAndClose();
        } else if (action === 'start-game') {
            const lvl = Number(el.dataset.level || 1);
            startGame(lvl);
        } else if (action === 'start-doodle') {
            startDoodleLoop();
        } else if (action === 'init-2048') {
            init2048();
        } else if (action === 'close-app') {
            closeApp();
        }
    };

    // click + pointerup для надёжности
    document.addEventListener('click', handleAction, true);
});
