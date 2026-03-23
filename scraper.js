const axios = require("axios");
const cheerio = require("cheerio");

/**
 * Scrape a URL and return clean, structured text for the AI.
 * Falls back gracefully — never throws, always returns something.
 */
async function scrapeWebsite(url) {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 5,
      headers: {
        // Pretend to be a real browser so sites don't block us
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Remove noise — scripts, styles, nav, footer, ads
    $("script, style, noscript, nav, footer, header, aside, iframe, [class*='cookie'], [class*='banner'], [id*='cookie'], [id*='banner']").remove();

    // Extract structured data
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      "";

    const metaDesc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    const ogSiteName = $('meta[property="og:site_name"]').attr("content") || "";

    // Headings — great signal for what a page is about
    const headings = [];
    $("h1, h2, h3").slice(0, 12).each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 2 && text.length < 200) headings.push(text);
    });

    // Hero / above-the-fold paragraphs
    const paragraphs = [];
    $("p, li").slice(0, 30).each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 30 && text.length < 400) paragraphs.push(text);
    });

    // CTA buttons — strong signal for what the site does
    const ctas = [];
    $("a, button").slice(0, 20).each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 2 && text.length < 60) ctas.push(text);
    });

    // Assemble clean context (stay under ~1800 chars for the prompt)
    const contextParts = [
      title       && `Title: ${title}`,
      ogSiteName  && `Site name: ${ogSiteName}`,
      metaDesc    && `Meta description: ${metaDesc}`,
      headings.length && `Headings:\n${headings.slice(0, 8).join("\n")}`,
      paragraphs.length && `Key text:\n${paragraphs.slice(0, 6).join("\n")}`,
      ctas.length && `Calls to action: ${[...new Set(ctas)].slice(0, 10).join(" | ")}`,
    ].filter(Boolean);

    return {
      ok: true,
      context: contextParts.join("\n\n").slice(0, 2000),
      title,
      metaDesc,
    };

  } catch (err) {
    // Common reasons: CORS on server (shouldn't happen), bot block, timeout
    return {
      ok: false,
      context: "",
      error: err.message,
    };
  }
}

module.exports = { scrapeWebsite };
