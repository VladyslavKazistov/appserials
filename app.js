"use strict";
/* Премьеры — PWA-напоминалка о новых фильмах и сериалах (данные TMDB). */

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/";
const LS = {
  get(k, d) { try { const v = localStorage.getItem("pr_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem("pr_" + k, JSON.stringify(v)); },
};

const S = {
  key: LS.get("key", ""),
  rating: LS.get("rating", 7),
  kinds: LS.get("kinds", "all"),        // all | movie | tv
  days: LS.get("days", 30),
  minVotes: LS.get("minVotes", 20),
  notify: LS.get("notify", false),
  hideRuAsia: LS.get("hideRuAsia", true), // скрывать российские, турецкие и азиатские фильмы/сериалы
  genres: LS.get("genres", []),
  period: LS.get("period", { mode: "recent" }), // recent | month (ym: "2026-01") | range (from, to)          // ключи из GENRES; пусто = все жанры
  favs: LS.get("favs", []),             // [{kind,id,title,poster,date,seen}]
  seen: LS.get("seen", {}),             // id -> время, когда новинку впервые показали
  tab: "new",
  soonKind: "movie",
};
// Жанры TMDB: у фильмов и сериалов разные id, поэтому храним оба набора.
const GENRES = [
  { k: "action", n: "Боевик", m: [28], t: [10759] },
  { k: "adventure", n: "Приключения", m: [12], t: [10759] },
  { k: "comedy", n: "Комедия", m: [35], t: [35] },
  { k: "drama", n: "Драма", m: [18], t: [18] },
  // У сериалов в TMDB нет жанров «Триллер» и «Ужасы», поэтому сериалы ищем по ключевым словам (kw).
  { k: "thriller", n: "Триллер", m: [53], t: [], kw: ["thriller", "psychological thriller", "crime thriller", "political thriller", "conspiracy thriller", "suspense"] },
  { k: "horror", n: "Ужасы", m: [27], t: [], kw: ["horror", "supernatural horror", "psychological horror", "folk horror", "body horror", "slasher", "survival horror"] },
  { k: "scifi", n: "Фантастика", m: [878], t: [10765] },
  { k: "fantasy", n: "Фэнтези", m: [14], t: [10765] },
  { k: "crime", n: "Криминал", m: [80], t: [80] },
  { k: "mystery", n: "Детектив", m: [9648], t: [9648] },
  { k: "romance", n: "Мелодрама", m: [10749], t: [] },
  { k: "animation", n: "Мультфильм", m: [16], t: [16] },
  { k: "family", n: "Семейный", m: [10751], t: [10751] },
  { k: "war", n: "Военный", m: [10752], t: [10768] },
  { k: "history", n: "Исторический", m: [36], t: [] },
  { k: "documentary", n: "Документальный", m: [99], t: [99] },
  { k: "western", n: "Вестерн", m: [37], t: [37] },
];
// Набор запросов к /discover для выбранных жанров: по жанрам и (для сериалов) по ключевым словам.
async function genreQueries(kind) {
  if (!S.genres.length) return [{}];
  const sel = GENRES.filter(g => S.genres.includes(g.k));
  const qs = [];
  const ids = new Set(sel.flatMap(g => kind === "movie" ? g.m : g.t));
  if (ids.size) qs.push({ with_genres: [...ids].join("|") });
  if (kind === "tv") {
    const kw = await keywordIds(sel.flatMap(g => g.kw || []));
    if (kw.length) qs.push({ with_keywords: kw.join("|") });
  }
  return qs;
}
// id ключевых слов TMDB по их названиям (кэшируются на устройстве).
async function keywordIds(names) {
  const cache = LS.get("kwcache", {});
  let changed = false;
  for (const n of names) {
    if (cache[n]) continue;
    try {
      const d = await tmdb("/search/keyword", { query: n });
      cache[n] = (d.results || []).filter(r => (r.name || "").toLowerCase() === n).map(r => r.id);
      changed = true;
    } catch (e) { if (e.message === "NO_KEY" || e.message === "BAD_KEY") throw e; }
  }
  if (changed) LS.set("kwcache", cache);
  return [...new Set(names.flatMap(n => cache[n] || []))];
}
const genreNames = () => GENRES.filter(g => S.genres.includes(g.k)).map(g => g.n.toLowerCase()).join(", ");
const save = (...keys) => keys.forEach(k => LS.set(k, S[k]));

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = d => d.toISOString().slice(0, 10);
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const fmtDate = s => s ? new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "дата неизвестна";

function toast(msg, ms = 2500) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- TMDB ----------
async function tmdb(path, params = {}) {
  if (!S.key) throw new Error("NO_KEY");
  const u = new URL(API + path);
  const headers = {};
  if (S.key.startsWith("eyJ")) headers.Authorization = "Bearer " + S.key; else u.searchParams.set("api_key", S.key);
  u.searchParams.set("language", "ru-RU");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  const r = await fetch(u, { headers });
  if (r.status === 401) throw new Error("BAD_KEY");
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

const norm = (x, kind) => ({
  kind: kind || x.media_type,
  id: x.id,
  title: x.title || x.name,
  date: x.release_date || x.first_air_date || "",
  vote: x.vote_average || 0,
  votes: x.vote_count || 0,
  poster: x.poster_path,
  backdrop: x.backdrop_path,
  overview: x.overview,
  lang: x.original_language || "",
  countries: x.origin_country || [],
});

// Российские, турецкие и азиатские: по языку оригинала и стране производства.
const EXCL_LANGS = new Set(["ru", "tr", "ja", "ko", "zh", "cn", "th", "hi", "ta", "te", "ml", "kn", "bn", "mr", "pa", "gu", "ur", "id", "ms", "vi", "tl", "km", "lo", "my", "mn", "ne", "si", "kk", "uz", "ky", "tg"]);
const EXCL_COUNTRIES = new Set(["RU", "TR", "JP", "KR", "KP", "CN", "TW", "HK", "MO", "TH", "IN", "ID", "MY", "PH", "VN", "SG", "KH", "LA", "MM", "MN", "NP", "BD", "LK", "PK", "KZ", "UZ", "KG", "TJ", "TM", "BT", "BN", "TL", "MV", "AF"]);
const allowed = it => !S.hideRuAsia || !(EXCL_LANGS.has(it.lang) || it.countries.some(c => EXCL_COUNTRIES.has(c)));

async function discover(kind, from, to, withRating, pages = 3) {
  const dateField = kind === "movie" ? "primary_release_date" : "first_air_date";
  const base = {
    [dateField + ".gte"]: from, [dateField + ".lte"]: to,
    sort_by: "popularity.desc", include_adult: "false",
  };
  if (withRating) { base["vote_average.gte"] = S.rating; base["vote_count.gte"] = S.minVotes; }
  const out = [], seen = new Set();
  for (const q of await genreQueries(kind)) {
    for (let p = 1; p <= pages; p++) {
      const d = await tmdb("/discover/" + kind, { ...base, ...q, page: p });
      for (const it of d.results.map(x => norm(x, kind)).filter(allowed))
        if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
      if (p >= d.total_pages) break;
    }
  }
  if (kind === "tv") out.push(...await newSeasons(from, to, withRating, seen));
  return out;
}

// Новые сезоны (2-й и дальше) уже идущих сериалов, премьера которых попала в период.
const seasonCache = new Map(); // id сериала -> { t, seasons }
async function showSeasons(id) {
  const c = seasonCache.get(id);
  if (c && Date.now() - c.t < 6 * 3600e3) return c.seasons;
  const d = await tmdb(`/tv/${id}`);
  const seasons = (d.seasons || []).filter(x => x.season_number >= 1).map(x => ({ n: x.season_number, date: x.air_date || "", poster: x.poster_path }));
  seasonCache.set(id, { t: Date.now(), seasons });
  return seasons;
}
async function newSeasons(from, to, withRating, skipIds) {
  const base = { "air_date.gte": from, "air_date.lte": to, sort_by: "popularity.desc", include_adult: "false" };
  if (withRating) { base["vote_average.gte"] = S.rating; base["vote_count.gte"] = S.minVotes; }
  const cands = [], seen = new Set(skipIds);
  for (const q of await genreQueries("tv")) {
    for (let p = 1; p <= 2; p++) {
      const d = await tmdb("/discover/tv", { ...base, ...q, page: p });
      for (const it of d.results.map(x => norm(x, "tv")).filter(allowed))
        if (!seen.has(it.id) && it.date && it.date < from) { seen.add(it.id); cands.push(it); }
      if (p >= d.total_pages) break;
    }
  }
  const out = [];
  // Проверяем сериалы пачками по 8, чтобы не перегружать TMDB.
  for (let i = 0; i < cands.length; i += 8) {
    await Promise.all(cands.slice(i, i + 8).map(async it => {
      try {
        const ss = (await showSeasons(it.id)).filter(x => x.n >= 2 && x.date >= from && x.date <= to);
        for (const sn of ss) out.push({ ...it, season: sn.n, date: sn.date, poster: sn.poster || it.poster });
      } catch {}
    }));
  }
  return out;
}
const itemKey = it => it.kind + it.id + (it.season ? "s" + it.season : "");

const MONTHS_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
// Диапазон дат для экрана «Новинки» по выбранному периоду.
function periodRange() {
  const p = S.period;
  if (p.mode === "month" && p.ym) {
    const [y, m] = p.ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return [`${p.ym}-01`, `${p.ym}-${String(last).padStart(2, "0")}`];
  }
  if (p.mode === "range" && p.from && p.to) return p.from <= p.to ? [p.from, p.to] : [p.to, p.from];
  return [iso(addDays(-S.days)), iso(new Date())];
}
function periodLabel() {
  const p = S.period;
  if (p.mode === "month" && p.ym) { const [y, m] = p.ym.split("-"); return `в ${MONTHS_IN[+m - 1]} ${y}`; }
  if (p.mode === "range" && p.from && p.to) { const [a, b] = periodRange(); return `с ${fmtDate(a)} по ${fmtDate(b)}`; }
  return `за ${S.days} дн.`;
}

async function freshReleases(range) {
  const [from, to] = range || [iso(addDays(-S.days)), iso(new Date())];
  const kinds = S.kinds === "all" ? ["movie", "tv"] : [S.kinds];
  const lists = await Promise.all(kinds.map(k => discover(k, from, to, true)));
  return lists.flat().sort((a, b) => b.vote - a.vote);
}

// ---------- карточки ----------
function card(it, opts = {}) {
  const img = it.poster ? `<img loading="lazy" src="${IMG}w342${it.poster}" alt="">` : `<div class="noimg">${it.kind === "tv" ? "📺" : "🎬"}</div>`;
  const rate = it.vote ? `<div class="rate ${it.vote >= S.rating ? "hi" : ""}">★ ${it.vote.toFixed(1)}</div>` : "";
  const badge = opts.isNew ? `<div class="new">NEW</div>` : `<div class="kind">${it.kind === "tv" ? "📺" : "🎬"}</div>`;
  return `<div class="card" data-kind="${it.kind}" data-id="${it.id}">${img}${rate}${badge}
    <div class="meta"><div class="t">${esc(it.title)}</div>${it.season ? `<div class="season">Сезон ${it.season}</div>` : ""}<div class="d">${opts.sub ?? fmtDate(it.date)}</div></div></div>`;
}
function grid(items, opts) { return `<div class="grid">${items.map(i => card(i, typeof opts === "function" ? opts(i) : opts)).join("")}</div>`; }
const spinner = () => `<div class="spin">Загрузка…</div>`;

function errorView(e) {
  if (e.message === "NO_KEY") return `<div class="empty"><b>Нужен ключ TMDB</b><br><br>Откройте «Настройки» и вставьте бесплатный ключ API с themoviedb.org.<br><br><button class="btn" onclick="go('settings')">Открыть настройки</button></div>`;
  if (e.message === "BAD_KEY") return `<div class="empty"><b>Ключ TMDB не подошёл</b><br><br>Проверьте его в «Настройках».</div>`;
  return `<div class="empty"><b>Не удалось загрузить данные</b><br><br>${esc(e.message)}<br>Проверьте интернет. Если TMDB не открывается у вашего провайдера, может понадобиться VPN.</div>`;
}

// ---------- фильтр по датам ----------
function periodBar() {
  const p = S.period, now = new Date();
  const [cy, cm] = (p.ym || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`).split("-");
  const years = []; for (let y = now.getFullYear() + 1; y >= 1990; y--) years.push(y);
  const btn = (k, t) => `<button data-pm="${k}" class="${p.mode === k ? "on" : ""}">${t}</button>`;
  const kbtn = (k, t) => `<button data-kk="${k}" class="${S.kinds === k ? "on" : ""}">${t}</button>`;
  let extra = "";
  if (p.mode === "month") extra = `<div class="row" style="margin-bottom:12px">
      <select id="pmMonth">${MONTHS.map((n, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${+cm === i + 1 ? "selected" : ""}>${n[0].toUpperCase() + n.slice(1)}</option>`).join("")}</select>
      <select id="pmYear">${years.map(y => `<option ${+cy === y ? "selected" : ""}>${y}</option>`).join("")}</select></div>`;
  if (p.mode === "range") extra = `<div class="row" style="margin-bottom:12px">
      <input type="date" id="pmFrom" value="${p.from || iso(addDays(-30))}"><span style="color:var(--muted)">–</span><input type="date" id="pmTo" value="${p.to || iso(new Date())}"></div>`;
  return `<div class="seg">${btn("recent", `Последние ${S.days} дн.`)}${btn("month", "📅 Месяц")}${btn("range", "Период")}</div>${extra}
    <div class="seg">${kbtn("all", "Всё")}${kbtn("movie", "🎬 Фильмы")}${kbtn("tv", "📺 Сериалы")}</div>`;
}
function bindPeriodBar(v) {
  const setP = np => { S.period = np; save("period"); render(); };
  v.querySelectorAll("[data-pm]").forEach(b => b.onclick = () => {
    const m = b.dataset.pm, now = new Date();
    if (m === "month") setP({ mode: "month", ym: S.period.ym || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` });
    else if (m === "range") setP({ mode: "range", from: S.period.from || iso(addDays(-30)), to: S.period.to || iso(now) });
    else setP({ mode: "recent" });
  });
  v.querySelectorAll("[data-kk]").forEach(b => b.onclick = () => { S.kinds = b.dataset.kk; save("kinds"); render(); });
  const mo = v.querySelector("#pmMonth"), yr = v.querySelector("#pmYear");
  if (mo && yr) mo.onchange = yr.onchange = () => setP({ ...S.period, mode: "month", ym: `${yr.value}-${mo.value}` });
  const f = v.querySelector("#pmFrom"), t = v.querySelector("#pmTo");
  if (f && t) f.onchange = t.onchange = () => { if (f.value && t.value) setP({ ...S.period, mode: "range", from: f.value, to: t.value }); };
}

// ---------- экраны ----------
const views = {
  async new(v) {
    $("#title").textContent = "Новинки";
    $("#sub").textContent = `Вышли ${periodLabel()} · оценка от ${S.rating}` + (S.genres.length ? ` · ${genreNames()}` : "");
    const bar = periodBar();
    v.innerHTML = installHint() + bar + spinner();
    bindPeriodBar(v);
    const items = await freshReleases(periodRange());
    const now = Date.now();
    const freshIds = new Set();
    for (const it of items) {
      const k = itemKey(it);
      if (!S.seen[k]) { S.seen[k] = now; freshIds.add(k); }
      else if (now - S.seen[k] < 24 * 3600e3) freshIds.add(k);  // отмечаем как NEW сутки
    }
    save("seen");
    setBadge(0);
    v.innerHTML = installHint() + bar + (items.length
      ? grid(items, i => ({ isNew: S.period.mode === "recent" && freshIds.has(itemKey(i)) }))
      : `<div class="empty">Не нашлось ничего, что вышло ${periodLabel()}, с оценкой от <b>${S.rating}</b>${S.genres.length ? ` в жанрах: ${genreNames()}` : ""}.<br><br>Попробуйте понизить порог или выбрать другие жанры в настройках.</div>`);
    bindPeriodBar(v); // кнопки создаются заново, поэтому подключаем обработчики после отрисовки
  },

  async soon(v) {
    $("#title").textContent = "Скоро выйдет";
    $("#sub").textContent = "Ближайшие 2 месяца" + (S.genres.length ? ` · ${genreNames()}` : " · добавьте в избранное, чтобы получить напоминание");
    const seg = `<div class="seg"><button data-sk="movie" class="${S.soonKind === "movie" ? "on" : ""}">🎬 Фильмы</button><button data-sk="tv" class="${S.soonKind === "tv" ? "on" : ""}">📺 Сериалы</button></div>`;
    v.innerHTML = seg + spinner();
    const items = await discover(S.soonKind, iso(addDays(1)), iso(addDays(60)), false, 3);
    items.sort((a, b) => a.date.localeCompare(b.date));
    v.innerHTML = seg + (items.length ? grid(items, {}) : `<div class="empty">Ничего не найдено.</div>`);
    v.querySelectorAll("[data-sk]").forEach(b => b.onclick = () => { S.soonKind = b.dataset.sk; render(); });
  },

  async search(v) {
    $("#title").textContent = "Поиск";
    $("#sub").textContent = "Фильмы и сериалы";
    v.innerHTML = `<input type="search" id="q" placeholder="Название фильма или сериала" autocomplete="off"><div id="res" style="margin-top:12px"></div>`;
    const q = $("#q"), res = $("#res");
    q.value = S.lastQuery || "";
    let t;
    const run = async () => {
      const text = q.value.trim(); S.lastQuery = text;
      if (text.length < 2) { res.innerHTML = `<div class="empty">Начните вводить название.</div>`; return; }
      res.innerHTML = spinner();
      try {
        const d = await tmdb("/search/multi", { query: text, include_adult: "false" });
        const items = d.results.filter(x => x.media_type === "movie" || x.media_type === "tv").map(x => norm(x));
        res.innerHTML = items.length ? grid(items, {}) : `<div class="empty">Ничего не нашлось.</div>`;
      } catch (e) { res.innerHTML = errorView(e); }
    };
    q.oninput = () => { clearTimeout(t); t = setTimeout(run, 350); };
    run();
  },

  async fav(v) {
    $("#title").textContent = "Избранное";
    $("#sub").textContent = "Напомню, когда выйдет фильм или новая серия";
    if (!S.favs.length) {
      v.innerHTML = `<div class="empty">Здесь пока пусто.<br><br>Откройте любой фильм или сериал и нажмите <b>«Напомнить о выходе»</b>.</div>`;
      return;
    }
    const today = iso(new Date());
    const upcoming = S.favs.filter(f => f.date && f.date > today).sort((a, b) => a.date.localeCompare(b.date));
    const released = S.favs.filter(f => !(f.date && f.date > today));
    const sub = f => f.next ? `Следующая серия: ${fmtDate(f.next)}` : (f.date > today ? `Выйдет ${fmtDate(f.date)}` : fmtDate(f.date));
    v.innerHTML =
      (upcoming.length ? `<div class="section-h">Ждём</div>` + grid(upcoming, f => ({ sub: sub(f) })) : "") +
      (released.length ? `<div class="section-h">Уже вышло</div>` + grid(released, f => ({ sub: sub(f) })) : "");
  },

  async settings(v) {
    $("#title").textContent = "Настройки";
    $("#sub").textContent = "";
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    v.innerHTML = `
      <div class="field">
        <label>Минимальная оценка</label>
        <div class="big" id="rv">${S.rating.toFixed(1)}</div>
        <input type="range" id="rating" min="5" max="9.5" step="0.1" value="${S.rating}">
        <div class="hint">Показываю и напоминаю только о новинках с оценкой TMDB не ниже этой.</div>
      </div>
      <div class="field">
        <label>Что показывать</label>
        <div class="seg" id="kinds">
          <button data-k="all">Всё</button><button data-k="movie">🎬 Фильмы</button><button data-k="tv">📺 Сериалы</button>
        </div>
      </div>
      <div class="field">
        <label>Жанры</label>
        <div class="chips" id="genres" style="display:flex;flex-wrap:wrap;gap:6px">${GENRES.map(g => `<button class="gchip" data-g="${g.k}">${g.n}</button>`).join("")}</div>
        <div class="hint">Отметьте жанры, которые вам интересны. Если ничего не отмечено, показываю все жанры. <a href="#" id="gclear">Сбросить</a></div>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:10px;justify-content:space-between;margin:0"><span>Скрывать российские, турецкие и азиатские</span><input type="checkbox" id="hideRuAsia" ${S.hideRuAsia ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--acc)"></label>
        <div class="hint">Фильмы и сериалы из России, Турции, Японии, Кореи, Китая, Индии, Таиланда и других стран Азии не показываются в «Новинках» и «Скоро». В поиске они остаются.</div>
      </div>
      <div class="field">
        <label>Новинки за последние</label>
        <select id="days">${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${d === S.days ? "selected" : ""}>${d} дней</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Минимум голосов</label>
        <select id="minVotes">${[5, 20, 50, 100, 300].map(d => `<option value="${d}" ${d === S.minVotes ? "selected" : ""}>${d}</option>`).join("")}</select>
        <div class="hint">У свежих релизов мало оценок. Этот фильтр отсекает случайные «10 из 10» от пары зрителей.</div>
      </div>
      <div class="field">
        <label>Уведомления</label>
        <button class="btn ${S.notify && perm === "granted" ? "ghost" : ""}" id="notif">${S.notify && perm === "granted" ? "Включены ✓" : "Включить уведомления"}</button>
        <div class="hint">Приложение проверяет новинки при каждом открытии и раз в 30 минут, пока оно открыто. ${perm === "unsupported" ? "<br><b>На этом устройстве уведомления недоступны.</b> На iPhone сначала добавьте приложение на экран «Домой»." : ""}</div>
      </div>
      <div class="field">
        <label>Ключ TMDB API</label>
        <input type="text" id="key" placeholder="Вставьте ключ" value="${esc(S.key)}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="hint">Бесплатно: зарегистрируйтесь на <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener">themoviedb.org</a>, затем <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Настройки → API</a>. Подходит «API Key» или «API Read Access Token». Ключ хранится только на этом устройстве.</div>
        <div class="row" style="margin-top:10px"><button class="btn" id="saveKey">Сохранить ключ</button></div>
      </div>
      <div class="hint" style="color:var(--muted);font-size:12px;text-align:center;margin:20px 0">Данные о фильмах: TMDB. Этот продукт использует API TMDB, но не одобрен и не сертифицирован TMDB.</div>`;

    const r = $("#rating");
    r.oninput = () => { $("#rv").textContent = (+r.value).toFixed(1); };
    r.onchange = () => { S.rating = +r.value; save("rating"); toast(`Порог: ${S.rating.toFixed(1)}`); };
    const kb = v.querySelectorAll("[data-k]");
    const mark = () => kb.forEach(b => b.classList.toggle("on", b.dataset.k === S.kinds));
    mark();
    kb.forEach(b => b.onclick = () => { S.kinds = b.dataset.k; save("kinds"); mark(); });
    const gb = v.querySelectorAll("[data-g]");
    const gmark = () => gb.forEach(b => b.classList.toggle("on", S.genres.includes(b.dataset.g)));
    gmark();
    gb.forEach(b => b.onclick = () => {
      const k = b.dataset.g;
      S.genres = S.genres.includes(k) ? S.genres.filter(x => x !== k) : [...S.genres, k];
      save("genres"); gmark();
    });
    $("#gclear").onclick = e => { e.preventDefault(); S.genres = []; save("genres"); gmark(); toast("Показываю все жанры"); };
    $("#hideRuAsia").onchange = e => { S.hideRuAsia = e.target.checked; save("hideRuAsia"); toast(S.hideRuAsia ? "Российские, турецкие и азиатские скрыты" : "Показываю всё"); };
    $("#days").onchange = e => { S.days = +e.target.value; save("days"); };
    $("#minVotes").onchange = e => { S.minVotes = +e.target.value; save("minVotes"); };
    $("#saveKey").onclick = async () => {
      S.key = $("#key").value.trim(); save("key");
      try { await tmdb("/configuration"); toast("Ключ работает ✓"); } catch (e) { toast(e.message === "BAD_KEY" ? "Ключ не подошёл" : "Не удалось проверить ключ: " + e.message, 4000); }
    };
    $("#notif").onclick = async () => {
      if (!("Notification" in window)) { toast("Уведомления не поддерживаются на этом устройстве"); return; }
      const p = await Notification.requestPermission();
      S.notify = p === "granted"; save("notify");
      toast(S.notify ? "Уведомления включены" : "Уведомления запрещены в настройках браузера");
      render();
    };
  },
};

function installHint() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone || LS.get("hideInstall", false)) return "";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<div class="install">📲 <b>Установите как приложение:</b> ${ios ? "в Safari нажмите «Поделиться» → «На экран „Домой“»" : "в меню браузера выберите «Установить приложение» или «Добавить на главный экран»"}.
    <a href="#" style="color:var(--muted);float:right" onclick="localStorage.setItem('pr_hideInstall','true');this.parentNode.remove();return false">скрыть</a></div>`;
}

// ---------- карточка фильма ----------
const TRAILER_LANG = { uk: "на украинском", ru: "на русском", en: "на английском" };
// Трейлер: сначала украинский, потом русский, потом английский; трейлер важнее тизера.
function pickTrailer(videos) {
  const yt = (videos || []).filter(v => v.site === "YouTube" && v.key);
  const typeRank = v => ({ Trailer: 0, Teaser: 1 }[v.type] ?? 2);
  for (const lang of ["uk", "ru", "en"]) {
    const list = yt.filter(v => v.iso_639_1 === lang).sort((a, b) => typeRank(a) - typeRank(b) || (b.official === true) - (a.official === true));
    if (list.length && typeRank(list[0]) < 2) return list[0];
  }
  return null;
}
async function openDetails(kind, id) {
  const sheet = $("#sheet"), body = $("#sheet-body");
  sheet.hidden = false; body.innerHTML = spinner();
  try {
    const d = await tmdb(`/${kind}/${id}`, { append_to_response: "videos", include_video_language: "uk,ru,en" });
    const it = norm(d, kind);
    let trailer = pickTrailer(d.videos?.results);
    // У сериалов трейлеры часто привязаны к сезону: ищем в последнем сезоне.
    if (!trailer && kind === "tv" && d.number_of_seasons) {
      try {
        const sv = await tmdb(`/tv/${id}/season/${d.number_of_seasons}/videos`, { include_video_language: "uk,ru,en" });
        trailer = pickTrailer(sv.results);
      } catch {}
    }
    const isFav = S.favs.some(f => f.kind === kind && f.id === id);
    const next = d.next_episode_to_air?.air_date;
    const facts = [
      kind === "tv" ? "Сериал" : "Фильм",
      fmtDate(it.date),
      d.runtime ? `${d.runtime} мин` : "",
      kind === "tv" && d.number_of_seasons ? `${d.number_of_seasons} сез.` : "",
    ].filter(Boolean).join(" · ");
    body.innerHTML = `
      <button class="close" onclick="closeSheet()">✕</button>
      ${trailer
        ? `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?playsinline=1&rel=0" title="Трейлер" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
        : (it.backdrop ? `<img class="hero" src="${IMG}w780${it.backdrop}" alt="">` : "")}
      <div class="inner">
        ${trailer ? `<div class="facts">▶ Трейлер ${TRAILER_LANG[trailer.iso_639_1] || ""}</div>` : ""}
        <h2>${esc(it.title)}</h2>
        <div class="facts">${facts}</div>
        ${it.vote ? `<div><b style="color:${it.vote >= S.rating ? "var(--good)" : "var(--text)"}">★ ${it.vote.toFixed(1)}</b> <span style="color:var(--muted)">(${it.votes} голосов)</span></div>` : `<div style="color:var(--muted)">Оценок пока нет</div>`}
        ${next ? `<div style="margin-top:6px">📅 Следующая серия: <b>${fmtDate(next)}</b></div>` : ""}
        <div class="chips">${(d.genres || []).map(g => `<span class="chip">${esc(g.name)}</span>`).join("")}</div>
        <div class="actions">
          <button class="btn ${isFav ? "ghost" : ""}" id="favBtn">${isFav ? "✓ В избранном" : "🔔 Напомнить о выходе"}</button>
          ${trailer ? `<a class="btn ghost" href="https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}" target="_blank" rel="noopener">▶ В YouTube</a>` : ""}
        </div>
        <p>${esc(it.overview) || "<span style='color:var(--muted)'>Описания пока нет.</span>"}</p>
        <a href="https://www.themoviedb.org/${kind}/${id}" target="_blank" rel="noopener" style="color:var(--muted);font-size:13px">Открыть на TMDB</a>
      </div>`;
    $("#favBtn").onclick = () => {
      const i = S.favs.findIndex(f => f.kind === kind && f.id === id);
      if (i >= 0) { S.favs.splice(i, 1); toast("Удалено из избранного"); }
      else {
        S.favs.push({ kind, id, title: it.title, poster: it.poster, date: it.date, vote: it.vote, next, lastEp: d.last_episode_to_air?.air_date || "", notified: it.date && it.date <= iso(new Date()) });
        toast(kind === "tv" ? "Напомню о новых сериях" : "Напомню, когда выйдет");
      }
      save("favs"); openDetails(kind, id); if (S.tab === "fav") render();
    };
  } catch (e) { body.innerHTML = `<button class="close" onclick="closeSheet()">✕</button>` + errorView(e); }
}
function closeSheet() { $("#sheet").hidden = true; }

// ---------- проверка новинок и уведомления ----------
function setBadge(n) { const b = $("#badge"); b.hidden = !n; b.textContent = n; }

async function notify(title, body, tag) {
  if (!S.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
    else new Notification(title, { body, tag, icon: "icons/icon-192.png" });
  } catch {}
}

async function backgroundCheck() {
  if (!S.key) return;
  const today = iso(new Date());
  // 1) новинки выше порога, которых пользователь ещё не видел
  try {
    const items = await freshReleases();
    const unseen = items.filter(it => !S.seen[itemKey(it)]);
    if (S.tab !== "new") setBadge(unseen.length);
    if (unseen.length) {
      const top = unseen.slice(0, 3).map(i => `${i.title}${i.season ? ` (сезон ${i.season})` : ""} ★${i.vote.toFixed(1)}`).join(", ");
      notify(`Новинок с оценкой от ${S.rating}: ${unseen.length}`, top, "fresh");
    }
  } catch {}
  // 2) избранное: вышел фильм или новая серия
  let changed = false;
  for (const f of S.favs) {
    try {
      if (f.kind === "movie" && !f.notified && f.date && f.date <= today) {
        notify("Вышел фильм из избранного", f.title, "fav" + f.id); f.notified = true; changed = true;
      }
      if (f.kind === "tv") {
        const d = await tmdb(`/tv/${f.id}`);
        const last = d.last_episode_to_air?.air_date || "";
        if (last && last > (f.lastEp || "") && last <= today) {
          const ep = d.last_episode_to_air;
          notify(`Новая серия: ${f.title}`, `Сезон ${ep.season_number}, серия ${ep.episode_number}`, "tv" + f.id);
          f.lastEp = last; changed = true;
        }
        const nxt = d.next_episode_to_air?.air_date || null;
        if (nxt !== f.next) { f.next = nxt; changed = true; }
      }
    } catch {}
  }
  if (changed) save("favs");
}

// ---------- навигация ----------
async function render() {
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === S.tab));
  const v = $("#view");
  window.scrollTo(0, 0);
  try { await views[S.tab](v); } catch (e) { v.innerHTML = errorView(e); }
}
function go(tab) { S.tab = tab; render(); }
window.go = go; window.closeSheet = closeSheet;

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => go(b.dataset.tab));
$("#view").addEventListener("click", e => {
  const c = e.target.closest(".card"); if (c) openDetails(c.dataset.kind, +c.dataset.id);
});
$(".sheet-bg").onclick = closeSheet;

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (!S.key) S.tab = "settings";
render();
backgroundCheck();
setInterval(backgroundCheck, 30 * 60e3);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") backgroundCheck(); });
