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

// Доверяем прокси (нужно для правильной работы через Cloudflare и хостинг)
app.set("trust proxy", 1);

// Базовая защита заголовков сервера
app.use(helmet());
app.use(cors());

// Защита от спама: максимум 30 запросов в минуту с одного реального IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Забагато запитів. Зачекайте хвилину." },
});
app.use("/api/", limiter);

// Проверка секретного ключа приложения для всех запросов к /api/
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
