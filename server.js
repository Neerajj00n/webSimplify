require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const rateLimit = require("express-rate-limit");
const Groq      = require("groq-sdk");
const { scrapeWebsite } = require("./scraper");

const app  = express();
const PORT = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json({ limit: "20kb" }));
app.use(cors()); // open — allow all origins including chrome-extension://

// Request logger — shows in Render logs
app.use((req, res, next) => {
  console.log(`→ ${req.method} ${req.path} | url=${req.body?.url || "-"}`);
  next();
});

app.use("/decode", rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests — wait a few minutes." },
}));

app.get("/",       (req, res) => res.json({ status: "ok", model: "llama3-8b-8192" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/decode", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  let domain = "";
  try { domain = new URL(url).hostname.replace(/^www\./, ""); }
  catch { return res.status(400).json({ error: "Invalid URL" }); }

  console.log(`Scraping: ${url}`);
  const scraped = await scrapeWebsite(url);
  console.log(`Scrape: ok=${scraped.ok} chars=${scraped.context?.length ?? 0}`);

  const context = scraped.ok && scraped.context
    ? scraped.context
    : `URL: ${url}\nDomain: ${domain}\n(Could not scrape — use your knowledge of this domain.)`;

  const prompt = `You are a website analyst. Analyse this website based on the content below.

URL: ${url}
Domain: ${domain}

--- SCRAPED CONTENT ---
${context}
--- END ---

Return ONLY a valid JSON object. No markdown, no backticks, no extra text whatsoever.

{
  "name": "Official product or website name",
  "category": "One short label e.g. Design Tool | Dev Platform | E-commerce | SaaS | AI Tool | Education",
  "summary": "2-3 plain-English sentences. What does it do? Who is it for? Why use it?",
  "useCases": [
    {"title": "Short title", "description": "One sentence."},
    {"title": "Short title", "description": "One sentence."},
    {"title": "Short title", "description": "One sentence."}
  ],
  "similar": [
    {"name": "Name", "url": "https://...", "description": "One sentence."},
    {"name": "Name", "url": "https://...", "description": "One sentence."},
    {"name": "Name", "url": "https://...", "description": "One sentence."},
    {"name": "Name", "url": "https://...", "description": "One sentence."}
  ]
}`;

  try {
    console.log("Calling Groq...");
    const chat = await groq.chat.completions.create({
      model: "llama3-8b-8192",
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: "system", content: "You are a website analyst. Always respond with valid raw JSON only — no markdown, no code blocks, no explanation." },
        { role: "user", content: prompt },
      ],
    });

    const raw = chat.choices[0]?.message?.content || "";
    console.log("Groq response length:", raw.length);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON in response:", raw.slice(0, 200));
      throw new Error("Model returned no JSON");
    }

    const data = JSON.parse(jsonMatch[0]);
    console.log(`✓ Done: ${data.name}`);
    return res.json({ ok: true, data, scraped: scraped.ok });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: "Analysis failed. Try again.", detail: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`✅  Running on port ${PORT}`);
  console.log(`    GROQ_API_KEY set: ${!!process.env.GROQ_API_KEY}`);
});
