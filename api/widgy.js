const FALLBACK_BUYBACK_PER_GRAM = 2576700;

function rupiah(value) {
  if (!Number.isFinite(value)) return "-";
  return "Rp" + Math.round(value).toLocaleString("id-ID");
}

function rupiahShort(value) {
  if (!Number.isFinite(value)) return "-";
  const juta = value / 1000000;
  return "Rp" + juta.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " jt";
}

function dateJakarta(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function updatedJakarta(date = new Date()) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function parseNumber(input) {
  if (!input) return null;
  const raw = String(input);
  const cleaned = raw
    .replace(/Rp/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,]/g, "");

  if (!cleaned) return null;

  // Indonesian number: 2.576.700
  const n = Number(cleaned.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractBuyback(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const candidates = [];

  const patterns = [
    /(buyback|buy back|harga buyback|pembelian kembali|jual kembali|harga jual kembali)[\s\S]{0,300}?(Rp\s*)?([0-9][0-9.,]{5,})/gi,
    /(Rp\s*)?([0-9][0-9.,]{5,})[\s\S]{0,300}?(buyback|buy back|harga buyback|pembelian kembali|jual kembali|harga jual kembali)/gi
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      for (const part of m) {
        const n = parseNumber(part);
        if (n && n >= 1000000 && n <= 5000000) candidates.push(n);
      }
    }
  }

  const rpMatches = text.match(/Rp\s*[0-9][0-9.,]{5,}/gi) || [];
  for (const m of rpMatches) {
    const n = parseNumber(m);
    if (n && n >= 1000000 && n <= 5000000) candidates.push(n);
  }

  return [...new Set(candidates)];
}

async function tryFetch(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 AppleWebKit/605.1.15 Safari/605.1.15",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return await res.text();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");

  const now = new Date();
  let buybackPerGram = parseNumber(req.query?.buyback || process.env.MANUAL_BUYBACK_PER_GRAM);
  let source = buybackPerGram ? "manual" : "fallback";
  let live = Boolean(buybackPerGram);
  let warning = null;
  let candidates = [];

  if (!buybackPerGram) {
    const urls = [
      "https://www.logammulia.com/sell/gold",
      "https://www.logammulia.com/id/sell/gold",
      "https://harga-emas.org/",
      "https://harga-emas.org/history-harga"
    ];
    const errors = [];
    for (const url of urls) {
      try {
        const html = await tryFetch(url);
        const found = extractBuyback(html);
        if (found.length) {
          buybackPerGram = found[0];
          candidates = found.slice(0, 8);
          source = url;
          live = true;
          break;
        }
        errors.push(`${url}: no candidate`);
      } catch (err) {
        errors.push(`${url}: ${err.message}`);
      }
    }
    if (!buybackPerGram) {
      buybackPerGram = FALLBACK_BUYBACK_PER_GRAM;
      source = "fallback";
      live = false;
      warning = errors.join(" | ");
    }
  }

  const buyback100gr = buybackPerGram * 100;

  res.status(200).json({
    ok: true,
    live,
    source,
    warning,
    date: dateJakarta(now),
    updated_jakarta: updatedJakarta(now),
    buyback_per_gram: buybackPerGram,
    buyback_100gr: buyback100gr,
    buyback_per_gram_text: rupiah(buybackPerGram),
    buyback_100gr_text: rupiah(buyback100gr),
    buyback_100gr_short: rupiahShort(buyback100gr),
    title: "ANTAM Buyback 100gr",
    subtitle: live ? "Live" : "Fallback",
    candidates
  });
}
