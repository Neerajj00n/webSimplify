require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const rateLimit = require("express-rate-limit");
const Groq    = require("groq-sdk");
const { scrapeWebsite } = require("./scraper");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Groq client (free — get key at console.groq.com) ─────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "20kb" }));

app.use(cors({
  origin: (origin, cb) => {
    // Allow Chrome extensions and localhost (for testing)
    if (!origin || origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost")) {
      cb(null, true);
    } else {
      cb(new Error("CORS blocked"));
    }
  },
}));

// 30 decodes per IP per 15 min — generous for free tier
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a few minutes." },
});
app.use("/decode", limiter);

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "ok", model: "llama3-8b-8192" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── /decode ───────────────────────────────────────────────────────────────────
app.post("/decode", async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: "url is required" });

  let domain = "";
  try {
    const parsed = new URL(url);
    domain = parsed.hostname.replace(/^www\./, "");
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  // ── Step 1: Scrape ──────────────────────────────────────────────────────────
  const scraped = await scrapeWebsite(url);

  // Build context for the AI — even if scrape failed, we still have the URL
  const context = scraped.ok && scraped.context
    ? scraped.context
    : `URL: ${url}\nDomain: ${domain}\n(Page could not be scraped — use your knowledge of this domain to analyse it.)`;

  // ── Step 2: Ask Groq Llama 3 ───────────────────────────────────────────────
  const prompt = `You are a website analyst. Based on the scraped content below, analyse this website.

URL: ${url}
Domain: ${domain}

--- SCRAPED CONTENT ---
${context}
--- END ---

Return ONLY a valid JSON object. No markdown, no backticks, no explanation. Just the raw JSON.

{
  "name": "Official product or website name (infer from title/domain if needed)",
  "category": "One short label, e.g.: Design Tool | Dev Platform | E-commerce | SaaS | News | Social | Productivity | AI Tool | Education | Finance",
  "summary": "2-3 clear plain-English sentences. What does this website do? Who is it for? Why would someone use it? No jargon.",
  "useCases": [
    {"title": "Short title (3-5 words)", "description": "One sentence describing this use case."},
    {"title": "Short title (3-5 words)", "description": "One sentence describing this use case."},
    {"title": "Short title (3-5 words)", "description": "One sentence describing this use case."}
  ],
  "similar": [
    {"name": "Competitor name", "url": "https://...", "description": "One sentence on how it compares."},
    {"name": "Competitor name", "url": "https://...", "description": "One sentence on how it compares."},
    {"name": "Competitor name", "url": "https://...", "description": "One sentence on how it compares."},
    {"name": "Competitor name", "url": "https://...", "description": "One sentence on how it compares."}
  ]
}`;

  try {
    const chat = await groq.chat.completions.create({
      model: "llama3-8b-8192",   // free, fast — upgrade to llama3-70b for better quality
      max_tokens: 1024,
      temperature: 0.3,          // lower = more consistent JSON
      messages: [
        {
          role: "system",
          content: "You are a precise website analyst. You always respond with valid JSON only — never with markdown or extra text.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = chat.choices[0]?.message?.content || "";

    // Extract JSON — Llama sometimes wraps in ```json ``` anyway
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Model returned no JSON block");

    const data = JSON.parse(jsonMatch[0]);
    return res.json({ ok: true, data, scraped: scraped.ok });

  } catch (err) {
    console.error("Groq/parse error:", err.message);
    return res.status(500).json({
      error: "Failed to analyse website. Please try again.",
    });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Website Decoder running on port ${PORT}`);
  console.log(`    Model : llama3-8b-8192 (Groq free tier)`);
  console.log(`    Scraper: axios + cheerio`);
});
