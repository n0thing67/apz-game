/* global Telegram */

const tg = window.Telegram?.WebApp;
const ADMIN_TOKEN = new URLSearchParams(window.location.search).get("admin_token") || "";

// В админке оставляем только два шрифта.
// (Сервер тоже принимает только эти ключи; всё остальное фолбэкается в DejaVu Sans.)
const AWARD_FONTS = [
  { key: "dejavu_sans", label: "DejaVu Sans", css: "'DejaVu Sans', Arial, sans-serif" },
  { key: "dejavu_serif", label: "DejaVu Serif", css: "'DejaVu Serif', 'Times New Roman', serif" },
];

function byId(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoToRu(iso) {
  // iso: YYYY-MM-DD -> DD.MM.YYYY
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return String(iso || "").trim();
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function fmtUser(u) {
  return `${u.telegram_id} — ${u.first_name} ${u.last_name} (${u.age}) | ${u.city || "—"} | ${u.score}`;
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => alert(e.message));
});

async function init() {
  const $who = byId("who");
  const $statsAll = byId("stats-all");
  const $levels = byId("levels");
  const $usersAll = byId("users-all");

  // USERS (delete) UI
  const $usersSearch = byId("users-search");
  const $usersList = byId("users-list");
  const $usersSelected = byId("users-selected");
  const $deleteId = byId("delete-id");
  const $btnDeleteUser = byId("btn-delete-user");

  // RESET USER STATS UI
  const $resetUserSearch = byId("reset-user-search");
  const $resetUserList = byId("reset-user-list");
  const $resetUserSelected = byId("reset-user-selected");
  const $resetUserId = byId("reset-user-id");
  const $btnResetUserScores = byId("btn-reset-user-scores");

  // USERS VIEW UI
  const $usersViewSearch = byId("users-view-search");
  const $usersViewList = byId("users-view-list");


  // AWARDS UI
  const $awardsSearch = byId("awards-search");
  const $awardsList = byId("awards-list");
  const $awardsSelected = byId("awards-selected");
  const $awardFontSelect = byId("award-font");
  const $awardFontMobile = byId("award-font-mobile");
  const $awardDate = byId("award-date");
  const $awardDateBtn = byId("award-date-btn");

  const screens = {
    home: byId("screen-admin-home"),
    stats: byId("screen-admin-stats"),
    users: byId("screen-admin-users"),
    levels: byId("screen-admin-levels"),
    awards: byId("screen-admin-awards"),
    resetUserStats: byId("screen-admin-reset-user-stats"),
    usersView: byId("screen-admin-users-view"),
  };

  function showScreen(key) {
    Object.entries(screens).forEach(([k, el]) => {
      const active = k === key;
      if (!el) return;
      el.classList.toggle("active", active);
      el.setAttribute("aria-hidden", active ? "false" : "true");
    });
    // прокрутим к верху
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (_) {
      window.scrollTo(0, 0);
    }
  }

  function isMobileUi() {
    return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  }

  // Кнопка календаря (внутри поля даты)
  if ($awardDateBtn && $awardDate) {
    $awardDateBtn.addEventListener("click", () => {
      try {
        // Chromium/WebView
        if (typeof $awardDate.showPicker === "function") {
          $awardDate.showPicker();
        } else {
          $awardDate.focus();
          $awardDate.click();
        }
      } catch (_) {
        $awardDate.focus();
      }
    });
  }

  function setAwardFontValue(fontKey) {
    const key = String(fontKey || "dejavu_sans");
    if ($awardFontSelect) $awardFontSelect.value = key;
    // синхронизируем мобильную кнопку
    const btn = byId("award-font-mobile-btn");
    const sample = byId("award-font-mobile-sample");
    const chosen = AWARD_FONTS.find((f) => f.key === key) || AWARD_FONTS[0];
    if (btn) btn.textContent = chosen.label;
    if (sample) {
      sample.style.fontFamily = chosen.css;
      sample.textContent = "Пример: Абвгд Ёжик 123";
    }
  }

  function setupAwardFontPicker() {
    // Заполняем desktop select (и как источник значения для API)
    if ($awardFontSelect) {
      $awardFontSelect.innerHTML = "";
      AWARD_FONTS.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.key;
        opt.textContent = f.label;
        // На десктопе браузер обычно применяет стиль к option; на мобилках — нет.
        opt.style.fontFamily = f.css;
        $awardFontSelect.appendChild(opt);
      });
      // Не даём iOS зумить на фокусе инпута
      $awardFontSelect.style.fontSize = "16px";
      $awardFontSelect.addEventListener("change", () => setAwardFontValue($awardFontSelect.value));
    }

    // Mobile: кастомная кнопка + модалка со списком
    if ($awardFontMobile) {
      $awardFontMobile.innerHTML = `
        <button type="button" class="btn admin-font-mobile-btn" id="award-font-mobile-open">
          Выбрать шрифт
        </button>
        <div class="admin-font-mobile-preview">
          <div class="admin-font-mobile-label" id="award-font-mobile-btn"></div>
          <div class="admin-font-mobile-sample" id="award-font-mobile-sample"></div>
        </div>
      `;

      let overlay = document.getElementById("award-font-modal");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "admin-font-modal";
        overlay.id = "award-font-modal";
        overlay.innerHTML = `
        <div class="admin-font-modal-sheet" role="dialog" aria-modal="true">
          <div class="admin-font-modal-head">
            <div class="admin-font-modal-title">Выбор шрифта</div>
            <button type="button" class="btn btn-secondary admin-font-modal-close" id="award-font-modal-close">Закрыть</button>
          </div>
          <div class="admin-font-modal-list" id="award-font-modal-list"></div>
        </div>
      `;
        document.body.appendChild(overlay);

        const list = overlay.querySelector("#award-font-modal-list");
        AWARD_FONTS.forEach((f) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "admin-font-item";
          b.style.fontFamily = f.css;
          b.innerHTML = `
            <div class="admin-font-item-name">${esc(f.label)}</div>
            <div class="admin-font-item-sample">Абвгд Ёжик 123</div>
          `;
          b.addEventListener("click", () => {
            setAwardFontValue(f.key);
            overlay.classList.remove("open");
          });
          list.appendChild(b);
        });

        const closeBtn = overlay.querySelector("#award-font-modal-close");
        closeBtn?.addEventListener("click", () => overlay.classList.remove("open"));
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) overlay.classList.remove("open");
        });
      }

      const openBtn = byId("award-font-mobile-open");
      openBtn?.addEventListener("click", () => overlay.classList.add("open"));
    }

    // Покажем нужный вариант в зависимости от ширины
    const apply = () => {
      const mobile = isMobileUi();
      if ($awardFontSelect) $awardFontSelect.style.display = mobile ? "none" : "";
      if ($awardFontMobile) $awardFontMobile.style.display = mobile ? "" : "none";
    };
    apply();
    window.addEventListener("resize", apply);

    // Значение по умолчанию
    setAwardFontValue($awardFontSelect?.value || "dejavu_sans");
  }

  function exit() {
    try {
      tg?.close();
    } catch (_) {
      history.back();
    }
  }

  const hasAdminToken = Boolean(ADMIN_TOKEN);

  // Telegram init нужен только внутри Telegram. Для MAX/внешнего браузера работаем по admin_token.
  try {
    if (tg) {
      tg.ready();
      tg.expand();
    } else if (!hasAdminToken) {
      throw new Error("Открой админку через /admin в Telegram или MAX.");
    }
  } catch (e) {
    $who.textContent = "Ошибка: " + e.message;
    return;
  }

  function getInitData() {
    return tg?.initData || "";
  }

  async function api(path, opts = {}) {
    const { timeoutMs: _timeoutMs, ...fetchOpts } = opts;
    const headers = Object.assign({}, fetchOpts.headers || {});

    if (hasAdminToken) {
      headers["X-Admin-Token"] = ADMIN_TOKEN;
    } else {
      const initData = getInitData();
      if (!initData) throw new Error("Bad initData: открой админку через /admin → кнопку.");
      headers["X-Telegram-InitData"] = initData;
    }
    const method = (fetchOpts.method || "GET").toUpperCase();
    if (method !== "GET" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const finalFetchOpts = {
      cache: fetchOpts.cache || "no-store",
      ...fetchOpts,
    };

    const url = new URL(path, window.location.href).toString();
    // В Telegram WebView иногда бывают "вечные" подвисания запросов при плохой сети/прокси.
    // AbortController может не сработать в некоторых WebView, поэтому делаем "жёсткий" таймаут через Promise.race.
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = typeof _timeoutMs === "number" ? _timeoutMs : 12000;

    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
    try {
    controller?.abort?.();
    } catch (_) {}
    reject(new Error("Таймаут запроса. Проверь интернет или попробуй ещё раз."));
    }, timeoutMs);
    });

    let res;
    try {
    const fetchPromise = fetch(url, { ...finalFetchOpts, headers, signal: controller?.signal });
    res = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (err) {
    if (err?.name === "AbortError") {
    throw new Error("Таймаут запроса. Проверь интернет или попробуй ещё раз.");
    }
    throw err;
    } finally {
    if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`${res.status} ${t || res.statusText}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return await res.text().catch(() => "");
    return res.json();
  }

  // --- Users list helpers ---
  let usersCache = [];
  let selectedDeleteId = null;
  let selectedResetId = null;
  let selectedAwardId = null;

  function norm(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е");
  }

  function userTitle(u) {
    const fn = String(u.first_name || "").trim();
    const ln = String(u.last_name || "").trim();
    return `${fn} ${ln}`.trim() || `ID ${u.telegram_id}`;
  }

  function filterUsers(q, list) {
    const nq = norm(q);
    if (!nq) return list;
    return (list || []).filter((u) => {
      const fn = norm(u.first_name);
      const ln = norm(u.last_name);
      const full = `${fn} ${ln}`.trim();
      return fn.includes(nq) || ln.includes(nq) || full.includes(nq);
    });
  }

  function renderUsersList({
    container,
    list,
    selectedId,
    onSelect,
  }) {
    if (!container) return;
    container.innerHTML = "";

    if (!list.length) {
      container.innerHTML = '<div class="muted" style="padding:10px;">Пока нет</div>';
      return;
    }

    list.forEach((u) => {
      const id = Number(u.telegram_id);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "admin-useritem" + (id === selectedId ? " selected" : "");
      row.innerHTML = `
        <div class="admin-useritem-name">${esc(userTitle(u))}</div>
        <div class="admin-useritem-meta">ID: ${esc(id)} • Город: ${esc(u.city || "—")} • Очки: ${esc(u.score ?? 0)}</div>
      `;
      row.addEventListener("click", () => onSelect?.(u));
      container.appendChild(row);
    });
  }

  function renderDeleteListFromCache() {
    const filtered = filterUsers($usersSearch?.value, usersCache);
    renderUsersList({
      container: $usersList,
      list: filtered,
      selectedId: selectedDeleteId,
      onSelect: (u) => {
        selectedDeleteId = Number(u.telegram_id);
        $deleteId.value = String(selectedDeleteId);
        if ($usersSelected) $usersSelected.textContent = `${userTitle(u)} (ID: ${selectedDeleteId})`;
        if ($btnDeleteUser) $btnDeleteUser.disabled = false;
        renderDeleteListFromCache();
      },
    });

    if (!selectedDeleteId) {
      if ($usersSelected) $usersSelected.textContent = "Не выбран";
      if ($btnDeleteUser) $btnDeleteUser.disabled = true;
    }
  }

  
  function renderResetUserListFromCache() {
    const filtered = filterUsers($resetUserSearch?.value, usersCache);
    renderUsersList({
      container: $resetUserList,
      list: filtered,
      selectedId: selectedResetId,
      onSelect: (u) => {
        selectedResetId = Number(u.telegram_id);
        if ($resetUserId) $resetUserId.value = String(selectedResetId);
        if ($resetUserSelected) $resetUserSelected.textContent = `${userTitle(u)} (ID: ${selectedResetId})`;
        if ($btnResetUserScores) $btnResetUserScores.disabled = false;
        renderResetUserListFromCache();
      },
    });

    if (!selectedResetId) {
      if ($resetUserSelected) $resetUserSelected.textContent = "Не выбран";
      if ($btnResetUserScores) $btnResetUserScores.disabled = true;
    }
  }

  function renderUsersViewListFromCache() {
    const filtered = filterUsers($usersViewSearch?.value, usersCache);
    renderUsersList({
      container: $usersViewList,
      list: filtered,
      selectedId: null,
      onSelect: null,
    });
  }

function renderAwardsListFromCache() {
    const filtered = filterUsers($awardsSearch?.value, usersCache);
    renderUsersList({
      container: $awardsList,
      list: filtered,
      selectedId: selectedAwardId,
      onSelect: (u) => {
        selectedAwardId = Number(u.telegram_id);
        if ($awardsSelected) $awardsSelected.textContent = `${userTitle(u)} (ID: ${selectedAwardId})`;
        renderAwardsListFromCache();
      },
    });

    if (!selectedAwardId) {
      if ($awardsSelected) $awardsSelected.textContent = "Не выбран";
    }
  }

  // --- Data loaders ---
  const ADMIN_ACCESS_CACHE_KEY = "apz_admin_access_cache_v1";
  const ADMIN_ACCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов: достаточно для кратких падений Supabase

  function getCurrentTelegramId() {
    // initDataUnsafe доступен только внутри Telegram WebApp
    const id = tg?.initDataUnsafe?.user?.id;
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }

  function readAdminAccessCache() {
    try {
      const raw = localStorage.getItem(ADMIN_ACCESS_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function writeAdminAccessCache(ok) {
    try {
      const telegramId = getCurrentTelegramId();
      if (!telegramId) return;
      localStorage.setItem(
        ADMIN_ACCESS_CACHE_KEY,
        JSON.stringify({ telegram_id: telegramId, ok: Boolean(ok), ts: Date.now() })
      );
    } catch (_) {
      // ignore
    }
  }

  function canUseCachedAccess() {
    const telegramId = getCurrentTelegramId();
    if (!telegramId) return false;
    const c = readAdminAccessCache();
    if (!c || c.ok !== true) return false;
    if (Number(c.telegram_id) !== telegramId) return false;
    const age = Date.now() - Number(c.ts || 0);
    return age >= 0 && age <= ADMIN_ACCESS_CACHE_TTL_MS;
  }

  async function checkAccess() {
    $who.textContent = "Проверка доступа…";
    try {
      await api("/api/admin/stats", { method: "GET" });
      writeAdminAccessCache(true);
      $who.textContent = "Доступ подтвержден";
      return true;
    } catch (e) {
      // Если Supabase/сеть кратковременно легли — дадим админке открыться по кэшу.
      if (canUseCachedAccess()) {
        $who.textContent = "Доступ подтвержден (офлайн по кэшу)";
        return true;
      }
      $who.textContent = "Нет доступа: " + e.message;
      return false;
    }
  }

  async function loadStats() {
    $statsAll.textContent = "…";
    const data = await api("/api/admin/stats");

    const users = (data.users || []).slice();
    if (!users.length) {
      $statsAll.textContent = "Пока пусто";
      return;
    }

    // Сортируем по очкам (по убыванию), дальше по имени для стабильности
    users.sort((a, b) => {
      const ds = (b.score || 0) - (a.score || 0);
      if (ds !== 0) return ds;
      const an = `${a.first_name || ""} ${a.last_name || ""}`.trim();
      const bn = `${b.first_name || ""} ${b.last_name || ""}`.trim();
      return an.localeCompare(bn, "ru");
    });

    $statsAll.textContent = users
      .map((u, i) => {
        const n = i + 1;
        const medal = n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : `${n}.`;
        return `${medal} ${u.first_name} ${u.last_name} (${u.city || "—"}) — ${u.score}`;
      })
      .join("\n");
  }

  async function loadUsers() {
    const data = await api("/api/admin/stats");
    usersCache = (data.users || []).slice(0, 500);

    if ($usersAll) {
      if (!usersCache.length) {
        $usersAll.textContent = "Пока пусто";
      } else {
        const orderedUsers = usersCache.slice().sort((a, b) => {
          const an = `${a.first_name || ""} ${a.last_name || ""}`.trim();
          const bn = `${b.first_name || ""} ${b.last_name || ""}`.trim();
          return an.localeCompare(bn, "ru");
        });
        $usersAll.textContent = orderedUsers
          .map((u, i) => `${i + 1}. ${u.first_name} ${u.last_name} (${u.city || "—"}) — ${u.score ?? 0}`)
          .join("
");
      }
    }

    // если выбранного уже нет — сбросим
    if (selectedDeleteId && !usersCache.some((u) => Number(u.telegram_id) === selectedDeleteId)) {
      selectedDeleteId = null;
      $deleteId.value = "";
    }

    renderDeleteListFromCache();
  }

  async function loadAwardsUsers() {
    const data = await api("/api/admin/stats");
    usersCache = (data.users || []).slice(0, 200);

    if (selectedAwardId && !usersCache.some((u) => Number(u.telegram_id) === selectedAwardId)) {
      selectedAwardId = null;
    }

    renderAwardsListFromCache();
  }

  async function loadResetUsers() {
    const data = await api("/api/admin/stats");
    usersCache = (data.users || []).slice(0, 500);

    if (selectedResetId && !usersCache.some((u) => Number(u.telegram_id) === selectedResetId)) {
      selectedResetId = null;
      if ($resetUserId) $resetUserId.value = "";
    }

    renderResetUserListFromCache();
  }

  async function loadUsersView() {
    const data = await api("/api/admin/stats");
    usersCache = (data.users || []).slice(0, 500);
    renderUsersViewListFromCache();
  }


  async function loadLevels() {
    // Во внешних браузерах/WebView GET /api/levels может агрессивно кешироваться,
    // из-за чего после переключения карточка тут же "откатывается" назад старым ответом.
    // Для админки всегда перечитываем уровни без кеша и с cache-buster.
    const levelsResp = await api(`/api/levels?_=${Date.now()}`, { cache: "no-store" });
    const levels = levelsResp.levels || {};
    const keys = Object.keys(levels).filter((k) => String(k) !== "aptitude").sort();

    if (!keys.length) {
      $levels.innerHTML = '<div class="muted">Нет данных по играм.</div>';
      return;
    }

    function levelEmoji(levelKey) {
      const k = String(levelKey || "").toLowerCase();
      if (k.includes("puzzle") || k.includes("logo") || k.includes(" пазл") || k.includes("пазл")) return "🧩";
      if (k.includes("2048")) return "🔢";
      if (k.includes("quiz") || k.includes("квиз") || k.includes("test") || k.includes("тест")) return "❓";
      if (k.includes("aptitude") || k.includes("подходит") || k.includes("проф")) return "🧠";
      if (k.includes("jumper") || k.includes("doodle") || k.includes("джампер") || k.includes("прыж")) return "🦘";
      return "🎮";
    }

    function levelTitle(levelKey) {
      // Чтобы в админке было понятно, что это за уровень.
      if (String(levelKey) === "aptitude") return "что тебе подходит";
      return String(levelKey);
    }

    const frag = document.createDocumentFragment();

    keys.forEach((key) => {
      let active = !!levels[key];
      const isAptitudeLevel = String(key) === "aptitude";
      const row = document.createElement("div");
      row.className = "level-card";
      row.style.margin = "0";
      row.dataset.levelKey = key;
      row.innerHTML = `
        <div class="level-title">${levelEmoji(key)} ${esc(levelTitle(key))}</div>
        <div class="level-stats">Статус: <b class="level-status">${active ? "ВКЛ" : "ВЫКЛ"}</b></div>
        ${isAptitudeLevel && active
          ? '<div class="level-stats" style="margin-top:10px;">Этот уровень нельзя отключить.</div>'
          : `<button type="button" class="btn ${active ? "btn-secondary" : ""}" data-next="${active ? "0" : "1"}">
          ${active ? "Отключить" : "Включить"}
        </button>`}
      `;

      const statusEl = row.querySelector(".level-status");
      const btn = row.querySelector("button");

      function applyState() {
        if (statusEl) statusEl.textContent = active ? "ВКЛ" : "ВЫКЛ";
        if (btn) {
          btn.classList.toggle("btn-secondary", active);
          btn.dataset.next = active ? "0" : "1";
          btn.textContent = active ? "Отключить" : "Включить";
        }
      }

      if (btn) {
        btn.addEventListener("click", async () => {
          const nextActive = btn.dataset.next === "1";
          btn.disabled = true;
          try {
            if (hasAdminToken) {
              // Для MAX/внешнего браузера делаем переключение по GET-параметрам,
              // как и остальные запросы доступа по admin_token. Это обходит капризные WebView,
              // где POST+JSON для этого экрана может не доходить стабильно.
              const qs = new URLSearchParams({
                level_key: key,
                is_active: nextActive ? "1" : "0",
                admin_token: ADMIN_TOKEN,
                _: String(Date.now()),
              });
              await api(`/api/admin/set_level?${qs.toString()}`, {
                method: "GET",
                cache: "no-store",
              });
            } else {
              await api("/api/admin/set_level", {
                method: "POST",
                body: JSON.stringify({ level_key: key, is_active: nextActive }),
              });
            }
            // Обновляем только эту карточку — без полного перерендера,
            // чтобы не было рывков страницы вверх-вниз.
            active = nextActive;
            applyState();
            // На некоторых мобильных WebView безопаснее сразу перечитать состояние с сервера.
            try { await loadLevels(); } catch (_) {}
          } catch (e) {
            alert("Ошибка: " + e.message);
          } finally {
            btn.disabled = false;
          }
        });
      }

      frag.appendChild(row);
    });

    // replaceChildren перерисовывает разом, без промежуточного "пусто" (меньше дерганий)
    $levels.replaceChildren(frag);
  }

  // --- Navigation buttons (HOME) ---
  byId("go-stats").addEventListener("click", async () => {
    try {
      if (!(await checkAccess())) return;
      showScreen("stats");
      await loadStats();
      // В окне "Статистика" теперь также есть блок очистки статистики пользователя.
      await loadResetUsers();
    } catch (e) {
      alert(e.message);
    }
  });

  byId("go-users").addEventListener("click", async () => {
    try {
      if (!(await checkAccess())) return;
      showScreen("users");
      await loadUsers();
    } catch (e) {
      alert(e.message);
    }
  });

  byId("go-users-view")?.addEventListener("click", async () => {
    try {
      if (!(await checkAccess())) return;
      showScreen("usersView");
      await loadUsersView();
    } catch (e) {
      alert(e.message);
    }
  });


  byId("go-levels").addEventListener("click", async () => {
    try {
      if (!(await checkAccess())) return;
      showScreen("levels");
      await loadLevels();
    } catch (e) {
      alert(e.message);
    }
  });

  byId("go-awards").addEventListener("click", async () => {
    try {
      if (!(await checkAccess())) return;
      showScreen("awards");
      const $date = byId("award-date");
      if ($date && !$date.value) $date.value = todayISO();
      setupAwardFontPicker();
      await loadAwardsUsers();
    } catch (e) {
      alert(e.message);
    }
  });

  // --- HOME actions ---
  byId("btn-exit").addEventListener("click", exit);

  // --- STATS page actions ---
  byId("back-from-stats").addEventListener("click", () => showScreen("home"));
  byId("btn-refresh-stats").addEventListener("click", () => {
    Promise.all([loadStats(), loadResetUsers()]).catch((e) => alert(e.message));
  });

  byId("btn-reset-scores-stats").addEventListener("click", async () => {
    const ok = confirm("Точно сбросить всю статистику?");
    if (!ok) return;
    try {
      await api("/api/admin/reset_scores", { method: "POST", body: "{}" });
      await loadStats();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });

  // --- RESET USER STATS page actions ---
  byId("back-from-reset-user-stats")?.addEventListener("click", () => showScreen("stats"));
  byId("btn-refresh-reset-user")?.addEventListener("click", () => loadResetUsers().catch((e) => alert(e.message)));
  $resetUserSearch?.addEventListener("input", () => renderResetUserListFromCache());

  byId("btn-reset-user-scores")?.addEventListener("click", async () => {
    if (!selectedResetId) return;
    const u = usersCache.find((x) => Number(x.telegram_id) === selectedResetId);
    const title = u ? userTitle(u) : String(selectedResetId);
    const ok = confirm(`Точно очистить статистику у пользователя ${title}?`);
    if (!ok) return;
    try {
      await api("/api/admin/reset_user_scores", {
        method: "POST",
        body: JSON.stringify({ telegram_id: selectedResetId }),
      });
      // обновим список/выбор
      selectedResetId = null;
      if ($resetUserId) $resetUserId.value = "";
      renderResetUserListFromCache();
      await loadStats();
      alert("Готово! Статистика очищена.");
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });


  // --- USERS page actions ---
  byId("back-from-users").addEventListener("click", () => showScreen("home"));
  byId("btn-refresh-users").addEventListener("click", () => loadUsers().catch((e) => alert(e.message)));

  $usersSearch?.addEventListener("input", () => {
    // фильтрация без запроса на сервер
    renderDeleteListFromCache();
  });

  byId("btn-delete-user").addEventListener("click", async () => {
    const val = Number(($deleteId.value || "").trim());
    if (!val) return;
    const ok = confirm(`Удалить выбранного пользователя (ID: ${val})?`);
    if (!ok) return;
    try {
      await api("/api/admin/delete_user", {
        method: "POST",
        body: JSON.stringify({ telegram_id: val }),
      });
      selectedDeleteId = null;
      $deleteId.value = "";
      await loadUsers();
      alert("Пользователь был удалён");
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });
  byId("btn-delete-all-users")?.addEventListener("click", async () => {
    const ok = confirm("Точно удалить ВСЕХ пользователей? Это действие необратимо.");
    if (!ok) return;
    const ok2 = confirm("Последнее предупреждение: будут удалены все пользователи и их статистика. Продолжить?");
    if (!ok2) return;
    try {
      await api("/api/admin/delete_all_users", { method: "POST", body: "{}" });
      selectedDeleteId = null;
      if ($deleteId) $deleteId.value = "";
      // Обновим списки и статистику
      await Promise.all([loadUsers(), loadStats()]);
      alert("Готово! Все пользователи удалены.");
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });


  // --- LEVELS page actions ---
  byId("back-from-levels").addEventListener("click", () => showScreen("home"));
  byId("btn-refresh-levels").addEventListener("click", () => loadLevels().catch((e) => alert(e.message)));

  // --- AWARDS page actions ---
  byId("back-from-awards").addEventListener("click", () => showScreen("home"));
  byId("btn-award-refresh").addEventListener("click", () => loadAwardsUsers().catch((e) => alert(e.message)));

  $awardsSearch?.addEventListener("input", () => {
    renderAwardsListFromCache();
  });

  byId("btn-award-clear").addEventListener("click", () => {
    byId("award-event").value = "";
    const $date = byId("award-date");
    if ($date) $date.value = todayISO();

    selectedAwardId = null;
    renderAwardsListFromCache();
  });
  byId("btn-award-send").addEventListener("click", async () => {
    const tgId = Number(selectedAwardId);
    const templateKey = String(byId("award-template").value || "participation");
    const eventName = String((byId("award-event").value || "").trim());
    const rawDate = String((byId("award-date").value || "").trim());
    const eventDate = isoToRu(rawDate);
    const fontKey = String(byId("award-font")?.value || AWARD_FONTS[0].key);

    if (!tgId) {
      alert("Выбери пользователя из списка");
      return;
    }
    if (!eventName) {
      alert("Укажи название мероприятия");
      return;
    }
    if (!eventDate) {
      alert("Укажи дату");
      return;
    }

    const ok = confirm("Сформировать и отправить документ этому пользователю?");
    if (!ok) return;

    const btn = byId("btn-award-send");
    btn.disabled = true;
    try {
      await api("/api/admin/send_award", {
        method: "POST",
        // Дипломы (особенно с дублированием в админ-канал) могут генерироваться/отправляться дольше,
        // чем дефолтные 12 секунд. Увеличиваем таймаут только для этой операции.
        timeoutMs: 60000,
        body: JSON.stringify({
          telegram_id: tgId,
          template_key: templateKey,
          event_name: eventName,
          event_date: eventDate,
          font_key: fontKey,
        }),
      });
      alert("Отправлено ✅");
    } catch (e) {
      alert("Ошибка: " + e.message);
    } finally {
      btn.disabled = false;
    }
  });


  // --- USERS VIEW page actions ---
  byId("back-from-users-view")?.addEventListener("click", () => showScreen("home"));
  byId("btn-refresh-users-view")?.addEventListener("click", () => loadUsersView().catch((e) => alert(e.message)));
  $usersViewSearch?.addEventListener("input", () => renderUsersViewListFromCache());

  // Start: stay on home, verify access once
  showScreen("home");
  await checkAccess();
}
