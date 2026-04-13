import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import csv from 'csv-parser';

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const TOKEN = process.env.STRAPI_TOKEN;

if (!TOKEN) {
  console.error('❌ Missing STRAPI_TOKEN in scripts/.env');
  process.exit(1);
}

const api = axios.create({
  baseURL: `${STRAPI_URL}/api`,
  headers: { Authorization: `Bearer ${TOKEN}` },
});

// ✅ Strapi v5: استخدم documentId
async function getOrCreateCategoryDocumentId(name, slug) {
  const found = await api.get('/categories', {
    params: { 'filters[slug][$eq]': slug },
  });

  const existing = found.data?.data?.[0];
  if (existing?.documentId) return existing.documentId;

  const created = await api.post('/categories', {
    data: { name, slug },
  });

  return created.data?.data?.documentId;
}

async function bookExists(slug) {
  const res = await api.get('/books', {
    params: { 'filters[slug][$eq]': slug },
  });
  return (res.data?.data?.length || 0) > 0;
}

async function run() {
  const rows = [];

  fs.createReadStream('./books_900_strapi_seed.csv')
    .pipe(csv())
    .on('data', (row) => rows.push(row))
    .on('end', async () => {
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const row of rows) {
        try {
          if (await bookExists(row.slug)) {
            console.log(`↩️ Skip existing: ${row.slug}`);
            skipped++;
            continue;
          }

          const categoryDocumentId = await getOrCreateCategoryDocumentId(
            row.categoryName,
            row.categorySlug
          );

          if (!categoryDocumentId) {
            console.log(`⚠️ Could not create/find category: ${row.categorySlug}`);
            skipped++;
            continue;
          }

          const payload = {
            title: row.title,
            slug: row.slug,
            description: row.description,
            author: row.author,
            publisher: row.publisher,
            year: Number(row.year),
            language: row.language,
            pages: Number(row.pages),
            isbn13: row.isbn13,
            price: Number(row.price),
            rating: Number(row.rating),
            reviewsCount: Number(row.reviewsCount),
            discountPercent: Number(row.discountPercent),
            discountCode: row.discountCode || null,
            isActive: String(row.isActive).toLowerCase() === 'true',

            // ✅ Many-to-One relation في Strapi 5: ابعته documentId
            category: categoryDocumentId,
          };

          await api.post('/books', { data: payload });
          console.log(`✅ Created book: ${row.slug}`);
          created++;
        } catch (err) {
          failed++;
          const msg =
            err?.response?.data
              ? JSON.stringify(err.response.data)
              : (err?.message || 'Unknown error');
          console.log(`❌ Failed: ${row.slug} -> ${msg}`);
        }
      }

      console.log(`🎉 DONE | Created: ${created} | Skipped: ${skipped} | Failed: ${failed}`);
      process.exit(0);
    });
}

run();
