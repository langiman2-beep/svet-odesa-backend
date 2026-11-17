require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { CITIES, getWeather } = require("./weather");
const { startScheduleWorker, getScheduleResponse } = require("./dtek");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

// Доверяем прокси (Cloudflare и CityHost), чтобы видеть реальные IP
app.set("trust proxy", 1);

// Базовая защита заголовков сервера
app.use(helmet());
app.use(cors());

// Хранилище банов: ip -> { until: timestamp, reason: string }
const banList = new Map();
const MAX_BAN_ENTRIES = 5000;

function addBan(ip, durationMs, reason) {
  if (banList.size >= MAX_BAN_ENTRIES) {
    const oldestKey = banList.keys().next().value;
    banList.delete(oldestKey);
  }
  banList.set(ip, { until: Date.now() + durationMs, reason });
}

// Автоочистка просроченных банов каждые 5 минут (чтобы память не пухла)
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, data] of banList.entries()) {
      if (now >= data.until) {
        banList.delete(ip);
      }
    }
  },
  5 * 60 * 1000,
).unref();

// 1. Охранник на входе: проверяем, не сидит ли IP уже в бане
app.use("/api/", (req, res, next) => {
  const record = banList.get(req.ip);
  if (record) {
    if (Date.now() < record.until) {
      return res.status(429).json({ error: record.reason });
    }
    banList.delete(req.ip);
  }
  next();
});

// 2. Барьер для наглых ботов: > 80 запросов за 10 минут -> бан на 3 часа
const botBanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 80,
  handler: (req, res) => {
    const msg = "Занадто активний робот. Доступ заблоковано на 3 години.";
    addBan(req.ip, 3 * 60 * 60 * 1000, msg);
    res.status(429).json({ error: msg });
  },
});

// 3. Барьер для торопыг: > 15 запросов за 1 минуту -> перекур на 10 минут
const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  handler: (req, res) => {
    const msg =
      "Нема чого так часто тикати оновлення. Перекуріть або попийте чаю 10 хвилин.";
    addBan(req.ip, 10 * 60 * 1000, msg);
    res.status(429).json({ error: msg });
  },
});

app.use("/api/", botBanLimiter);
app.use("/api/", userLimiter);

// 4. Пропуск по секретному ключу приложения
app.use("/api/", (req, res, next) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!API_KEY || clientKey !== API_KEY) {
    return res
      .status(401)
      .json({ error: "Доступ заборонено: невірний ключ API" });
  }
  next();
});

// Запускаем фоновый опрос графиков ДТЭК
startScheduleWorker();

app.get("/", (req, res) => {
  res.send("Сервер Світло Одеса працює!");
});

app.get("/api/cities", (req, res) => {
  const list = Object.entries(CITIES).map(([key, val]) => ({
    key,
    name: val.name,
  }));
  res.json(list);
});

app.get("/api/weather", async (req, res) => {
  try {
    const cityKey = String(req.query.city || "odesa").slice(0, 20);
    const data = await getWeather(cityKey);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Не вдалося завантажити погоду" });
  }
});

app.get("/api/schedule", (req, res) => {
  const group = String(req.query.group || "1.1").slice(0, 10);
  res.json(getScheduleResponse(group));
});

app.listen(PORT, () => {
  console.log(`Сервер запущено на порту/сокеті: ${PORT}`);
});
