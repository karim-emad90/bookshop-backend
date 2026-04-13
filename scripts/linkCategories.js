// scripts/linkCategories.js
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API = process.env.STRAPI_URL;
const TOKEN = process.env.STRAPI_TOKEN;

// عندك book.category فيه documentId بتاع الـ category
const BOOK_CATEGORY_FIELD = "category";

// اسم الـ relation field داخل Book
const BOOK_RELATION_FIELD = "categories";

if (!API || !TOKEN) {
  console.error("❌ Missing STRAPI_URL or STRAPI_TOKEN in .env");
  process.exit(1);
}

const client = axios.create({
  baseURL: API,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
});

const norm = (v) => (v ?? "").toString().trim().toLowerCase();

function getAttrs(entity) {
  return entity?.attributes ?? entity ?? {};
}

// محاولة Update بطرق مختلفة لأن بعض إعدادات v5 تقبل set كـ string
// وبعضها يحتاج set كـ object { documentId }
async function updateBookRelation(bookDocumentId, catDocumentId) {
  // Try A: set as string documentId
  try {
    await client.put(`/api/books/${bookDocumentId}`, {
      data: {
        [BOOK_RELATION_FIELD]: {
          set: [catDocumentId],
        },
      },
    });
    return true;
  } catch (e) {
    const status = e.response?.status;
    if (![400, 404].includes(status)) throw e;
  }

  // Try B: set as object with documentId
  await client.put(`/api/books/${bookDocumentId}`, {
    data: {
      [BOOK_RELATION_FIELD]: {
        set: [{ documentId: catDocumentId }],
      },
    },
  });

  return true;
}

async function run() {
  console.log("🚀 Linking started...");

  // 1) Fetch categories
  const catsRes = await client.get("/api/categories?pagination[pageSize]=1000");
  const categories = catsRes.data.data || [];
  console.log("✅ Categories fetched:", categories.length);
  console.log("Sample category:", categories[0]);

  // 2) Map: categoryDocumentId / slug / name -> categoryDocumentId
  const catMap = new Map();

  for (const c of categories) {
    const a = getAttrs(c);
    const docId = c.documentId ?? a.documentId;
    const slug = c.slug ?? a.slug;
    const name = c.name ?? a.name;

    if (docId) catMap.set(norm(docId), docId);
    if (slug) catMap.set(norm(slug), docId);
    if (name) catMap.set(norm(name), docId);
  }

  let page = 1;
  const pageSize = 100;
  let linked = 0;
  let skipped = 0;

  const skippedExamples = new Map();

  while (true) {
    const booksRes = await client.get(
      `/api/books?pagination[page]=${page}&pagination[pageSize]=${pageSize}`
    );

    const books = booksRes.data.data || [];
    if (!books.length) break;

    console.log(`📚 Page ${page} books:`, books.length);

    for (const book of books) {
      const b = getAttrs(book);

      // ✅ Strapi v5 لازم تستخدم documentId في URL
      const bookDocId = book.documentId ?? b.documentId;

      if (!bookDocId) {
        skipped++;
        skippedExamples.set(
          "(BOOK missing documentId)",
          (skippedExamples.get("(BOOK missing documentId)") ?? 0) + 1
        );
        continue;
      }

      // category field عندك فيه documentId للكاتيجوري
      const rawCat = b?.[BOOK_CATEGORY_FIELD];
      const catDocId = catMap.get(norm(rawCat));

      if (!catDocId) {
        skipped++;
        const shown = rawCat ? rawCat.toString() : "(EMPTY category)";
        skippedExamples.set(
          shown,
          (skippedExamples.get(shown) ?? 0) + 1
        );
        continue;
      }

      try {
        await updateBookRelation(bookDocId, catDocId);
        linked++;
      } catch (e) {
        console.log("❌ Update failed for book:", bookDocId, "cat:", catDocId);
        console.log("   Error:", e.response?.data || e.message);
      }
    }

    page++;
  }

  console.log("✅ Done linking categories ✅");
  console.log("Linked:", linked);
  console.log("Skipped (no match):", skipped);

  const topSkipped = [...skippedExamples.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log("🔎 Top skipped category values:");
  for (const [val, cnt] of topSkipped) {
    console.log(`- ${val}  =>  ${cnt}`);
  }
}

run().catch((e) => {
  console.error("❌ Script crashed:", e.response?.data || e.message);
});