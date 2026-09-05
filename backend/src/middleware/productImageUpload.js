const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
  ];

  if (!allowedTypes.includes(file.mimetype)) {
    return cb(
      new Error(
        'Only JPG, PNG, and WebP images are allowed.'
      )
    );
  }

  cb(null, true);
};

const uploadProductImage = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024, // 3 MB
  },
  fileFilter,
});

module.exports = uploadProductImage;