/* global Telegram */

const tg = window.Telegram?.WebApp;

// Только шрифты с кириллицей (и на фронте, и на сервере).
// В мобильных WebView стилизация <option> часто игнорируется, поэтому на телефоне
// показываем кастомный пикер с превью.
const AWARD_FONTS = [
  { key: "dejavu_sans", label: "DejaVu Sans", css: "'DejaVu Sans', Arial, sans-serif" },
  { key: "dejavu_serif", label: "DejaVu Serif", css: "'DejaVu Serif', 'Times New Roman', serif" },
  { key: "dejavu_sans_cond", label: "DejaVu Sans Condensed", css: "'DejaVu Sans Condensed', Arial, sans-serif" },
  { key: "dejavu_serif_cond", label: "DejaVu Serif Condensed", css: "'DejaVu Serif Condensed', 'Times New Roman', serif" },
  { key: "liberation_sans", label: "Liberation Sans", css: "'Liberation Sans', Arial, sans-serif" },
  { key: "liberation_serif", label: "Liberation Serif", css: "'Liberation Serif', 'Times New Roman', serif" },
  { key: "noto_sans", label: "Noto Sans", css: "'Noto Sans', Roboto, Arial, sans-serif" },
  { key: "noto_serif", label: "Noto Serif", css: "'Noto Serif', 'Times New Roman', serif" },
  { key: "roboto", label: "Roboto", css: "Roboto, 'Noto Sans', Arial, sans-serif" },
  { key: "open_sans", label: "Open Sans", css: "'Open Sans', Roboto, Arial, sans-serif" },
  { key: "lato", label: "Lato", css: "Lato, 'Open Sans', Arial, sans-serif" },
  { key: "comfortaa", label: "Comfortaa", css: "Comfortaa, 'Open Sans', Arial, sans-serif" },
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
  return `${u.telegram_id} — ${u.first_name} ${u.last_name} (${u.age}) | ${u.score}`;
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => alert(e.message));
});

async function init() {
  const $who = byId("who");
  const $statsAll = byId("stats-all");
  const $levels = byId("levels");

  // USERS (delete) UI
  const $usersSearch = byId("users-search");
  const $usersList = byId("users-list");
  const $usersSelected = byId("users-selected");
  const $deleteId = byId("delete-id");
  const $btnDeleteUser = byId("btn-delete-user");

  // AWARDS UI
  const $awardsSearch = byId("awards-search");
  const $awardsList = byId("awards-list");
  const $awardsSelected = byId("awards-selected");
  const $awardFontSelect = byId("award-font");
  const $awardFontMobile = byId("award-font-mobile");
  const $awardFontSelect = byId("award-font");
  const $awardFontMobile = byId("award-font-mobile");

  const screens = {
    home: byId("screen-admin-home"),
    stats: byId("screen-admin-stats"),
    users: byId("screen-admin-users"),
    levels: byId("screen-admin-levels"),
    awards: byId("screen-admin-awards"),
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

  // Telegram init
  try {
    if (!tg) throw new Error("Telegram WebApp не найден. Открой админку через /admin → кнопку в Telegram.");
    tg.ready();
    tg.expand();
  } catch (e) {
    $who.textContent = "Ошибка: " + e.message;
    return;
  }

  function getInitData() {
    return tg?.initData || "";
  }

  async function api(path, opts = {}) {
    const initData = getInitData();
    if (!initData) throw new Error("Bad initData: открой админку внутри Telegram через /admin → кнопку.");

    const { timeoutMs: _timeoutMs, ...fetchOpts } = opts;
    const headers = Object.assign({ "X-Telegram-InitData": initData }, fetchOpts.headers || {});
    const method = (fetchOpts.method || "GET").toUpperCase();
    if (method !== "GET" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

        const url = new URL(path, window.location.href).toString();

    // В Telegram WebView иногда бывают "вечные" подвисания запросов при плохой сети/прокси.
    // Чтобы не было бесконечной «Проверки доступа…», ставим таймаут.
    const controller = new AbortController();
    const timeoutMs = typeof _timeoutMs === "number" ? _timeoutMs : 12000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, { ...fetchOpts, headers, signal: controller.signal });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Таймаут запроса. Проверь интернет или попробуй ещё раз.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
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
        <div class="admin-useritem-meta">ID: ${esc(id)} • Очки: ${esc(u.score ?? 0)}</div>
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

  function renderAwardsListFromCache() {
    const filtered = filterUsers($awardsSearch?.value, usersCache);
    renderUsersList({
      container: $awardsList,
      list: filtered,
      selectedId: selectedAwardId,
      onSelect: (u) => {
        selectedAwardId = Number(u.telegram_id);
        byId("award-user").value = String(selectedAwardId);
        if ($awardsSelected) $awardsSelected.textContent = `${userTitle(u)} (ID: ${selectedAwardId})`;
        renderAwardsListFromCache();
      },
    });

    if (!selectedAwardId) {
      if ($awardsSelected) $awardsSelected.textContent = "Не выбран";
    }
  }

  // --- Data loaders ---
  async function checkAccess() {
    $who.textContent = "Проверка доступа…";
    try {
      // Доп. страховка: если WebView/браузер подвисает и AbortController не срабатывает,
      // Promise.race гарантирует, что мы выйдем из проверки с понятным сообщением.
      const data = await Promise.race([
        api("/api/admin/stats", { method: "GET" }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Таймаут проверки доступа. Проверь интернет и попробуй ещё раз.")), 14000)
        ),
      ]);

      if (data && data.ok === false) throw new Error("Нет доступа");
      $who.textContent = "Доступ подтвержден";
      return true;
    } catch (e) {
      $who.textContent = "Нет доступа: " + (e?.message || e);
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
        return `${medal} ${u.first_name} ${u.last_name} — ${u.score}`;
      })
      .join("\n");
  }

  async function loadUsers() {
    const data = await api("/api/admin/stats");
    usersCache = (data.users || []).slice(0, 200);

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

  async function loadLevels() {
    const levelsResp = await api("/api/levels");
    const levels = levelsResp.levels || {};
    const keys = Object.keys(levels).sort();

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
      const row = document.createElement("div");
      row.className = "level-card";
      row.style.margin = "0";
      row.dataset.levelKey = key;
      row.innerHTML = `
        <div class="level-title">${levelEmoji(key)} ${esc(levelTitle(key))}</div>
        <div class="level-stats">Статус: <b class="level-status">${active ? "ВКЛ" : "ВЫКЛ"}</b></div>
        <button class="btn ${active ? "btn-secondary" : ""}" data-next="${active ? "0" : "1"}">
          ${active ? "Отключить" : "Включить"}
        </button>
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

      btn.addEventListener("click", async () => {
        const nextActive = btn.dataset.next === "1";
        btn.disabled = true;
        try {
          await api("/api/admin/set_level", {
            method: "POST",
            body: JSON.stringify({ level_key: key, is_active: nextActive }),
          });
          // Обновляем только эту карточку — без полного перерендера,
          // чтобы не было рывков страницы вверх-вниз.
          active = nextActive;
          applyState();
        } catch (e) {
          alert("Ошибка: " + e.message);
        } finally {
          btn.disabled = false;
        }
      });

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
  byId("btn-refresh-stats").addEventListener("click", () => loadStats().catch((e) => alert(e.message)));
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
    byId("award-user").value = "";
    byId("award-event").value = "";
    const $date = byId("award-date");
    if ($date) $date.value = todayISO();

    selectedAwardId = null;
    if ($awardsSelected) $awardsSelected.textContent = "Не выбран";
    renderAwardsListFromCache();
  });
  byId("btn-award-send").addEventListener("click", async () => {
    const tgId = Number((byId("award-user").value || "").trim());
    const templateKey = String(byId("award-template").value || "participation");
    const eventName = String((byId("award-event").value || "").trim());
    const rawDate = String((byId("award-date").value || "").trim());
    const eventDate = isoToRu(rawDate);
    const fontKey = String(byId("award-font")?.value || AWARD_FONTS[0].key);

    if (!tgId) {
      alert("Укажи Telegram ID пользователя");
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

  // Start: stay on home, verify access once
  showScreen("home");
  await checkAccess();
}
