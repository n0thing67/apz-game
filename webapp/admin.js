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
  const $top = byId("top");
  const $users = byId("users");
  const $levels = byId("levels");

  const screens = {
    home: byId("screen-admin-home"),
    stats: byId("screen-admin-stats"),
    users: byId("screen-admin-users"),
    levels: byId("screen-admin-levels"),
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
    $top.textContent = "…";
    const data = await api("/api/admin/stats");
    if (!data.top || data.top.length === 0) {
      $top.textContent = "Пока пусто";
      return;
    }
    $top.textContent = data.top
      .map((u, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        return `${medal} ${u.first_name} ${u.last_name} — ${u.score}`;
      })
      .join("\n");
  }

  async function loadUsers() {
    $users.textContent = "…";
    const data = await api("/api/admin/stats");
    const users = (data.users || []).slice(0, 200);
    $users.textContent = users.length ? users.map(fmtUser).join("\n") : "Пока нет";
  }

  async function loadLevels() {
    $levels.innerHTML = "";
    const levelsResp = await api("/api/levels");
    const levels = levelsResp.levels || {};
    const keys = Object.keys(levels).sort();

    if (!keys.length) {
      $levels.innerHTML = '<div class="muted">Нет данных по играм.</div>';
      return;
    }

    keys.forEach((key) => {
      const active = !!levels[key];
      const row = document.createElement("div");
      row.className = "level-card";
      row.style.margin = "0";
      row.innerHTML = `
        <div class="level-title">${esc(key)}</div>
        <div class="level-stats">Статус: <b>${active ? "ВКЛ" : "ВЫКЛ"}</b></div>
        <button class="btn ${active ? "btn-secondary" : ""}" data-next="${active ? "0" : "1"}">
          ${active ? "Отключить" : "Включить"}
        </button>
      `;

      const btn = row.querySelector("button");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api("/api/admin/set_level", {
            method: "POST",
            body: JSON.stringify({ level_key: key, is_active: btn.dataset.next === "1" }),
          });
          await loadLevels();
        } catch (e) {
          alert("Ошибка: " + e.message);
        } finally {
          btn.disabled = false;
        }
      });

      $levels.appendChild(row);
    });
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

  // --- HOME actions ---
  byId("btn-refresh-home").addEventListener("click", () => checkAccess().catch((e) => alert(e.message)));

  byId("btn-reset-scores-home").addEventListener("click", async () => {
    const ok = confirm("Точно сбросить всю статистику?");
    if (!ok) return;
    try {
      await api("/api/admin/reset_scores", { method: "POST", body: "{}" });
      await checkAccess();
      alert("Статистика сброшена.");
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });

  byId("btn-exit").addEventListener("click", exit);

  // --- STATS page actions ---
  byId("back-from-stats").addEventListener("click", () => showScreen("home"));
  byId("exit-from-stats").addEventListener("click", exit);
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
  byId("exit-from-users").addEventListener("click", exit);
  byId("btn-refresh-users").addEventListener("click", () => loadUsers().catch((e) => alert(e.message)));

  byId("btn-delete-user").addEventListener("click", async () => {
    const val = (byId("delete-id").value || "").trim();
    if (!val) return;
    const ok = confirm(`Удалить пользователя ${val}?`);
    if (!ok) return;
    try {
      await api("/api/admin/delete_user", {
        method: "POST",
        body: JSON.stringify({ telegram_id: Number(val) }),
      });
      byId("delete-id").value = "";
      await loadUsers();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });
  // --- LEVELS page actions ---
  byId("back-from-levels").addEventListener("click", () => showScreen("home"));
  byId("exit-from-levels").addEventListener("click", exit);
  byId("btn-refresh-levels").addEventListener("click", () => loadLevels().catch((e) => alert(e.message)));

  // Start: stay on home, verify access once
  showScreen("home");
  await checkAccess();
}
