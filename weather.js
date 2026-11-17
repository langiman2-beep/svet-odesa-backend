const CITIES = {
  odesa: { name: "Одеса", lat: 46.4825, lon: 30.7233 },
  chornomorsk: { name: "Чорноморськ", lat: 46.3017, lon: 30.6569 },
  izmail: { name: "Ізмаїл", lat: 45.3493, lon: 28.8364 },
  bilhorod: { name: "Білгород-Дністровський", lat: 46.1932, lon: 30.3435 },
  podilsk: { name: "Подільськ", lat: 47.7419, lon: 29.535 },
  yuzhne: { name: "Південне", lat: 46.6236, lon: 31.1014 },
  balta: { name: "Балта", lat: 47.9344, lon: 29.6214 },
  rozdilna: { name: "Роздільна", lat: 46.8469, lon: 30.0758 },
  artsyz: { name: "Арциз", lat: 45.9936, lon: 29.4319 },
  bolhrad: { name: "Болград", lat: 45.6769, lon: 28.6131 },
  kiliya: { name: "Кілія", lat: 45.455, lon: 29.2636 },
  reni: { name: "Рені", lat: 45.4575, lon: 28.2711 },
  bilyayivka: { name: "Біляївка", lat: 46.4819, lon: 30.2014 },
  ovidiopol: { name: "Овідіополь", lat: 46.245, lon: 30.4383 },
  teplodar: { name: "Теплодар", lat: 46.5036, lon: 30.3244 },
  berezivka: { name: "Березівка", lat: 47.2025, lon: 30.9169 },
  tatarbunary: { name: "Татарбунари", lat: 45.8458, lon: 29.6136 },
  ananyiv: { name: "Ананьїв", lat: 47.7219, lon: 29.9631 },
  kodyma: { name: "Кодима", lat: 48.0933, lon: 29.1244 },
  lyubashivka: { name: "Любашівка", lat: 47.8383, lon: 30.2586 },
  sarata: { name: "Сарата", lat: 46.0197, lon: 29.665 },
  tarutyne: { name: "Тарутине", lat: 46.1886, lon: 29.1469 },
};

const weatherCache = {};
const inFlightRequests = {}; // Защита от одновременных дублирующих запросов
const CACHE_TTL = 30 * 60 * 1000; // 30 минут
const FETCH_TIMEOUT = 8 * 1000; // 8 секунд таймаут

async function getWeather(cityKey = "odesa") {
  const key = Object.prototype.hasOwnProperty.call(CITIES, cityKey)
    ? cityKey
    : "odesa";
  const city = CITIES[key];

  const cached = weatherCache[key];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Если запрос по этому городу уже летит в Open-Meteo — ждём его, а не плодим новый
  if (inFlightRequests[key]) {
    return inFlightRequests[key];
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&timezone=Europe%2FKyiv&forecast_days=7`;

  inFlightRequests[key] = (async () => {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP ${response.status}`);
      }

      const raw = await response.json();
      const h = raw?.hourly;
      if (!h || !Array.isArray(h.time) || h.time.length < 24) {
        throw new Error("Некорректный формат данных от Open-Meteo");
      }

      const days = [];
      const targetHours = [
        { hour: "03:00", label: "Ніч" },
        { hour: "09:00", label: "Ранок" },
        { hour: "15:00", label: "День" },
        { hour: "21:00", label: "Вечір" },
      ];

      const totalDays = Math.min(7, Math.floor(h.time.length / 24));

      for (let d = 0; d < totalDays; d++) {
        const startIndex = d * 24;
        const dateStr = String(h.time[startIndex] || "").split("T")[0];
        const periods = [];

        for (let i = startIndex; i < startIndex + 24; i++) {
          const timePart = String(h.time[i] || "").split("T")[1];
          const match = targetHours.find((t) => t.hour === timePart);
          if (match) {
            periods.push({
              period: match.label,
              temp: Math.round(Number(h.temperature_2m?.[i] ?? 0)),
              humidity: Number(h.relative_humidity_2m?.[i] ?? 0),
              wind: Math.round(Number(h.wind_speed_10m?.[i] ?? 0)),
              precipitation: Number(h.precipitation?.[i] ?? 0),
            });
          }
        }

        days.push({ date: dateStr, periods });
      }

      const result = {
        city: city.name,
        cityKey: key,
        updatedAt: new Date().toISOString(),
        isStaleCache: false,
        days,
      };

      weatherCache[key] = { timestamp: Date.now(), data: result };
      return result;
    } catch (err) {
      // Если Open-Meteo лёг, но в памяти есть старый кэш — отдаём его вместо ошибки 500
      if (cached && cached.data) {
        return { ...cached.data, isStaleCache: true };
      }
      throw err;
    } finally {
      delete inFlightRequests[key];
    }
  })();

  return inFlightRequests[key];
}

module.exports = { CITIES, getWeather };
