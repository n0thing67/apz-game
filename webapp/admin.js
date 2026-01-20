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

  // Telegram WebApp init
  try {
    if (!tg) throw new Error("Telegram WebApp не найден. Открой админку через кнопку /admin в Telegram.");
    tg.ready();
    tg.expand();
  } catch (e) {
    $who.textContent = "Ошибка: " + e.message;
    return;
  }

  // Иногда initData появляется не сразу — берём актуальное значение перед каждым запросом.
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

  // --- Tabs ---
  const tabs = [
    { key: "stats", tab: byId("tab-stats"), panel: byId("panel-stats"), loader: renderStats },
    { key: "users", tab: byId("tab-users"), panel: byId("panel-users"), loader: renderUsers },
    { key: "levels", tab: byId("tab-levels"), panel: byId("panel-levels"), loader: renderLevels },
  ];

  let activeKey = "stats";

  function setActiveTab(key) {
    activeKey = key;
    tabs.forEach((t) => {
      const isActive = t.key === key;
      t.tab.classList.toggle("active", isActive);
      t.panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }

  async function refreshActive() {
    $who.textContent = "Загрузка…";
    try {
      // Проверим доступ (любая админ-точка вернёт 401/403 если не админ)
      await api("/api/admin/stats", { method: "GET" });
      $who.textContent = "Доступ подтвержден";
    } catch (e) {
      $who.textContent = "Нет доступа: " + e.message;
      // Покажем пусто, но не падаем
      $top.textContent = "—";
      $users.textContent = "—";
      $levels.innerHTML = "";
      return;
    }

    const tab = tabs.find((t) => t.key === activeKey);
    if (tab && tab.loader) await tab.loader();
  }

  // --- Renderers ---
  async function renderStats() {
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

  async function renderUsers() {
    $users.textContent = "…";
    const data = await api("/api/admin/stats");
    const users = (data.users || []).slice(0, 200);
    $users.textContent = users.length ? users.map(fmtUser).join("\n") : "Пока нет";
  }

  async function renderLevels() {
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
          await renderLevels();
        } catch (e) {
          alert("Ошибка: " + e.message);
        } finally {
          btn.disabled = false;
        }
      });
      $levels.appendChild(row);
    });
  }

  // --- Buttons ---
  byId("btn-back").addEventListener("click", () => {
    try {
      tg?.close();
    } catch (_) {
      history.back();
    }
  });

  byId("btn-refresh").addEventListener("click", () => refreshActive().catch((e) => alert(e.message)));

  byId("btn-reset-scores").addEventListener("click", async () => {
    const ok = confirm("Точно сбросить всю статистику?");
    if (!ok) return;
    try {
      await api("/api/admin/reset_scores", { method: "POST", body: "{}" });
      await refreshActive();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });

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
      // Если мы на вкладке users — обновим её
      await refreshActive();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });

  // Tab clicks
  tabs.forEach((t) => {
    t.tab.addEventListener("click", async () => {
      setActiveTab(t.key);
      await refreshActive();
      // поднимем к началу панели после переключения
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (_) { window.scrollTo(0, 0); }
    });
  });

  // Start
  setActiveTab("stats");
  await refreshActive();
}
