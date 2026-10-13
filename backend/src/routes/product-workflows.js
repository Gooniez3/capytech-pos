const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const uploadProductImageMiddleware = require('../middleware/productImageUpload');
const { uploadProductImage, deleteProductImage, trashProductImage } = require('../services/productImageService');
const { withTransaction } = require('../services/domain-transaction');
const {
  createProductWorkflow, editProductWorkflow, normalizeWorkflow,
} = require('../services/product-workflow-service');

const router = express.Router();

function parseWorkflow(req) {
  if (typeof req.body.workflow !== 'string') {
    const error = new Error('workflow must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
  try { return JSON.parse(req.body.workflow); } catch {
    const error = new Error('workflow must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function sendError(res, error, fallback) {
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message, code: error.code });
  if (error.code === '23505') return res.status(409).json({ error: 'A product, variant SKU, or serial number already exists' });
  if (error.code === '23503') return res.status(409).json({ error: 'A selected category or inventory relationship is invalid' });
  console.error(`${fallback}:`, error);
  return res.status(500).json({ error: fallback });
}

async function handle(req, res, edit) {
  let uploaded = null;
  try {
    const workflow = parseWorkflow(req);
    const validated = normalizeWorkflow(workflow, { edit });
    if (req.file) uploaded = await uploadProductImage(req.file, validated.productSku);
    const result = await withTransaction(pool, (transaction) => edit
      ? editProductWorkflow(transaction, {
        actorUserId: req.user.id, productId: req.params.id, workflow,
        imageUrl: uploaded?.imageUrl, imagePath: uploaded?.imagePath,
      })
      : createProductWorkflow(transaction, {
        actorUserId: req.user.id, workflow,
        imageUrl: uploaded?.imageUrl, imagePath: uploaded?.imagePath,
      }));
    if (edit && uploaded && result.previousImagePath
      && result.previousImagePath !== uploaded.imagePath) {
      await trashProductImage(result.product.id, result.previousImagePath).catch((error) => {
        console.error('Product updated but previous image could not be moved to trash:', error);
      });
    }
    const { previousImagePath, ...payload } = result;
    return res.status(edit ? 200 : 201).json(payload);
  } catch (error) {
    if (uploaded?.imagePath) await deleteProductImage(uploaded.imagePath).catch((cleanupError) => {
      console.error('Failed to clean up workflow image:', cleanupError);
    });
    return sendError(res, error, edit ? 'Failed to update product' : 'Failed to create product');
  }
}

router.post('/workflow', requireAuth, requireAdmin, uploadProductImageMiddleware.single('image'),
  (req, res) => handle(req, res, false));
router.put('/:id/workflow', requireAuth, requireAdmin, uploadProductImageMiddleware.single('image'),
  (req, res) => handle(req, res, true));

module.exports = router;
module.exports.parseWorkflow = parseWorkflow;
