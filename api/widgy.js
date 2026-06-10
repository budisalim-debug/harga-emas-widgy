const FALLBACK = {
  // Emergency fallback supaya Widgy tidak kosong kalau semua source sedang gagal.
  // Bapak bisa update angka ini kapan saja di GitHub kalau perlu.
  buyback_per_gram: 2576700,
  date: "2026-06-10",
  note: "fallback"
};

const SOURCES = [
  "https://www.logammulia.com/sell/gold",
  "https://www.logammulia.com/id/sell/gold",
  "https://harga-emas.org/",
  "https://harga-emas.org/history-harga"
];

function rupiah(value) {
  if (!Number.isFinite(value)) return "-";
  return "Rp" + Math.round(value).toLocaleString("id-ID");
}

function rupiahShort(value) {
  if (!Number.isFinite(value)) return "-";
  const juta = value / 1000000;
  return "Rp" + juta.toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " jt";
}

function jakartaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function jakartaTimeString(date = new Date()) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function parseNumber(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/Rp/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d.,]/g, "");

  if (!cleaned) return null;

  // Format Indonesia: 2.576.700 atau 2,576,700
  const normalized = cleaned
    .replace(/,/g, ".")
    .split(".")
    .filter(Boolean)
    .join("");

  const n = Number(normalized);
  return Number.isFinite(n) && n > 100000 ? n : null;
}

function uniqueNumbersNearBuyback(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const candidates = [];

  // Cari angka yang dekat dengan kata buyback / pembelian kembali / jual kembali.
  const patterns = [
    /(buyback|buy back|harga buyback|pembelian kembali|jual kembali|harga jual kembali)[\s\S]{0,250}?(Rp\s*)?([0-9][0-9\.\,]{5,})/gi,
    /(Rp\s*)?([0-9][0-9\.\,]{5,})[\s\S]{0,250}?(buyback|buy back|harga buyback|pembelian kembali|jual kembali|harga jual kembali)/gi
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const groups = Array.from(m).slice(1);
      for (const g of groups) {
        const n = parseNumber(g);
        if (n && n > 1000000 && n < 5000000) candidates.push(n);
      }
    }
  }

  // Fallback: ambil angka Rp besar yang realistis untuk buyback per gram.
  const allRp = text.match(/Rp\s*[0-9][0-9\.\,]{5,}/gi) || [];
  for (const raw of allRp) {
    const n = parseNumber(raw);
    if (n && n > 1000000 && n < 5000000) candidates.push(n);
  }

  return [...new Set(candidates)];
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; harga-emas-widgy/1.0)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "cache-control": "no-cache"
    },
    redirect: "follow"
  });

  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return await res.text();
}

async function getLiveBuyback() {
  const errors = [];

  // Manual override:
  // https://.../api/widgy?buyback=2576700
  // berguna kalau source online sedang berubah/blokir.
  // Akan tetap diformat untuk Widgy.
  // Ini tidak disimpan permanen.
  for (const url of SOURCES) {
    try {
      const html = await fetchText(url);
      const nums = uniqueNumbersNearBuyback(html);

      if (nums.length) {
        // Biasanya buyback adalah angka per gram sekitar 1-4 juta.
        // Pilih kandidat pertama dari bagian yang dekat dengan teks buyback.
        return {
          value: nums[0],
          source: url,
          candidates: nums.slice(0, 6)
        };
      }
      errors.push(`${url}: no candidate`);
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const now = new Date();
  const manual = parseNumber(req.query?.buyback || req.query?.bb || process.env.MANUAL_BUYBACK_PER_GRAM);

  let live = false;
  let buybackPerGram = manual;
  let source = manual ? "manual override" : null;
  let warning = null;
  let candidates = [];

  if (!buybackPerGram) {
    try {
      const liveData = await getLiveBuyback();
      buybackPerGram = liveData.value;
      source = liveData.source;
      candidates = liveData.candidates;
      live = true;
    } catch (err) {
      buybackPerGram = FALLBACK.buyback_per_gram;
      source = "fallback";
      warning = "Live source gagal dibaca, memakai fallback terakhir. Detail: " + err.message;
      live = false;
    }
  }

  const buyback100gr = buybackPerGram * 100;
  const payload = {
    ok: true,
    live,
    date: jakartaDateString(now),
    updated_jakarta: jakartaTimeString(now),
    source,
    warning,
    buyback_per_gram: buybackPerGram,
    buyback_100gr: buyback100gr,
    buyback_per_gram_text: rupiah(buybackPerGram),
    buyback_100gr_text: rupiah(buyback100gr),
    buyback_100gr_short: rupiahShort(buyback100gr),
    title: "ANTAM Buyback 100gr",
    subtitle: live ? "Live" : "Fallback",
    candidates
  };

  res.status(200).json(payload);
}
