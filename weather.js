// Справочник городов Одесской области
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

// Простой кэш в памяти
const weatherCache = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

async function getWeather(cityKey = "odesa") {
  const city = CITIES[cityKey] || CITIES.odesa;
  const key = CITIES[cityKey] ? cityKey : "odesa";

  if (
    weatherCache[key] &&
    Date.now() - weatherCache[key].timestamp < CACHE_TTL
  ) {
    return weatherCache[key].data;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&timezone=Europe%2FKyiv&forecast_days=7`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Помилка отримання погоди з Open-Meteo");
  }

  const raw = await response.json();
  const h = raw.hourly;

  const days = [];
  const targetHours = [
    { hour: "03:00", label: "Ніч" },
    { hour: "09:00", label: "Ранок" },
    { hour: "15:00", label: "День" },
    { hour: "21:00", label: "Вечір" },
  ];

  for (let d = 0; d < 7; d++) {
    const startIndex = d * 24;
    const dateStr = h.time[startIndex].split("T")[0];
    const periods = [];

    for (let i = startIndex; i < startIndex + 24; i++) {
      const timePart = h.time[i].split("T")[1];
      const match = targetHours.find((t) => t.hour === timePart);
      if (match) {
        periods.push({
          period: match.label,
          temp: Math.round(h.temperature_2m[i]),
          humidity: h.relative_humidity_2m[i],
          wind: Math.round(h.wind_speed_10m[i]),
          precipitation: h.precipitation[i],
        });
      }
    }

    days.push({ date: dateStr, periods });
  }

  const result = {
    city: city.name,
    cityKey: key,
    updatedAt: new Date().toISOString(),
    days,
  };

  weatherCache[key] = { timestamp: Date.now(), data: result };
  return result;
}

module.exports = { CITIES, getWeather };
