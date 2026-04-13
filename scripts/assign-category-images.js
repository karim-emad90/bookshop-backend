const fs = require("fs");
const path = require("path");
const axios = require("axios");

const STRAPI_URL = "https://bookshop-backend-1-qtv2.onrender.com";

// ⚠️ حط الـ API TOKEN بتاعك هنا
const API_TOKEN = "d48611877a9d840c519e9d9b662953fd6e473c21844b19cfea2df025e9b10d7510c488170e150c2368fe93aeb684262c0a6388b28ed4401d5fd1063c6c215b092fbaa0bd54ea823ac7af736b826e0117446fc4c5e7124554c0cbef2c02317f9b2e36f257df1e528ca6a467fb5f6e5455d725007d909d5f28d486a18df819d339";

const IMAGE_FIELD = "coverImageUrl";

// 👇 مهم جدًا: لازم الصور تكون هنا
const CATEGORY_IMAGES_DIR = path.join(__dirname, "../public/category-images");

// 👇 ربط category id بالصورة
const categoryImageMap = {
  // romance
  "mmxrrjx9ilgmxyvzwkc2j3e1": "romance.jpg",

  // business
  "ajqikhgwvclcng74voq3ux50": "business.jpg",

  // cooking
  "y9nnbzh2diyot5b8lq2g3vb9": "cooking.jpg",

  // fantasy
  "z4qjubr12lrmnp40ud2rctyl": "fantasy.jpg",

  // history
  "awb0pbx3cxusdql0phxjydh3": "history.jpg",

  // kids
  "vru8tbdxl3ljxri77yfsolgu": "kids.jpg",

  // music
  "twavswxycy8br998wv0xas9p": "music.jpg",

  // self-help
  "r8sp4n440lwlymx9g522agdo": "self-help.jpg",

  // sports
  "ecx98p734yl63d8g71yrycc0": "sports.jpg",

  // art
  "wsyrik9jr0aibag2m2a7tvl1": "art.jpg",
};

const headers = {
  Authorization: `Bearer ${API_TOKEN}`,
};

// 🟢 يجيب الكتب
async function getAllBooks(page = 1, pageSize = 100) {
  const res = await axios.get(`${STRAPI_URL}/api/books`, {
    headers,
    params: {
      "pagination[page]": page,
      "pagination[pageSize]": pageSize,
      fields: ["title", "category", "coverImageUrl"],
    },
  });

  return res.data;
}

// 🟢 يحدث صورة الكتاب (string فقط)
async function updateBookImage(documentId, fileName) {
  await axios.put(
    `${STRAPI_URL}/api/books/${documentId}`,
    {
      data: {
        [IMAGE_FIELD]: fileName,
      },
    },
    { headers }
  );
}

async function main() {
  let page = 1;
  let totalPages = 1;

  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  do {
    const data = await getAllBooks(page, 100);
    const books = data.data;
    totalPages = data.meta.pagination.pageCount;

    for (const book of books) {
      try {
        const categoryId = String(book?.category || "");

        if (!categoryId) {
          console.log(`❌ Skipped: ${book.title} -> no category`);
          skippedCount++;
          continue;
        }

        const imageFileName = categoryImageMap[categoryId];

        if (!imageFileName) {
          console.log(`❌ Skipped: ${book.title} -> no mapping`);
          skippedCount++;
          continue;
        }

        const imagePath = path.join(CATEGORY_IMAGES_DIR, imageFileName);

        if (!fs.existsSync(imagePath)) {
          console.log(`❌ Missing file: ${imagePath}`);
          skippedCount++;
          continue;
        }

        await updateBookImage(book.documentId, imageFileName);

        updatedCount++;
        console.log(`✅ Updated: ${book.title} -> ${imageFileName}`);
      } catch (err) {
        failedCount++;
        console.error(`🔥 Failed: ${book.title}`);
        console.error(err.response?.data || err.message);
      }
    }

    page++;
  } while (page <= totalPages);

  console.log("==================================");
  console.log("🎉 DONE");
  console.log(`✅ Updated: ${updatedCount}`);
  console.log(`⚠️ Skipped: ${skippedCount}`);
  console.log(`🔥 Failed: ${failedCount}`);
  console.log("==================================");
}

main();