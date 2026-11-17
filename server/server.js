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

// Supports Groq (free) or any OpenAI-compatible provider.
// GROQ_API_KEY takes priority; falls back to OPENAI_API_KEY for compatibility.
const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || null;
const baseURL = process.env.API_BASE_URL || undefined;

const client = apiKey
  ? new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
  : null;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "VEYRA" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    if (!message) return res.status(400).json({ error: "Please enter a message." });
    if (!client) return res.status(503).json({ error: "Add your API key to the .env file, then restart the server." });

    const cleanHistory = history.filter(
      item => ["user", "assistant"].includes(item.role) && typeof item.content === "string"
    );

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are VEYRA, a friendly personal robot companion. You are warm, curious, witty when appropriate, clear, and honest. Keep spoken answers concise and natural. Do not claim to see, hear, or do things unless the app actually provides that ability. If unsure, say so."
        },
        ...cleanHistory,
        { role: "user", content: message }
      ],
      max_tokens: 300
    });

    const reply = response.choices?.[0]?.message?.content?.trim()
      || "I couldn't form a reply. Try asking me again.";
    res.json({ reply });
  } catch (error) {
    console.error("AI error:", error);
    res.status(500).json({ error: "VEYRA had trouble reaching its AI brain. Check the API key and try again." });
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
  console.log(`VEYRA backend running at http://localhost:${PORT}`);
});