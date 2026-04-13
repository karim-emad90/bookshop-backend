import "dotenv/config";
import axios from "axios";

const STRAPI_URL = process.env.STRAPI_URL || "https://bookshop-backend-xnfc.onrender.com";
const TOKEN = process.env.STRAPI_TOKEN;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;

if (!TOKEN || !UNSPLASH_KEY) {
  console.error("❌ Missing STRAPI_TOKEN or UNSPLASH_KEY");
  process.exit(1);
}

const api = axios.create({
  baseURL: `${STRAPI_URL}/api`,
  headers: { Authorization: `Bearer ${TOKEN}` },
  timeout: 30000,
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchUnsplashImageUrl(query) {
  const res = await axios.get("https://api.unsplash.com/photos/random", {
    params: { query, orientation: "portrait", content_filter: "high" },
    headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    timeout: 15000,
  });

  return res.data?.urls?.regular || res.data?.urls?.small || null;
}

function categoryFromSlug(slug = "") {
  const idx = slug.indexOf("-book-");
  return idx === -1 ? "books" : slug.slice(0, idx);
}

async function getAllBooks(pageSize = 100) {
  const all = [];
  let page = 1;

  while (true) {
    const res = await api.get("/books", {
      params: {
        "pagination[page]": page,
        "pagination[pageSize]": pageSize,
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

async function updateBookImage(documentId, coverImageUrl) {
  await api.put(`/books/${documentId}`, {
    data: { coverImageUrl },
  });
}

async function run() {
  const books = await getAllBooks(100);
  console.log(`📚 Found books: ${books.length}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const b of books) {
    const slug = b.slug || "";
    const documentId = b.documentId;
    const existing = b.coverImageUrl;

    try {
      if (existing) {
        skipped++;
        continue;
      }

      const cat = categoryFromSlug(slug);
      const imageUrl = await fetchUnsplashImageUrl(`${cat} book cover`);

      if (!imageUrl) {
        failed++;
        console.log(`❌ No image found: ${slug}`);
        continue;
      }

      await updateBookImage(documentId, imageUrl);
      updated++;
      console.log(`✅ Updated: ${slug}`);

      await sleep(1200);
    } catch (e) {
      failed++;
      console.log(`❌ Failed: ${slug} -> ${e?.response?.data ? JSON.stringify(e.response.data) : e.message}`);
    }
  }

  console.log(`🎉 DONE | Updated=${updated} | Skipped=${skipped} | Failed=${failed}`);
}

run().catch((e) => {
  console.error(e?.response?.data || e);
  process.exit(1);
});