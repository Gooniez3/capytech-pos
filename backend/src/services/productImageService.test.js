const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-product-images-'));
process.env.PRODUCT_IMAGES_DIR = tmp;

const {
  uploadProductImage,
  deleteProductImage,
  trashProductImage,
  restoreProductImage,
  getLatestTrashedImage,
  createProductImageStaticHandler,
  resolveStoredFile,
  ProductImageError,
} = require('./productImageService');

function jpegFile() {
  return {
    mimetype: 'image/jpeg',
    buffer: Buffer.from('fake-jpeg'),
  };
}

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('upload writes a local file and returns a relative URL', async () => {
  const uploaded = await uploadProductImage(jpegFile(), 'Mouse 01');
  assert.match(uploaded.imagePath, /^products\/mouse-01\/.+\.jpg$/);
  assert.equal(
    uploaded.imageUrl,
    `/api/product-images/${uploaded.imagePath}`
  );
  assert.equal(
    await fs.promises.readFile(resolveStoredFile(uploaded.imagePath), 'utf8'),
    'fake-jpeg'
  );
});

test('replace trash keeps the previous file restorable', async () => {
  const first = await uploadProductImage(jpegFile(), 'HDMI');
  const second = await uploadProductImage(jpegFile(), 'HDMI');

  const trashed = await trashProductImage(12, first.imagePath);
  assert.equal(trashed.trashed, true);
  assert.equal(await fs.promises.access(resolveStoredFile(first.imagePath)).then(() => true, () => false), false);

  const latest = await getLatestTrashedImage(12);
  assert.ok(latest.publicUrl.startsWith('/api/product-images/trash/12/'));

  const restored = await restoreProductImage(12, {
    currentImagePath: second.imagePath,
  });
  assert.match(restored.imagePath, /^products\//);
  assert.equal(
    await fs.promises.readFile(resolveStoredFile(restored.imagePath), 'utf8'),
    'fake-jpeg'
  );

  const afterRestore = await getLatestTrashedImage(12);
  assert.ok(afterRestore);
  assert.equal(
    await fs.promises.readFile(afterRestore.filePath, 'utf8'),
    'fake-jpeg'
  );
});

test('restore fails closed when trash is empty', async () => {
  await assert.rejects(
    restoreProductImage(99),
    (error) =>
      error instanceof ProductImageError && error.statusCode === 409
  );
});

test('missing local files are a no-op for trash and delete', async () => {
  const missing = await trashProductImage(3, 'products/missing/nope.jpg');
  assert.equal(missing.trashed, false);
  await deleteProductImage('products/missing/nope.jpg');
});

test('path traversal is rejected', () => {
  assert.throws(
    () => resolveStoredFile('../secret.jpg'),
    (error) => error instanceof ProductImageError && error.statusCode === 400
  );
  assert.throws(
    () => resolveStoredFile('products/../../etc/passwd'),
    (error) => error instanceof ProductImageError && error.statusCode === 400
  );
});

test('static handler serves stored images and hides non-images', async () => {
  const uploaded = await uploadProductImage(jpegFile(), 'cable');
  const handler = createProductImageStaticHandler();

  const ok = await new Promise((resolve) => {
    const headers = {};
    handler(
      { method: 'GET', path: `/${uploaded.imagePath}` },
      {
        setHeader(name, value) {
          headers[name] = value;
        },
        sendFile(filePath) {
          resolve({ filePath, headers, status: 200 });
        },
        status() {
          return this;
        },
        json() {
          resolve({ status: 500 });
        },
      }
    );
  });

  assert.equal(ok.status, 200);
  assert.equal(ok.filePath, resolveStoredFile(uploaded.imagePath));

  const blocked = await new Promise((resolve) => {
    handler(
      { method: 'GET', path: '/trash/1/meta.json' },
      {
        setHeader() {},
        sendFile() {
          resolve({ status: 200 });
        },
        status(code) {
          this.statusCode = code;
          return this;
        },
        json() {
          resolve({ status: this.statusCode });
        },
      }
    );
  });

  assert.equal(blocked.status, 404);
});
