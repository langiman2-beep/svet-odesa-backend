const PRIMARY_URL =
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
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const STALE_LIMIT = 3 * 60 * 60 * 1000; // 3 часа без обновлений -> тревога в телефон

let state = {
  data: null,
  source: "none", // 'github' | 'telegram' | 'none'
  lastSuccessAt: null,
  failCount: 0,
  tgNotice: null,
};

// 1 контрольный запрос в Telegram
async function fetchTelegramFallback() {
  const res = await fetch(FALLBACK_TG_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
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
      m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((text) => /одес/i.test(text));

  return recentPosts.length > 0 ? recentPosts[recentPosts.length - 1] : null;
}

// Умный цикл опроса с паузой в 1 час при полном отказе
async function runScheduleCycle() {
  try {
    const res = await fetch(PRIMARY_URL);
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);

    const rawJson = await res.json();

    // Всё ок — сохраняем, сбрасываем счётчик и ждём штатные 15 минут
    state.data = rawJson;
    state.source = "github";
    state.lastSuccessAt = Date.now();
    state.failCount = 0;
    state.tgNotice = null;
    console.log(
      "[DTEK] График обновлён (GitHub). Следующая проверка через 15 мин.",
    );

    setTimeout(runScheduleCycle, FIFTEEN_MINUTES);
  } catch (err) {
    state.failCount += 1;
    console.warn(`[DTEK] Сбой GitHub (${state.failCount}/10): ${err.message}`);

    // Если ещё не исчерпали 10 попыток — пробуем снова через 1 минуту
    if (state.failCount < 10) {
      setTimeout(runScheduleCycle, ONE_MINUTE);
      return;
    }

    // 10 попыток провалились -> делаем 1 запрос в Telegram
    console.log("[DTEK] 10 попыток мимо. Делаем 1 запрос в Telegram...");
    try {
      const tgText = await fetchTelegramFallback();
      if (tgText) {
        state.source = "telegram";
        state.tgNotice = tgText;
        state.lastSuccessAt = Date.now();
        console.log("[DTEK] Резерв из Telegram получен.");
      } else {
        console.warn("[DTEK] В Telegram свежих постов по Одессе нет.");
      }
    } catch (tgErr) {
      console.error(`[DTEK] Telegram недоступен: ${tgErr.message}`);
    }

    // Сбрасываем счётчик серии и уходим в спячку на 1 час перед новым циклом
    state.failCount = 0;
    console.log("[DTEK] Уходим в паузу на 1 час перед новой серией проверок.");
    setTimeout(runScheduleCycle, ONE_HOUR);
  }
}

function startScheduleWorker() {
  runScheduleCycle();
}

// Превращаем сырой объект часов {"1": "yes", "2": "no"...} в удобный массив
function parseDayHours(hoursObj) {
  if (!hoursObj) return null;
  const result = [];
  for (let h = 1; h <= 24; h++) {
    const startHour = String(h - 1).padStart(2, "0");
    const endHour = String(h).padStart(2, "0");
    result.push({
      hour: h,
      time: `${startHour}:00 - ${endHour}:00`,
      status: hoursObj[String(h)] || "unknown", // 'no' | 'yes' | 'first' | 'second' | 'maybe'
    });
  }
  return result;
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
    // 1. Разбираем фактические графики (сегодня и завтра)
    const fact = state.data.fact;
    if (fact && fact.data) {
      dtekUpdatedAt = fact.update || null;
      const timestamps = Object.keys(fact.data)
        .map(Number)
        .sort((a, b) => a - b);
      const todayTs = fact.today || timestamps[0];
      const tomorrowTs = timestamps.find((ts) => ts > todayTs);

      if (todayTs && fact.data[todayTs]?.[gpvKey]) {
        todaySchedule = parseDayHours(fact.data[todayTs][gpvKey]);
      }
      if (tomorrowTs && fact.data[tomorrowTs]?.[gpvKey]) {
        tomorrowSchedule = parseDayHours(fact.data[tomorrowTs][gpvKey]);
      }
    }

    // 2. Разбираем плановый график на неделю (1..7)
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
    dtekUpdatedAt,
    lastSuccessAt: state.lastSuccessAt
      ? new Date(state.lastSuccessAt).toISOString()
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
