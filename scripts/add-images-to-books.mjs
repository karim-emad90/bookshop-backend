import "dotenv/config";
import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";

const STRAPI_URL = process.env.STRAPI_URL || "http://127.0.0.1:1337"; // ✅ better than localhost on Windows
const TOKEN = process.env.STRAPI_TOKEN;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;

if (!TOKEN || !UNSPLASH_KEY) {
  console.error("❌ Missing STRAPI_TOKEN or UNSPLASH_KEY in scripts/.env");
  process.exit(1);
}

const api = axios.create({
  baseURL: `${STRAPI_URL}/api`,
  headers: { Authorization: `Bearer ${TOKEN}` },
  timeout: 30000,
});

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ✅ أنت متأكد إن ده Media single
const COVER_FIELD = "coverImageUrl";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, { retries = 5, baseDelay = 900 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      const retryable = status === 429 || (status >= 500 && status <= 599) || !status;
      if (!retryable || i === retries) break;

      const wait = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 250);
      console.warn(`⏳ Retry #${i + 1} after ${wait}ms (status=${status ?? "N/A"})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function healthCheck() {
  try {
    await api.get("/books", { params: { "pagination[page]": 1, "pagination[pageSize]": 1 } });
    console.log("✅ Strapi reachable");
  } catch (e) {
    const status = e?.response?.status;
    const msg = e?.message || "Unknown";
    console.error("❌ Cannot reach Strapi:", { STRAPI_URL, status, msg });
    console.error("👉 جرّب: افتح http://127.0.0.1:1337/admin أو غيّر STRAPI_URL للـ port الصح.");
    process.exit(1);
  }
}

function categoryFromSlug(slug = "") {
  const idx = slug.indexOf("-book-");
  return idx === -1 ? "books" : slug.slice(0, idx);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function fetchUnsplashImageUrl(query) {
  const res = await withRetry(
    () =>
      axios.get("https://api.unsplash.com/photos/random", {
        params: { query, orientation: "portrait", content_filter: "high" },
        headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
        timeout: 15000,
      }),
    { retries: 5, baseDelay: 900 }
  );

  return res.data?.urls?.regular || res.data?.urls?.small || null;
}

async function download(url, filename) {
  const filePath = path.join(TMP_DIR, filename);

  const response = await withRetry(
    () => axios.get(url, { responseType: "stream", timeout: 20000 }),
    { retries: 4, baseDelay: 700 }
  );

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return filePath;
}

// ✅ Upload file only
async function uploadFileOnly(filePath) {
  const form = new FormData();
  form.append("files", fs.createReadStream(filePath));

  const res = await withRetry(
    () =>
      axios.post(`${STRAPI_URL}/api/upload`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${TOKEN}` },
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    { retries: 4, baseDelay: 900 }
  );

  const uploaded = res.data?.[0];
  if (!uploaded?.id) throw new Error("Upload succeeded but no file id returned.");
  return uploaded.id;
}

// ✅ Link media by updating the entry
async function attachFileToBookByUpdate(bookDocumentId, fileId) {
  await withRetry(
    () =>
      api.put(`/books/${bookDocumentId}`, {
        data: {
          [COVER_FIELD]: fileId, // ✅ single media -> file id
        },
      }),
    { retries: 4, baseDelay: 900 }
  );
}

async function getAllBooks(pageSize = 100) {
  const all = [];
  let page = 1;

  while (true) {
    const res = await api.get("/books", {
      params: {
        "pagination[page]": page,
        "pagination[pageSize]": pageSize,
        // نجيب الحقل عشان نعرف لو موجود
        [`populate[${COVER_FIELD}]`]: true,
      },
    });

    const data = res.data?.data || [];
    all.push(...data);

    const meta = res.data?.meta?.pagination;
    if (!meta || page >= meta.pageCount) break;
    page++;
  }

  return all;
}

function hasCover(attrs) {
  const v = attrs?.[COVER_FIELD];
  // بعض الحالات بتكون null بدل {data:null}
  if (!v) return false;
  if (typeof v === "object" && "data" in v) return !!v.data;
  // لو رجّع ID مباشرة (نادرًا) اعتبره موجود
  if (typeof v === "number") return true;
  return false;
}

async function run() {
  await healthCheck();

  const books = await getAllBooks(100);
  console.log(`📚 Found books: ${books.length}`);

  // group by category from slug
  const byCat = new Map();
  for (const b of books) {
    const attrs = b.attributes || b;
    const slug = attrs.slug || "";
    const cat = categoryFromSlug(slug);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(b);
  }

  // 1) get 3 images per category (download local)
  const catToLocalImages = new Map();

  for (const [cat] of byCat) {
    const locals = [];
    console.log(`🖼️ Fetching 3 images for category: ${cat}`);

    for (let i = 1; i <= 3; i++) {
      try {
        await sleep(1200);
        const imgUrl = await fetchUnsplashImageUrl(`${cat} book cover`);
        if (!imgUrl) continue;

        const local = await download(imgUrl, `cat-${cat}-${i}.jpg`);
        locals.push(local);
        console.log(`  ✅ got image ${i}/3 for ${cat}`);
      } catch (e) {
        const status = e?.response?.status;
        console.log(`  ❌ failed image ${i}/3 for ${cat} (status=${status ?? "N/A"}): ${e.message}`);
      }
    }

    if (locals.length) catToLocalImages.set(cat, locals);
    else console.log(`⚠️ No images fetched for category: ${cat}`);
  }

  // 2) upload + link
  let added = 0,
    skipped = 0,
    failed = 0;

  for (const [cat, catBooks] of byCat) {
    const locals = catToLocalImages.get(cat);
    if (!locals?.length) {
      console.log(`⚠️ No images for category ${cat}, skipping its books`);
      continue;
    }

    for (const b of catBooks) {
      const attrs = b.attributes || b;
      const slug = attrs.slug || "";
      const bookDocumentId = attrs.documentId || b.documentId;

      try {
        if (hasCover(attrs)) {
          skipped++;
          continue;
        }

        const local = pickRandom(locals);

        await sleep(250);
        const fileId = await uploadFileOnly(local);
        await attachFileToBookByUpdate(bookDocumentId, fileId);

        added++;
        console.log(`✅ Linked cover: ${slug || bookDocumentId} (cat=${cat})`);
      } catch (e) {
        failed++;
        const msg = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
        console.log(`❌ Failed: ${slug || bookDocumentId} -> ${msg}`);
      }
    }
  }

  console.log(`🎉 DONE | Added=${added} | Skipped=${skipped} | Failed=${failed}`);
}

run().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});
