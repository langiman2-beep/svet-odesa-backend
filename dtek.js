const DTEK_URL = "https://www.dtek-oem.com.ua/ua/shutdowns";
const GITHUB_URL =
  "https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data/odesa.json";
const FALLBACK_TG_URL = "https://t.me/s/dtek_ua";

const GROUPS = [
  "1.1",
  "1.2",
  "2.1",
  "2.2",
  "3.1",
  "3.2",
  "4.1",
  "4.2",
  "5.1",
  "5.2",
  "6.1",
  "6.2",
];

const ONE_MINUTE = 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const STALE_LIMIT = 3 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 15 * 1000;

let state = {
  data: null,
  source: "none",
  lastSuccessAt: null,
  failCount: 0,
  tgNotice: null,
  tgUpdatedAt: null,
};

let workerStarted = false;

function decodeHtmlEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractJson(html, marker) {
  const i = html.indexOf(marker);
  if (i === -1) return null;
  const start = html.indexOf("{", i);
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let j = start; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseUpdateMs(str) {
  if (typeof str !== "string") return 0;
  const m = str.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Date.UTC(
    Number(m[3]),
    Number(m[2]) - 1,
    Number(m[1]),
    Number(m[4]),
    Number(m[5]),
  );
}

async function fetchDtekDirect() {
  const res = await fetch(DTEK_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept-Language": "uk-UA,uk;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`DTEK HTTP ${res.status}`);

  const html = await res.text();
  const fact = extractJson(html, "DisconSchedule.fact");
  if (!fact || typeof fact !== "object" || !fact.data) {
    throw new Error("На странице ДТЭК не найден DisconSchedule.fact");
  }

  const preset = extractJson(html, "DisconSchedule.preset");
  return { fact, preset };
}

async function fetchGithubFallback() {
  const res = await fetch(`${GITHUB_URL}?t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);

  const rawJson = await res.json();
  if (!rawJson || typeof rawJson !== "object" || !rawJson.fact) {
    throw new Error("Некорректная структура JSON от GitHub");
  }
  return rawJson;
}

async function fetchTelegramFallback() {
  const res = await fetch(FALLBACK_TG_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);

  const html = await res.text();
  const matches = [
    ...html.matchAll(
      /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g,
    ),
  ];
  const recentPosts = matches
    .slice(-5)
    .map((m) =>
      decodeHtmlEntities(
        m[1]
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    )
    .filter((text) => /одес/i.test(text));

  return recentPosts.length > 0 ? recentPosts[recentPosts.length - 1] : null;
}

async function runScheduleCycle() {
  // 1. Сначала пробуем напрямую с ДТЭК
  try {
    const dtekData = await fetchDtekDirect();
    if (!dtekData.preset && state.data?.preset) {
      dtekData.preset = state.data.preset;
    }

    state.data = dtekData;
    state.source = "dtek";
    state.lastSuccessAt = Date.now();
    state.failCount = 0;
    state.tgNotice = null;
    console.log(
      `[DTEK] Обновлено напрямую с ДТЭК (${dtekData.fact.update}). Следующая проверка через 10 мин.`,
    );

    setTimeout(runScheduleCycle, TEN_MINUTES);
    return;
  } catch (dtekErr) {
    console.warn(`[DTEK] Прямой запрос не прошёл: ${dtekErr.message}`);
  }

  // 2. Если ДТЭК не ответил — страхуемся через GitHub
  try {
    const ghData = await fetchGithubFallback();
    const curMs = parseUpdateMs(state.data?.fact?.update);
    const ghMs = parseUpdateMs(ghData.fact?.update);

    if (!state.data || ghMs >= curMs) {
      state.data = ghData;
      state.source = "github";
    } else if (!state.data.preset && ghData.preset) {
      state.data.preset = ghData.preset;
    }

    state.lastSuccessAt = Date.now();
    state.failCount = 0;
    state.tgNotice = null;
    console.log(
      `[DTEK] Взят резерв с GitHub (${ghData.fact?.update}). Следующая проверка через 10 мин.`,
    );

    setTimeout(runScheduleCycle, TEN_MINUTES);
    return;
  } catch (ghErr) {
    state.failCount += 1;
    console.warn(
      `[DTEK] Сбой обоих источников (${state.failCount}/10): ${ghErr.message}`,
    );
  }

  // 3. Если легли оба — пробуем ещё до 10 раз, потом Telegram
  if (state.failCount < 10) {
    setTimeout(runScheduleCycle, ONE_MINUTE);
    return;
  }

  console.log("[DTEK] 10 попыток мимо. Делаем 1 запрос в Telegram...");
  try {
    const tgText = await fetchTelegramFallback();
    if (tgText) {
      state.source = "telegram";
      state.tgNotice = tgText;
      state.tgUpdatedAt = Date.now();
      console.log("[DTEK] Резерв из Telegram получен.");
    } else {
      console.warn("[DTEK] В Telegram свежих постов по Одессе нет.");
    }
  } catch (tgErr) {
    console.error(`[DTEK] Telegram недоступен: ${tgErr.message}`);
  }

  state.failCount = 0;
  console.log("[DTEK] Уходим в паузу на 1 час перед новой серией проверок.");
  setTimeout(runScheduleCycle, ONE_HOUR);
}

function startScheduleWorker() {
  if (workerStarted) return;
  workerStarted = true;
  runScheduleCycle();
}

function parseDayHours(hoursObj) {
  if (!hoursObj || typeof hoursObj !== "object") return null;
  const result = [];
  for (let h = 1; h <= 24; h++) {
    const startHour = String(h - 1).padStart(2, "0");
    const endHour = String(h).padStart(2, "0");
    result.push({
      hour: h,
      time: `${startHour}:00 - ${endHour}:00`,
      status: hoursObj[String(h)] || "unknown",
    });
  }
  return result;
}

// Получаем дату YYYY-MM-DD по киевскому времени для любого timestamp (в мс)
function getKyivDateStr(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function getScheduleResponse(groupInput = "1.1") {
  const isStale =
    !state.lastSuccessAt || Date.now() - state.lastSuccessAt > STALE_LIMIT;
  const group = GROUPS.includes(groupInput) ? groupInput : "1.1";
  const gpvKey = `GPV${group}`;

  let todaySchedule = null;
  let tomorrowSchedule = null;
  let weekSchedule = null;
  let dtekUpdatedAt = null;

  if (state.data) {
    const fact = state.data.fact;
    if (fact && fact.data && typeof fact.data === "object") {
      dtekUpdatedAt = fact.update || null;
      const timestamps = Object.keys(fact.data)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);

      const nowKyivDate = getKyivDateStr(Date.now());
      const matchedTodayTs = timestamps.find(
        (ts) => getKyivDateStr(ts * 1000) === nowKyivDate,
      );

      const todayTs = matchedTodayTs || Number(fact.today) || timestamps[0];
      const tomorrowTs = timestamps.find((ts) => ts > todayTs);

      if (todayTs && fact.data[String(todayTs)]?.[gpvKey]) {
        todaySchedule = parseDayHours(fact.data[String(todayTs)][gpvKey]);
      }
      if (tomorrowTs && fact.data[String(tomorrowTs)]?.[gpvKey]) {
        tomorrowSchedule = parseDayHours(fact.data[String(tomorrowTs)][gpvKey]);
      }
    }

    const preset = state.data.preset;
    if (preset && preset.data?.[gpvKey]) {
      weekSchedule = {};
      for (let d = 1; d <= 7; d++) {
        weekSchedule[d] = parseDayHours(preset.data[gpvKey][String(d)]);
      }
    }
  }

  return {
    region: "Одеська область",
    selectedGroup: group,
    groups: GROUPS,
    source: state.source,
    updatedAt: dtekUpdatedAt,
    dtekUpdatedAt,
    lastSuccessAt: state.lastSuccessAt
      ? new Date(state.lastSuccessAt).toISOString()
      : null,
    tgUpdatedAt: state.tgUpdatedAt
      ? new Date(state.tgUpdatedAt).toISOString()
      : null,
    isStale,
    warningMessage: isStale
      ? "Оновлень тимчасово немає з технічних причин"
      : null,
    tgNotice: state.tgNotice,
    today: todaySchedule,
    tomorrow: tomorrowSchedule,
    week: weekSchedule,
  };
}

module.exports = { startScheduleWorker, getScheduleResponse };
