const crypto = require('crypto');
const supabase = require('../config/supabase');

const BUCKET_NAME = 'product-images';

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

async function uploadProductImage(file, sku) {
  if (!file) {
    return null;
  }

  const extension =
    getExtension(file);

  const safeSku = String(
    sku || 'product'
  )
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .toLowerCase();

  const uniqueId =
    crypto.randomUUID();

  const imagePath =
    `products/${safeSku}/${uniqueId}.${extension}`;

  const { error } =
    await supabase.storage
      .from(BUCKET_NAME)
      .upload(
        imagePath,
        file.buffer,
        {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: false,
        }
      );

  if (error) {
    throw new Error(
      `Failed to upload product image: ${error.message}`
    );
  }

  const {
    data: publicUrlData,
  } =
    supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(imagePath);

  return {
    imageUrl:
      publicUrlData.publicUrl,

    imagePath,
  };
}

async function deleteProductImage(
  imagePath
) {
  if (!imagePath) {
    return;
  }

  const { error } =
    await supabase.storage
      .from(BUCKET_NAME)
      .remove([imagePath]);

  if (error) {
    throw new Error(
      `Failed to delete product image: ${error.message}`
    );
  }
}

module.exports = {
  uploadProductImage,
  deleteProductImage,
};