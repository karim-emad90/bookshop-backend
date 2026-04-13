import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const STRAPI_URL = process.env.STRAPI_URL || 'https://bookshop-backend-xnfc.onrender.com';
const TOKEN = process.env.STRAPI_TOKEN;
const UNSPLASH_KEY = process.env.UNSPLASH_KEY;

if (!TOKEN) {
  console.error('❌ Missing STRAPI_TOKEN in back/.env');
  process.exit(1);
}

if (!UNSPLASH_KEY) {
  console.error('❌ Missing UNSPLASH_KEY in back/.env');
  process.exit(1);
}

const api = axios.create({
  baseURL: `${STRAPI_URL}/api`,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

const TMP_DIR = path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const COVER_FIELD = 'coverImageUrl';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function categoryFromSlug(slug = '') {
  const idx = slug.indexOf('-book-');
  return idx === -1 ? 'books' : slug.slice(0, idx);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function withRetry(fn, { retries = 4, baseDelay = 1000 } = {}) {
  let lastErr;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const retryable = status === 429 || (status >= 500 && status <= 599) || !status;

      if (!retryable || i === retries) break;

      const wait = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 300);
      console.log(`⏳ Retry #${i + 1} after ${wait}ms`);
      await sleep(wait);
    }
  }

  throw lastErr;
}

async function healthCheck() {
  try {
    await api.get('/books', {
      params: {
        'pagination[page]': 1,
        'pagination[pageSize]': 1,
      },
    });
    console.log('✅ Strapi reachable');
  } catch (err) {
    console.error('❌ Cannot reach Strapi');
    console.error(err?.response?.status, err?.response?.data || err.message);
    process.exit(1);
  }
}

async function fetchUnsplashImageUrl(query) {
  const res = await withRetry(() =>
    axios.get('https://api.unsplash.com/photos/random', {
      params: {
        query,
        orientation: 'portrait',
        content_filter: 'high',
      },
      headers: {
        Authorization: `Client-ID ${UNSPLASH_KEY}`,
      },
      timeout: 20000,
    })
  );

  return res.data?.urls?.regular || res.data?.urls?.small || null;
}

async function downloadImage(url, filename) {
  const filePath = path.join(TMP_DIR, filename);

  const response = await withRetry(() =>
    axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
    })
  );

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return filePath;
}

async function uploadFileToStrapi(filePath) {
  const form = new FormData();
  form.append('files', fs.createReadStream(filePath));

  const res = await withRetry(() =>
    axios.post(`${STRAPI_URL}/api/upload`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${TOKEN}`,
      },
      timeout: 60000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })
  );

  const uploaded = res.data?.[0];
  if (!uploaded?.id) {
    throw new Error('Upload succeeded but no file id returned');
  }

  return uploaded.id;
}

async function getAllBooks(pageSize = 100) {
  const allBooks = [];
  let page = 1;

  while (true) {
    const res = await api.get('/books', {
      params: {
        'pagination[page]': page,
        'pagination[pageSize]': pageSize,
        [`populate[${COVER_FIELD}]`]: true,
      },
    });

    const data = res.data?.data || [];
    allBooks.push(...data);

    const meta = res.data?.meta?.pagination;
    if (!meta || page >= meta.pageCount) break;
    page++;
  }

  return allBooks;
}

function hasCover(book) {
  const value = book?.[COVER_FIELD];

  if (!value) return false;
  if (typeof value === 'number') return true;
  if (typeof value === 'object' && 'id' in value) return true;
  if (typeof value === 'object' && 'data' in value) return !!value.data;

  return false;
}

async function attachFileToBook(documentId, fileId) {
  await withRetry(() =>
    api.put(`/books/${documentId}`, {
      data: {
        [COVER_FIELD]: fileId,
      },
    })
  );
}

async function run() {
  await healthCheck();

  const books = await getAllBooks(100);
  console.log(`📚 Found books: ${books.length}`);

  const categoryImages = new Map();

  const uniqueCategories = [...new Set(books.map((book) => categoryFromSlug(book.slug || '')))];
  console.log(`🗂️ Categories found: ${uniqueCategories.length}`);

  for (const category of uniqueCategories) {
    const localFiles = [];
    console.log(`🖼️ Fetching images for category: ${category}`);

    for (let i = 1; i <= 3; i++) {
      try {
        await sleep(1200);
        const imageUrl = await fetchUnsplashImageUrl(`${category} book cover`);
        if (!imageUrl) continue;

        const localFile = await downloadImage(imageUrl, `${category}-${i}.jpg`);
        localFiles.push(localFile);

        console.log(`  ✅ image ${i}/3 ready for ${category}`);
      } catch (err) {
        console.log(`  ❌ image ${i}/3 failed for ${category}: ${err.message}`);
      }
    }

    if (localFiles.length > 0) {
      categoryImages.set(category, localFiles);
    } else {
      console.log(`⚠️ No images fetched for category: ${category}`);
    }
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const slug = book.slug || '';
    const documentId = book.documentId;
    const category = categoryFromSlug(slug);

    try {
      if (!documentId) {
        console.log(`⚠️ [${i + 1}/${books.length}] Missing documentId: ${slug}`);
        skipped++;
        continue;
      }

      if (hasCover(book)) {
        console.log(`↩️ [${i + 1}/${books.length}] Skip existing cover: ${slug}`);
        skipped++;
        continue;
      }

      const localFiles = categoryImages.get(category);
      if (!localFiles?.length) {
        console.log(`⚠️ [${i + 1}/${books.length}] No local images for category: ${category}`);
        failed++;
        continue;
      }

      const selectedFile = pickRandom(localFiles);
      const fileId = await uploadFileToStrapi(selectedFile);
      await attachFileToBook(documentId, fileId);

      console.log(`✅ [${i + 1}/${books.length}] Linked cover: ${slug}`);
      updated++;

      await sleep(300);
    } catch (err) {
      const msg = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;

      console.log(`❌ [${i + 1}/${books.length}] Failed: ${slug} -> ${msg}`);
      failed++;
      await sleep(1000);
    }
  }

  console.log('--------------------------------------------------');
  console.log(`🎉 DONE | Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log('--------------------------------------------------');
}

run().catch((err) => {
  console.error('❌ Fatal error:', err?.response?.data || err.message || err);
  process.exit(1);
});