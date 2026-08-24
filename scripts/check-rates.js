/**
 * Daily rate checker for the myPOS Savings Calculator.
 *
 * Fetches each provider's public pricing page, pulls out the headline
 * percentage, and updates rates.json.
 *
 * Providers that DON'T publish rates (Dojo, Worldpay, Barclaycard, Tyl)
 * are marked "manual" and left alone — they're bespoke-quoted, so there's
 * no number on a page to read.
 *
 * Safety rules:
 *  - a scraped rate is only accepted if it's between 0.1% and 5%
 *  - if a page fails or the number looks wrong, the OLD rate is kept
 *  - every provider records when it was last confirmed, so stale ones show up
 */

const fs = require("fs");
const path = require("path");

const RATES_FILE = path.join(__dirname, "..", "rates.json");

// Providers whose rates appear on a public page.
// `match` is a list of regexes tried in order against the page text.
const SCRAPEABLE = {
  "SumUp": {
    url: "https://www.sumup.com/en-gb/card-reader-pricing/",
    match: [/(\d\.\d{1,2})\s*%\s*(?:per|transaction|\+?\s*0p)/i, /(\d\.\d{1,2})\s*%/]
  },
  "Square": {
    url: "https://squareup.com/gb/en/pricing",
    match: [/(\d\.\d{1,2})\s*%\s*(?:per|for|\+)/i, /(\d\.\d{1,2})\s*%/]
  },
  "Zettle": {
    url: "https://www.zettle.com/gb/pricing",
    match: [/(\d\.\d{1,2})\s*%\s*(?:per|card|transaction)/i, /(\d\.\d{1,2})\s*%/]
  },
  "Stripe": {
    url: "https://stripe.com/gb/pricing",
    match: [/(\d\.\d{1,2})\s*%\s*\+\s*\d+p/i, /(\d\.\d{1,2})\s*%/]
  },
  "Revolut": {
    url: "https://www.revolut.com/business/card-machines/",
    match: [/(\d\.\d{1,2})\s*%\s*(?:per|transaction)/i, /(\d\.\d{1,2})\s*%/]
  }
};

// Sanity bounds — anything outside this is almost certainly not a card rate
const MIN_RATE = 0.1;
const MAX_RATE = 5.0;

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; rate-checker/1.0)",
      "Accept": "text/html"
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();
  // strip tags and scripts so we're matching visible-ish text
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function extractRate(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const val = parseFloat(m[1]);
      if (val >= MIN_RATE && val <= MAX_RATE) return val;
    }
  }
  return null;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(RATES_FILE, "utf8"));
  let changed = false;
  const log = [];

  for (const provider of data.providers) {
    const cfg = SCRAPEABLE[provider.name];

    if (!cfg) {
      provider.source = "manual";
      log.push(`  ${provider.name.padEnd(15)} manual — bespoke quoted, not published`);
      continue;
    }

    try {
      const text = await fetchText(cfg.url);
      const found = extractRate(text, cfg.match);

      if (found === null) {
        log.push(`  ${provider.name.padEnd(15)} NO MATCH — keeping ${provider.rate}% (page may have changed)`);
        continue;
      }

      provider.checked = today();
      provider.source = "auto";

      if (found !== provider.rate) {
        log.push(`  ${provider.name.padEnd(15)} CHANGED ${provider.rate}% -> ${found}%`);
        provider.rate = found;
        changed = true;
      } else {
        log.push(`  ${provider.name.padEnd(15)} confirmed ${found}%`);
        changed = true; // the checked date moved on
      }
    } catch (err) {
      log.push(`  ${provider.name.padEnd(15)} FETCH FAILED (${err.message}) — keeping ${provider.rate}%`);
    }

    await new Promise(r => setTimeout(r, 1500)); // be polite between requests
  }

  data.last_checked = today();

  console.log("\nRate check " + today());
  console.log(log.join("\n"));

  if (changed) {
    fs.writeFileSync(RATES_FILE, JSON.stringify(data, null, 2) + "\n");
    console.log("\nrates.json updated.\n");
  } else {
    // still bump the date so the app shows a fresh check
    fs.writeFileSync(RATES_FILE, JSON.stringify(data, null, 2) + "\n");
    console.log("\nNo rate changes; date stamp updated.\n");
  }
}

main().catch(err => {
  console.error("Rate check failed:", err);
  process.exit(1);
});
