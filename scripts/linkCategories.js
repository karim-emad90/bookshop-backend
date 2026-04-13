// scripts/linkCategories.js
import axios from "axios";

const API = "http://localhost:1337";
const TOKEN = "af8d0fcd692293ee3bc660bd4c2ffdfe479547ad76138afa058727d6d996391aa7a4f9b175f092a067e457d8892c657ef050dd15e5367a80950a99bb7ca2348b1f8d290e83a453c72b9350914eda015b2d46d47f6d9f63969b2f1af290c3894797d9d5a46b383c745784b954f511a2d81178d5b4cb2404bf3c309409db8ab9bc"; // حط التوكن هنا

const client = axios.create({
  baseURL: API,
  headers: { Authorization: `Bearer ${TOKEN}` },
});

// عندك book.category فيه documentId بتاع الـ category
const BOOK_CATEGORY_FIELD = "category";

// اسم الـ relation field داخل Book
const BOOK_RELATION_FIELD = "categories";

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
    // لو مش 404/400، هنسيبها تتعامل
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

  // 2) Map: categoryDocumentId -> categoryDocumentId  (الأهم عندك)
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
    // خلي الـ pageSize 100 زي ما انت عامل
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
        skippedExamples.set("(BOOK missing documentId)", (skippedExamples.get("(BOOK missing documentId)") ?? 0) + 1);
        continue;
      }

      // category field عندك فيه documentId للكاتيجوري
      const rawCat = b?.[BOOK_CATEGORY_FIELD];
      const catDocId = catMap.get(norm(rawCat));

      if (!catDocId) {
        skipped++;
        const shown = rawCat ? rawCat.toString() : "(EMPTY category)";
        skippedExamples.set(shown, (skippedExamples.get(shown) ?? 0) + 1);
        continue;
      }

      try {
        await updateBookRelation(bookDocId, catDocId);
        linked++;
      } catch (e) {
        console.log("❌ Update failed for book:", bookDocId, "cat:", catDocId);
        console.log("   Error:", e.response?.data || e.message);
        // لو حصلت مشكلة في كتاب واحد، نكمل بدل ما نوقف كل السكريبت
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
  for (const [val, cnt] of topSkipped) console.log(`- ${val}  =>  ${cnt}`);
}

run().catch((e) => {
  console.error("❌ Script crashed:", e.response?.data || e.message);
});