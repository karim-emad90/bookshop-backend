const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");

const STRAPI_URL = "https://bookshop-backend-1-qtv2.onrender.com";
const API_TOKEN = "d48611877a9d840c519e9d9b662953fd6e473c21844b19cfea2df025e9b10d7510c488170e150c2368fe93aeb684262c0a6388b28ed4401d5fd1063c6c215b092fbaa0bd54ea823ac7af736b826e0117446fc4c5e7124554c0cbef2c02317f9b2e36f257df1e528ca6a467fb5f6e5455d725007d909d5f28d486a18df819d339";

// اسم حقل الـ media في Strapi
const IMAGE_FIELD = "coverImageUrl";

// فولدر صور التصنيفات
const CATEGORY_IMAGES_DIR = path.join(__dirname, "category-images");

// ربط documentId بتاع category باسم ملف الصورة
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

async function uploadFile(filePath) {
  const form = new FormData();
  form.append("files", fs.createReadStream(filePath));

  const res = await axios.post(`${STRAPI_URL}/api/upload`, form, {
    headers: {
      ...headers,
      ...form.getHeaders(),
    },
  });

  return res.data[0];
}

async function getAllBooks(page = 1, pageSize = 100) {
  const res = await axios.get(`${STRAPI_URL}/api/books`, {
    headers,
    params: {
      "pagination[page]": page,
      "pagination[pageSize]": pageSize,
      populate: "*",
    },
  });

  return res.data;
}

async function updateBookImage(documentId, uploadedFileId) {
  await axios.put(
    `${STRAPI_URL}/api/books/${documentId}`,
    {
      data: {
        [IMAGE_FIELD]: uploadedFileId,
      },
    },
    { headers }
  );
}

async function main() {
  const uploadedImagesByCategoryId = {};
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
          console.log(`Skipped: ${book.title} -> no category id`);
          skippedCount++;
          continue;
        }

        const imageFileName = categoryImageMap[categoryId];

        if (!imageFileName) {
          console.log(
            `Skipped: ${book.title} -> no mapped image for category "${categoryId}"`
          );
          skippedCount++;
          continue;
        }

        const imagePath = path.join(CATEGORY_IMAGES_DIR, imageFileName);

        if (!fs.existsSync(imagePath)) {
          console.log(`Skipped: image file not found -> ${imagePath}`);
          skippedCount++;
          continue;
        }

        if (!uploadedImagesByCategoryId[categoryId]) {
          const uploaded = await uploadFile(imagePath);
          uploadedImagesByCategoryId[categoryId] = uploaded.id;

          console.log(
            `Uploaded once for category: ${categoryId} -> ${imageFileName} -> file id ${uploaded.id}`
          );
        }

        await updateBookImage(
          book.documentId,
          uploadedImagesByCategoryId[categoryId]
        );

        updatedCount++;
        console.log(`Updated: ${book.title} -> ${categoryId}`);
      } catch (err) {
        failedCount++;
        console.error(`Failed: ${book.title}`);
        console.error(err.response?.data || err.message);
      }
    }

    page++;
  } while (page <= totalPages);

  console.log("==================================");
  console.log("Done.");
  console.log(`Updated books: ${updatedCount}`);
  console.log(`Skipped books: ${skippedCount}`);
  console.log(`Failed books: ${failedCount}`);
  console.log("==================================");
}

main();