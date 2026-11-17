const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { CITIES, getWeather } = require("./weather");
const { startScheduleWorker, getScheduleResponse } = require("./dtek");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Защита от спама: максимум 30 запросов в минуту с одного IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Забагато запитів. Зачекайте хвилину." },
});
app.use("/api/", limiter);

// Запускаем фоновый опрос графиков ДТЭК при старте сервера
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
    const cityKey = req.query.city || "odesa";
    const data = await getWeather(cityKey);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Не вдалося завантажити погоду" });
  }
});

app.get("/api/schedule", (req, res) => {
  const group = req.query.group || "1.1";
  res.json(getScheduleResponse(group));
});

app.listen(PORT, () => {
  console.log(`Сервер запущено на порту/сокеті: ${PORT}`);
});
