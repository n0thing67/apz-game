/* global Telegram */

const tg = window.Telegram?.WebApp;

function byId(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
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

    const headers = Object.assign({ "X-Telegram-InitData": initData }, opts.headers || {});
    const method = (opts.method || "GET").toUpperCase();
    if (method !== "GET" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const res = await fetch(path, { ...opts, headers });
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
        <div class="admin-useritem-meta">Telegram ID: ${esc(id)}</div>
        <div class="admin-useritem-meta2">Очки: ${esc(u.score ?? 0)}</div>
      `;
      row.addEventListener("click", () => onSelect?.(u));
      container.appendChild(row);
    });
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
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso || "").trim();
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  function setAwardsDateTodayIfEmpty(force = false) {
    const el = byId("award-date");
    if (!el) return;
    if (force || !String(el.value || "").trim()) el.value = todayISO();
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
      await api("/api/admin/stats", { method: "GET" });
      $who.textContent = "Доступ подтвержден";
      return true;
    } catch (e) {
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
      setAwardsDateTodayIfEmpty(true);
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
    byId("award-date").value = "";
    setAwardsDateTodayIfEmpty(true);

    selectedAwardId = null;
    if ($awardsSelected) $awardsSelected.textContent = "Не выбран";
    renderAwardsListFromCache();
  });
  byId("btn-award-send").addEventListener("click", async () => {
    const tgId = Number((byId("award-user").value || "").trim());
    const templateKey = String(byId("award-template").value || "participation");
    const fontKey = String(byId("award-font")?.value || "dejavu_sans");
    const eventName = String((byId("award-event").value || "").trim());
    const eventDateIso = String((byId("award-date").value || "").trim());
    const eventDate = isoToRu(eventDateIso);

    if (!tgId) {
      alert("Выбери пользователя из списка ниже");
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
          font_key: fontKey,
          event_name: eventName,
          event_date: eventDate,
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
