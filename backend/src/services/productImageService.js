const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_PREFIX = '/api/product-images';
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
]);

class ProductImageError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'ProductImageError';
    this.statusCode = statusCode;
  }
}

function getStorageRoot() {
  const configured = process.env.PRODUCT_IMAGES_DIR;
  if (configured && String(configured).trim()) {
    return path.resolve(String(configured).trim());
  }

  return path.resolve(
    __dirname,
    '..',
    '..',
    'storage',
    'product-images'
  );
}

function getExtension(file) {
  switch (file.mimetype) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

function contentTypeForExtension(extension) {
  switch (String(extension || '').toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function safeSku(sku) {
  return String(sku || 'product')
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .toLowerCase() || 'product';
}

function safeProductId(productId) {
  const id = String(productId ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new ProductImageError('Invalid product id', 400);
  }
  return id;
}

function publicUrl(relativePath) {
  return `${PUBLIC_PREFIX}/${String(relativePath).replace(/\\/g, '/')}`;
}

function normalizeRelativePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new ProductImageError('Invalid image path', 400);
  }

  const normalized = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  if (!normalized || normalized.includes('\0')) {
    throw new ProductImageError('Invalid image path', 400);
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new ProductImageError('Invalid image path', 400);
  }

  return parts.join('/');
}

function resolveStoredFile(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const root = getStorageRoot();
  const resolved = path.resolve(root, ...normalized.split('/'));
  const relative = path.relative(root, resolved);

  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new ProductImageError('Invalid image path', 400);
  }

  return resolved;
}

async function ensureProductImageStorage() {
  const root = getStorageRoot();
  await fs.promises.mkdir(path.join(root, 'products'), { recursive: true });
  await fs.promises.mkdir(path.join(root, 'trash'), { recursive: true });
  return root;
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function moveFile(fromPath, toPath) {
  await fs.promises.mkdir(path.dirname(toPath), { recursive: true });

  try {
    await fs.promises.rename(fromPath, toPath);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      await fs.promises.copyFile(fromPath, toPath);
      await fs.promises.unlink(fromPath);
      return;
    }
    throw error;
  }
}

function trashSidecarPath(imageFilePath) {
  return `${imageFilePath}.json`;
}

async function readTrashRecord(imageFilePath) {
  const sidecar = trashSidecarPath(imageFilePath);
  let payload = {};

  try {
    payload = JSON.parse(
      await fs.promises.readFile(sidecar, 'utf8')
    );
  } catch {
    payload = {};
  }

  const relativePath = path
    .relative(getStorageRoot(), imageFilePath)
    .split(path.sep)
    .join('/');

  return {
    filePath: imageFilePath,
    sidecarPath: sidecar,
    originalPath: payload.originalPath || null,
    trashedAt: payload.trashedAt || null,
    productId: payload.productId || null,
    publicUrl: publicUrl(relativePath),
  };
}

async function listTrashRecords(productId) {
  const id = safeProductId(productId);
  const trashDir = path.join(getStorageRoot(), 'trash', id);

  let names;
  try {
    names = await fs.promises.readdir(trashDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const records = [];
  for (const name of names) {
    const extension = path.extname(name).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }

    const filePath = path.join(trashDir, name);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      continue;
    }

    records.push(await readTrashRecord(filePath));
  }

  records.sort((left, right) => {
    const leftStamp = String(left.trashedAt || '');
    const rightStamp = String(right.trashedAt || '');
    if (leftStamp !== rightStamp) {
      return rightStamp.localeCompare(leftStamp);
    }
    return path.basename(right.filePath).localeCompare(path.basename(left.filePath));
  });

  return records;
}

async function getLatestTrashedImage(productId) {
  const records = await listTrashRecords(productId);
  return records[0] || null;
}

async function uploadProductImage(file, sku) {
  if (!file) {
    return null;
  }

  await ensureProductImageStorage();

  const extension = getExtension(file);
  if (extension === 'bin') {
    throw new ProductImageError(
      'Only JPG, PNG, and WebP images are allowed.',
      400
    );
  }

  const imagePath = `products/${safeSku(sku)}/${crypto.randomUUID()}.${extension}`;
  const destination = resolveStoredFile(imagePath);

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, file.buffer);

  return {
    imageUrl: publicUrl(imagePath),
    imagePath,
  };
}

async function deleteProductImage(imagePath) {
  if (!imagePath) {
    return;
  }

  let filePath;
  try {
    filePath = resolveStoredFile(imagePath);
  } catch {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function trashProductImage(productId, imagePath) {
  if (!imagePath) {
    return { trashed: false };
  }

  let source;
  try {
    source = resolveStoredFile(imagePath);
  } catch {
    return { trashed: false };
  }

  if (!(await pathExists(source))) {
    return { trashed: false };
  }

  await ensureProductImageStorage();

  const id = safeProductId(productId);
  const originalPath = normalizeRelativePath(imagePath);
  const extension = path.extname(source).toLowerCase() || '.jpg';
  const trashedAt = new Date().toISOString();
  const stamp = trashedAt.replace(/[:.]/g, '-');
  const trashRelative = `trash/${id}/${stamp}-${crypto.randomUUID()}${extension}`;
  const destination = resolveStoredFile(trashRelative);

  await moveFile(source, destination);

  const record = {
    productId: id,
    originalPath,
    trashedAt,
    contentType: contentTypeForExtension(extension),
  };

  await fs.promises.writeFile(
    trashSidecarPath(destination),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8'
  );

  return {
    trashed: true,
    publicUrl: publicUrl(trashRelative),
    trashedAt,
    originalPath,
  };
}

async function restoreTrashRecord(record, { preferredPath } = {}) {
  const extension = path.extname(record.filePath).toLowerCase() || '.jpg';
  let nextPath = preferredPath || record.originalPath;

  if (!nextPath) {
    nextPath = `products/restored/${crypto.randomUUID()}${extension}`;
  }

  nextPath = normalizeRelativePath(nextPath);
  let destination = resolveStoredFile(nextPath);

  if (await pathExists(destination)) {
    nextPath = `products/restored/${crypto.randomUUID()}${extension}`;
    destination = resolveStoredFile(nextPath);
  }

  await moveFile(record.filePath, destination);

  try {
    await fs.promises.unlink(record.sidecarPath);
  } catch {
    // Sidecar is optional once the image is restored.
  }

  return {
    imageUrl: publicUrl(nextPath),
    imagePath: nextPath,
  };
}

async function restoreProductImage(productId, { currentImagePath } = {}) {
  const latest = await getLatestTrashedImage(productId);
  if (!latest) {
    throw new ProductImageError(
      'No image in trash to restore',
      409
    );
  }

  if (currentImagePath) {
    await trashProductImage(productId, currentImagePath);
  }

  return restoreTrashRecord(latest, {
    preferredPath: latest.originalPath,
  });
}

function createProductImageStaticHandler() {
  return async function productImageStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const relative = decodeURIComponent(
        String(req.path || '').replace(/^\/+/, '')
      );
      const extension = path.extname(relative).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
        return res.status(404).json({ error: 'Image not found' });
      }

      const filePath = resolveStoredFile(relative);
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return res.status(404).json({ error: 'Image not found' });
      }

      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.sendFile(filePath);
    } catch {
      return res.status(404).json({ error: 'Image not found' });
    }
  };
}

module.exports = {
  ProductImageError,
  PUBLIC_PREFIX,
  getStorageRoot,
  ensureProductImageStorage,
  uploadProductImage,
  deleteProductImage,
  trashProductImage,
  restoreProductImage,
  getLatestTrashedImage,
  createProductImageStaticHandler,
  resolveStoredFile,
  publicUrl,
};
