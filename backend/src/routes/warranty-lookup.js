const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { lookupWarranty } = require('../services/warranty-lookup-service');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    return res.json(await lookupWarranty(pool, req.query));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code || 'WARRANTY_LOOKUP_ERROR',
      });
    }
    console.error('Warranty lookup failed:', error);
    return res.status(500).json({ error: 'Failed to look up warranty' });
  }
});

module.exports = router;
