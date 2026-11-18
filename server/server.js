import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || null;
const baseURL = process.env.API_BASE_URL || undefined;
const client = apiKey
  ? new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  : null;

// ── News fetcher (GNews API) ──
async function fetchNews(topic) {
  const key = process.env.GNEWS_API_KEY;
  if (!key) return null;

  // topic="india" → country filter, topic="world"/"top" → global top headlines
  let url;
  if (!topic || topic === "world" || topic === "global" || topic === "top") {
    url = `https://gnews.io/api/v4/top-headlines?lang=en&max=5&apikey=${key}`;
  } else if (topic === "india") {
    url = `https://gnews.io/api/v4/top-headlines?country=in&lang=en&max=5&apikey=${key}`;
  } else {
    url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(topic)}&lang=en&max=5&sortby=publishedAt&apikey=${key}`;
  }

  const res = await fetch(url);
  const data = await res.json();
  if (!data.articles?.length) return null;

  return data.articles.map((a, i) => `${i + 1}. ${a.title} (${a.source.name})`).join("\n");
}

// ── Detect news intent ──
function extractNewsTopic(msg) {
  const m = msg.toLowerCase();
  if (/news.*india|india.*news/.test(m)) return "india";
  if (/news.*world|world.*news|global.*news|international.*news/.test(m)) return "world";
  if (/news today|today.*news|latest news|top news|headlines|what.*news/.test(m)) return "india"; // default to India
  return null;
}

// ── City alias map (common names → geocoder-friendly names) ──
const CITY_ALIASES = {
  bangalore: "bengaluru", bombay: "mumbai", calcutta: "kolkata",
  madras: "chennai", poona: "pune", baroda: "vadodara",
  "new delhi": "delhi", mysore: "mysuru", mangalore: "mangaluru",
};

// ── Real-time weather fetcher (Open-Meteo + geocoding, no API key needed) ──
async function fetchWeather(rawCity) {
  const city = CITY_ALIASES[rawCity.toLowerCase()] || rawCity;

  // 1. Geocode city → lat/lon (fetch top 5, prefer India)
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=en&format=json`
  );
  const geoData = await geoRes.json();
  if (!geoData.results?.length) return null;
  // prefer India result
  const place = geoData.results.find(r => r.country_code === "IN") || geoData.results[0];
  if (!place) return null;

  const { latitude, longitude, name, country } = place;

  // 2. Fetch current weather
  const wxRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weathercode` +
    `&wind_speed_unit=kmh&temperature_unit=celsius&timezone=auto`
  );
  const wxData = await wxRes.json();
  const c = wxData.current;
  if (!c) return null;

  // WMO weather code → plain description
  const codeMap = {
    0:"clear sky", 1:"mainly clear", 2:"partly cloudy", 3:"overcast",
    45:"foggy", 48:"icy fog",
    51:"light drizzle", 53:"moderate drizzle", 55:"heavy drizzle",
    61:"light rain", 63:"moderate rain", 65:"heavy rain",
    71:"light snow", 73:"moderate snow", 75:"heavy snow",
    80:"light showers", 81:"moderate showers", 82:"heavy showers",
    95:"thunderstorm", 96:"thunderstorm with hail", 99:"thunderstorm with heavy hail"
  };
  const desc = codeMap[c.weathercode] ?? "unknown conditions";

  return {
    city: name, country,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    humidity: c.relative_humidity_2m,
    wind: Math.round(c.wind_speed_10m),
    desc
  };
}

// ── Detect if the message is asking about weather ──
function extractWeatherCity(msg) {
  const m = msg.match(
    /weather\s+(?:in|at|for|of)\s+([a-z\s]+)|(?:in|at)\s+([a-z\s]+)\s+weather|how(?:'s|\s+is)\s+(?:the\s+)?weather\s+(?:in|at|of)\s+([a-z\s]+)/i
  );
  if (m) return (m[1] || m[2] || m[3]).trim();

  // "weather bangalore" / "bangalore weather"
  const m2 = msg.match(/weather\s+([a-z\s]{2,30})|([a-z\s]{2,30})\s+weather/i);
  if (m2) return (m2[1] || m2[2]).trim();

  return null;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "MIRAI" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    const lang = String(req.body?.lang || "en-IN");
    if (!message) return res.status(400).json({ error: "Please enter a message." });
    if (!client) return res.status(503).json({ error: "Add your API key to the .env file, then restart the server." });

    const cleanHistory = history.filter(
      item => ["user", "assistant"].includes(item.role) && typeof item.content === "string"
    );

    // ── Inject real-time data if relevant ──
    let systemExtra = "";

    const weatherCity = extractWeatherCity(message);
    if (weatherCity) {
      try {
        const wx = await fetchWeather(weatherCity);
        if (wx) {
          systemExtra += `\n\nREAL-TIME WEATHER DATA (state this directly as fact — never suggest checking websites):\n` +
            `Location: ${wx.city}, ${wx.country}\n` +
            `Condition: ${wx.desc}\n` +
            `Temperature: ${wx.temp}°C (feels like ${wx.feels}°C)\n` +
            `Humidity: ${wx.humidity}%\n` +
            `Wind: ${wx.wind} km/h`;
        }
      } catch (e) {
        console.error("Weather fetch error:", e.message);
      }
    }

    const newsTopic = extractNewsTopic(message);
    if (newsTopic) {
      try {
        const headlines = await fetchNews(newsTopic);
        if (headlines) {
          const label = newsTopic === "india" ? "INDIA" : "WORLD";
          systemExtra += `\n\nREAL-TIME ${label} NEWS HEADLINES (read these out naturally as today's top stories — do not suggest any website):\n${headlines}`;
        }
      } catch (e) {
        console.error("News fetch error:", e.message);
      }
    }

    const langInstruction = lang && lang !== "en-IN" && lang !== "en-US" && lang !== "en-GB"
      ? ` Always respond in the language matching locale code "${lang}".`
      : "";

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: `You are MIRAI, a friendly personal robot companion. You are warm, curious, witty when appropriate, clear, and honest. Keep spoken answers concise and natural — 1 to 3 sentences max. When you have real-time data provided to you, state it directly as fact. Never tell the user to check a website or app. If anyone asks who created you, who made you, or who built you, always answer: "I was created by IFIM College." Do not say anything else about your creator.${langInstruction}${systemExtra}`
        },
        ...cleanHistory,
        { role: "user", content: message }
      ],
      max_tokens: 400
    });

    const reply = response.choices?.[0]?.message?.content?.trim()
      || "I couldn't form a reply. Try asking me again.";
    res.json({ reply });
  } catch (error) {
    console.error("AI error:", error);
    res.status(500).json({ error: "MIRAI had trouble reaching its AI brain. Check the API key and try again." });
  }
});

const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"), err => {
    if (err) res.status(404).send("Build the frontend first with npm run build.");
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MIRAI backend running at http://localhost:${PORT}`);
});
