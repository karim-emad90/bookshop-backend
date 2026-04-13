import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import fs from 'fs';
import csv from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const TOKEN = process.env.STRAPI_TOKEN;

if (!TOKEN) {
  console.error('❌ Missing STRAPI_TOKEN in back/.env');
  process.exit(1);
}

console.log('STRAPI_URL =', STRAPI_URL);
console.log('TOKEN exists =', !!TOKEN);
console.log('TOKEN preview =', TOKEN?.slice(0, 12));

const api = axios.create({
  baseURL: `${STRAPI_URL}/api`,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function testAuth() {
  try {
    const test = await api.get('/books');
    console.log('✅ AUTH OK FROM SCRIPT');
    console.log(
      `📚 Existing books count: ${test?.data?.meta?.pagination?.total ?? 0}`
    );
    return true;
  } catch (err) {
    console.log('❌ AUTH FAIL FROM SCRIPT');
    console.log(err?.response?.status, err?.response?.data || err.message);
    return false;
  }
}

// ✅ Helpers
function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function toBoolean(value) {
  return String(value).trim().toLowerCase() === 'true';
}

function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

// ✅ Strapi v5: استخدم documentId
async function getOrCreateCategoryDocumentId(name, slug) {
  try {
    const found = await api.get('/categories', {
      params: { 'filters[slug][$eq]': slug },
    });

    const existing = found.data?.data?.[0];
    if (existing?.documentId) {
      return existing.documentId;
    }

    const created = await api.post('/categories', {
      data: {
        name: toNullableString(name),
        slug: toNullableString(slug),
      },
    });

    return created.data?.data?.documentId || null;
  } catch (err) {
    const msg = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err?.message;
    console.log(`❌ Category error [${slug}] -> ${msg}`);
    return null;
  }
}

async function bookExists(slug) {
  const res = await api.get('/books', {
    params: { 'filters[slug][$eq]': slug },
  });
  return (res.data?.data?.length || 0) > 0;
}

function readCsvRows(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', (err) => reject(err));
  });
}

async function run() {
  const isAuthOk = await testAuth();
  if (!isAuthOk) {
    process.exit(1);
  }

  const csvPath = path.join(__dirname, 'books_900_strapi_seed.csv');
  console.log(`📄 Reading CSV from: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  let rows = [];
  try {
    rows = await readCsvRows(csvPath);
  } catch (err) {
    console.error('❌ Failed to read CSV:', err.message);
    process.exit(1);
  }

  console.log(`📦 Total rows loaded: ${rows.length}`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const slug = toNullableString(row.slug);

      if (!slug) {
        console.log('⚠️ Skip row with missing slug');
        skipped++;
        continue;
      }

      if (await bookExists(slug)) {
        console.log(`↩️ Skip existing: ${slug}`);
        skipped++;
        continue;
      }

      const categoryName = toNullableString(row.categoryName);
      const categorySlug = toNullableString(row.categorySlug);

      let categoryDocumentId = null;

      if (categoryName && categorySlug) {
        categoryDocumentId = await getOrCreateCategoryDocumentId(
          categoryName,
          categorySlug
        );
      }

      const payload = {
        title: toNullableString(row.title),
        slug,
        description: toNullableString(row.description),
        author: toNullableString(row.author),
        publisher: toNullableString(row.publisher),
        year: toNumber(row.year),
        language: toNullableString(row.language),
        pages: toNumber(row.pages),
        isbn13: toNullableString(row.isbn13),
        price: toNumber(row.price),
        rating: toNumber(row.rating),
        reviewsCount: toNumber(row.reviewsCount),
        discountPercent: toNumber(row.discountPercent),
        discountCode: toNullableString(row.discountCode),
        isActive: toBoolean(row.isActive),
      };

      // ✅ ضيف الـ relation فقط لو موجود
      if (categoryDocumentId) {
        payload.category = categoryDocumentId;
      }

      await api.post('/books', { data: payload });
      console.log(`✅ Created book: ${slug}`);
      created++;
    } catch (err) {
      failed++;
      const msg = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message || 'Unknown error';
      console.log(`❌ Failed: ${row.slug || 'NO_SLUG'} -> ${msg}`);
    }
  }

  console.log('--------------------------------------------------');
  console.log(`🎉 DONE | Created: ${created} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log('--------------------------------------------------');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Fatal error:', err?.response?.data || err.message || err);
  process.exit(1);
});