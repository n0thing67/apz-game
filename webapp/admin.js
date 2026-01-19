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

  // Всегда берём актуальный initData (иногда появляется чуть позже после ready())
  function getInitData() {
    const initData = tg?.initData || "";
    return initData;
  }

  async function api(path, opts = {}) {
    const initData = getInitData();
    if (!initData) {
      // Это главная причина 401 при открытии не как WebApp или при проблеме с запуском
      throw new Error("Bad initData: открой админку внутри Telegram через /admin → кнопку, затем попробуй ещё раз.");
    }

    const headers = Object.assign(
      { "X-Telegram-InitData": initData },
      opts.headers || {}
    );

    const method = (opts.method || "GET").toUpperCase();

    // JSON по умолчанию для POST/PUT/PATCH
    if (method !== "GET" && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(path, { ...opts, headers });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`${res.status} ${t || res.statusText}`);
    }

    // Если ответ пустой — вернём null
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return await res.text().catch(() => "");
    }
    return res.json();
  }

  async function refresh() {
    $who.textContent = "Загрузка…";
    $top.textContent = "…";
    $users.textContent = "…";
    $levels.innerHTML = "";

    // 1) Админ-стата (тут у тебя и был 401)
    const data = await api("/api/admin/stats");
    $who.textContent = "Доступ подтвержден";

    // TOP
    if (!data.top || data.top.length === 0) {
      $top.textContent = "Пока пусто";
    } else {
      $top.textContent = data.top
        .map((u, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          return `${medal} ${u.first_name} ${u.last_name} — ${u.score}`;
        })
        .join("\n");
    }

    // USERS
    const users = (data.users || []).slice(0, 200);
    $users.textContent = users.length ? users.map(fmtUser).join("\n") : "Пока нет";

    // 2) Уровни — тоже через api(), чтобы initData всегда передавалось (на всякий случай)
    const levelsResp = await api("/api/levels");
    const levels = levelsResp.levels || {};
    const keys = Object.keys(levels).sort();

    keys.forEach((key) => {
      const active = !!levels[key];

      const row = document.createElement("div");
      row.className = "level-card";
      row.style.margin = "0";
      row.innerHTML = `
        <div class="level-title">${esc(key)}</div>
        <div class="level-stats">Статус: <b>${active ? "ВКЛ" : "ВЫКЛ"}</b></div>
        <button class="btn ${active ? "btn-secondary" : ""}" data-level-key="${esc(key)}" data-next="${active ? "0" : "1"}">
          ${active ? "Отключить" : "Включить"}
        </button>
      `;

      row.querySelector("button").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await api("/api/admin/set_level", {
            method: "POST",
            body: JSON.stringify({ level_key: key, is_active: btn.dataset.next === "1" }),
          });
          await refresh();
        } catch (err) {
          alert("Ошибка: " + err.message);
        } finally {
          btn.disabled = false;
        }
      });

      $levels.appendChild(row);
    });
  }

  byId("btn-refresh").addEventListener("click", () => refresh().catch((e) => alert(e.message)));

  byId("btn-back").addEventListener("click", () => {
    try {
      tg?.close();
    } catch (_) {
      history.back();
    }
  });

  byId("btn-reset-scores").addEventListener("click", async () => {
    const ok = confirm("Точно сбросить всю статистику?");
    if (!ok) return;
    try {
      await api("/api/admin/reset_scores", { method: "POST", body: "{}" });
      await refresh();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });

  byId("btn-delete-user").addEventListener("click", async () => {
    const val = byId("delete-id").value.trim();
    if (!val) return;
    const ok = confirm(`Удалить пользователя ${val}?`);
    if (!ok) return;
    try {
      await api("/api/admin/delete_user", {
        method: "POST",
        body: JSON.stringify({ telegram_id: Number(val) }),
      });
      byId("delete-id").value = "";
      await refresh();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });

  // Старт
  try {
    await refresh();
  } catch (e) {
    $who.textContent = "Нет доступа: " + e.message;
    $top.textContent = "—";
    $users.textContent = "—";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((e) => alert(e.message));
});
