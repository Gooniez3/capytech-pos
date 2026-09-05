const express = require('express');
const pool = require('../db/pool');
const {
  requireAuth,
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

/* =========================================================
   GET /api/settings/store
   ========================================================= */

router.get(
  '/store',
  requireAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
            SELECT
              id,
              store_name,
              phone,
              email,
              address,
              currency,
              tax_rate,
              updated_at

            FROM store_settings

            WHERE id = 1
          `
        );

      const settings =
        result.rows[0];

      if (!settings) {
        return res
          .status(404)
          .json({
            error:
              'Store settings not found',
          });
      }

      res.json({
        id:
          settings.id,

        storeName:
          settings.store_name,

        phone:
          settings.phone,

        email:
          settings.email,

        address:
          settings.address,

        currency:
          settings.currency,

        taxRate:
          Number(
            settings.tax_rate
          ),

        updatedAt:
          settings.updated_at,
      });
    } catch (error) {
      console.error(
        'Load store settings error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to load store settings',
      });
    }
  }
);

/* =========================================================
   PUT /api/settings/store
   Admin only
   ========================================================= */

router.put(
  '/store',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const storeName =
      typeof req.body?.storeName ===
      'string'
        ? req.body.storeName.trim()
        : '';

    const phone =
      typeof req.body?.phone ===
      'string'
        ? req.body.phone.trim()
        : '';

    const email =
      typeof req.body?.email ===
      'string'
        ? req.body.email.trim()
        : '';

    const address =
      typeof req.body?.address ===
      'string'
        ? req.body.address.trim()
        : '';

    const currency =
      typeof req.body?.currency ===
      'string'
        ? req.body.currency
            .trim()
            .toLowerCase()
        : 'ks';

    const taxRate =
      Number(
        req.body?.taxRate
      );

    /* =====================================================
       VALIDATION
       ===================================================== */

    if (!storeName) {
      return res.status(400).json({
        error:
          'Store name is required',
      });
    }

    if (storeName.length > 200) {
      return res.status(400).json({
        error:
          'Store name is too long',
      });
    }

    if (
      phone.length > 50
    ) {
      return res.status(400).json({
        error:
          'Phone number is too long',
      });
    }

    if (
      email.length > 200
    ) {
      return res.status(400).json({
        error:
          'Email is too long',
      });
    }

    if (
      email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
      )
    ) {
      return res.status(400).json({
        error:
          'Enter a valid email address',
      });
    }

    const allowedCurrencies = [
      'ks',
      'usd',
    ];

    if (
      !allowedCurrencies.includes(
        currency
      )
    ) {
      return res.status(400).json({
        error:
          'Unsupported currency',
      });
    }

    if (
      !Number.isFinite(
        taxRate
      ) ||
      taxRate < 0 ||
      taxRate > 100
    ) {
      return res.status(400).json({
        error:
          'Tax rate must be between 0 and 100',
      });
    }

    try {
      const result =
        await pool.query(
          `
            UPDATE store_settings

            SET
              store_name = $1,
              phone = $2,
              email = $3,
              address = $4,
              currency = $5,
              tax_rate = $6,
              updated_at = NOW()

            WHERE id = 1

            RETURNING
              id,
              store_name,
              phone,
              email,
              address,
              currency,
              tax_rate,
              updated_at
          `,
          [
            storeName,
            phone || null,
            email || null,
            address || null,
            currency,
            taxRate,
          ]
        );

      const settings =
        result.rows[0];

      if (!settings) {
        return res
          .status(404)
          .json({
            error:
              'Store settings not found',
          });
      }

      res.json({
        id:
          settings.id,

        storeName:
          settings.store_name,

        phone:
          settings.phone,

        email:
          settings.email,

        address:
          settings.address,

        currency:
          settings.currency,

        taxRate:
          Number(
            settings.tax_rate
          ),

        updatedAt:
          settings.updated_at,
      });
    } catch (error) {
      console.error(
        'Update store settings error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to update store settings',
      });
    }
  }
);

module.exports = router;