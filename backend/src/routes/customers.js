const express = require('express');
const pool = require('../db/pool');
const {
  requireAuth,
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

/* =========================================================
   GET /api/customers
   Search / list customers
   ========================================================= */

router.get(
  '/',
  requireAuth,
  async (req, res) => {
    const search = String(
      req.query.search || ''
    ).trim();

    try {
      const result = await pool.query(
        `
        SELECT
          id,
          name,
          phone,
          email,
          address,
          notes,
          created_at,
          updated_at

        FROM customers

        WHERE
          $1 = ''
          OR name ILIKE '%' || $1 || '%'
          OR phone ILIKE '%' || $1 || '%'
          OR email ILIKE '%' || $1 || '%'

        ORDER BY
          name ASC

        LIMIT 100
        `,
        [search]
      );

      res.json(
        result.rows.map(
          (customer) => ({
            id:
              String(customer.id),

            name:
              customer.name,

            phone:
              customer.phone,

            email:
              customer.email,

            address:
              customer.address,

            notes:
              customer.notes,

            createdAt:
              customer.created_at,

            updatedAt:
              customer.updated_at,
          })
        )
      );
    } catch (err) {
      console.error(
        'Load customers error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to load customers',
      });
    }
  }
);

/* =========================================================
   GET /api/customers/:id
   ========================================================= */

router.get(
  '/:id',
  requireAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            id,
            name,
            phone,
            email,
            address,
            notes,
            created_at,
            updated_at

          FROM customers

          WHERE id = $1
          `,
          [req.params.id]
        );

      const customer =
        result.rows[0];

      if (!customer) {
        return res
          .status(404)
          .json({
            error:
              'Customer not found',
          });
      }

      res.json({
        id:
          String(customer.id),

        name:
          customer.name,

        phone:
          customer.phone,

        email:
          customer.email,

        address:
          customer.address,

        notes:
          customer.notes,

        createdAt:
          customer.created_at,

        updatedAt:
          customer.updated_at,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          'Failed to load customer',
      });
    }
  }
);

/* =========================================================
   POST /api/customers
   ========================================================= */

router.post(
  '/',
  requireAuth,
  async (req, res) => {
    const {
      name,
      phone,
      email,
      address,
      notes,
    } = req.body;

    if (!name?.trim()) {
      return res
        .status(400)
        .json({
          error:
            'Customer name is required',
        });
    }

    try {
      const result =
        await pool.query(
          `
          INSERT INTO customers
          (
            name,
            phone,
            email,
            address,
            notes
          )

          VALUES
          (
            $1, $2, $3, $4, $5
          )

          RETURNING *
          `,
          [
            name.trim(),
            phone?.trim() || null,
            email?.trim() || null,
            address?.trim() || null,
            notes?.trim() || null,
          ]
        );

      const customer =
        result.rows[0];

      res
        .status(201)
        .json({
          id:
            String(customer.id),

          name:
            customer.name,

          phone:
            customer.phone,

          email:
            customer.email,

          address:
            customer.address,

          notes:
            customer.notes,

          createdAt:
            customer.created_at,

          updatedAt:
            customer.updated_at,
        });
    } catch (err) {
      console.error(
        'Create customer error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to create customer',
      });
    }
  }
);

/* =========================================================
   PUT /api/customers/:id
   ========================================================= */

router.put(
  '/:id',
  requireAuth,
  async (req, res) => {
    const {
      name,
      phone,
      email,
      address,
      notes,
    } = req.body;

    if (!name?.trim()) {
      return res
        .status(400)
        .json({
          error:
            'Customer name is required',
        });
    }

    try {
      const result =
        await pool.query(
          `
          UPDATE customers

          SET
            name = $1,
            phone = $2,
            email = $3,
            address = $4,
            notes = $5,
            updated_at = NOW()

          WHERE id = $6

          RETURNING *
          `,
          [
            name.trim(),
            phone?.trim() || null,
            email?.trim() || null,
            address?.trim() || null,
            notes?.trim() || null,
            req.params.id,
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res
          .status(404)
          .json({
            error:
              'Customer not found',
          });
      }

      const customer =
        result.rows[0];

      res.json({
        id:
          String(customer.id),

        name:
          customer.name,

        phone:
          customer.phone,

        email:
          customer.email,

        address:
          customer.address,

        notes:
          customer.notes,

        createdAt:
          customer.created_at,

        updatedAt:
          customer.updated_at,
      });
    } catch (err) {
      console.error(
        'Update customer error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to update customer',
      });
    }
  }
);

/* =========================================================
   DELETE /api/customers/:id
   Admin only

   Sales remain preserved because
   sales.customer_id uses ON DELETE SET NULL.
   ========================================================= */

router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          DELETE FROM customers

          WHERE id = $1

          RETURNING id
          `,
          [req.params.id]
        );

      if (
        result.rows.length === 0
      ) {
        return res
          .status(404)
          .json({
            error:
              'Customer not found',
          });
      }

      res.json({
        message:
          'Customer deleted',
      });
    } catch (err) {
      console.error(
        'Delete customer error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to delete customer',
      });
    }
  }
);

module.exports = router;