require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { CITIES, getWeather } = require("./weather");
const { startScheduleWorker, getScheduleResponse } = require("./dtek");

const app = express();
const PORT = process.env.PORT || 3000;

// Доверяем прокси-цепочке (Cloudflare + внутренний Nginx CityHost)
app.set("trust proxy", true);

function getClientIp(req) {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim();
  }
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

app.use(helmet());
app.use(cors());

// Хранилище банов: ip -> { until: timestamp, reason: string }
const banList = new Map();
const MAX_BAN_ENTRIES = 5000;

function addBan(ip, durationMs, reason) {
  if (!ip || ip === "unknown") return;
  if (banList.size >= MAX_BAN_ENTRIES && !banList.has(ip)) {
    const oldestKey = banList.keys().next().value;
    banList.delete(oldestKey);
  }
  banList.set(ip, { until: Date.now() + durationMs, reason });
}

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

// 1. Проверяем, не сидит ли IP уже в бане
app.use("/api/", (req, res, next) => {
  const clientIp = getClientIp(req);
  const record = banList.get(clientIp);
  if (record) {
    if (Date.now() < record.until) {
      return res.status(429).json({ error: record.reason });
    }
    banList.delete(clientIp);
  }
  next();
});

// 2. Жёсткий барьер от DDoS: > 400 запросов за 10 минут -> бан на 1 час
const botBanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 400,
  keyGenerator: (req) => getClientIp(req),
  validate: false,
  handler: (req, res) => {
    const msg =
      "Занадто висока активність з вашої мережі. Тимчасове обмеження на 1 годину.";
    addBan(getClientIp(req), 60 * 60 * 1000, msg);
    res.status(429).json({ error: msg });
  },
});

// 3. Мягкий лимит: 90 запросов в минуту без длительного бана
const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  keyGenerator: (req) => getClientIp(req),
  validate: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Забагато запитів за хвилину. Зачекайте трохи та спробуйте знову.",
    });
  },
});

app.use("/api/", botBanLimiter);
app.use("/api/", userLimiter);

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
    const rawCity =
      typeof req.query.city === "string" ? req.query.city : "odesa";
    const cityKey = rawCity.slice(0, 20);
    const data = await getWeather(cityKey);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Не вдалося завантажити погоду" });
  }
});

app.get("/api/schedule", (req, res) => {
  const rawGroup =
    typeof req.query.group === "string" ? req.query.group : "1.1";
  const group = rawGroup.slice(0, 10);
  res.json(getScheduleResponse(group));
});

// Когда выкладываешь новый APK на сервер, просто меняй тут version и buildNumber
app.get("/api/version", (req, res) => {
  res.json({
    version: "1.0.1",
    buildNumber: 2,
    downloadUrl: "https://downloads.odesa.org.ua/svet-odesa.apk",
    notes:
      "Виправлено завантаження графіків і погоди, додано автооновлення за номером збірки.",
  });
});

app.listen(PORT, () => {
  console.log(`Сервер запущено на порту/сокеті: ${PORT}`);
});
