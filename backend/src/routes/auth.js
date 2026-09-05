const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

require('dotenv').config();

const router = express.Router();

/* =========================================================
   LOGIN RATE LIMIT
   ========================================================= */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,

  message: {
    error:
      'Too many login attempts. Try again later.',
  },
});

/* =========================================================
   POST /api/auth/login
   ========================================================= */

router.post(
  '/login',
  loginLimiter,
  async (req, res) => {
    const {
      username,
      password,
    } = req.body;

    if (
      !username ||
      !password
    ) {
      return res
        .status(400)
        .json({
          error:
            'Username and password required',
        });
    }

    try {
      const result =
        await pool.query(
          `
            SELECT *
            FROM users
            WHERE username = $1
          `,
          [username]
        );

      const user =
        result.rows[0];

      if (!user) {
        return res
          .status(401)
          .json({
            error:
              'Invalid credentials',
          });
      }

      const validPassword =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!validPassword) {
        return res
          .status(401)
          .json({
            error:
              'Invalid credentials',
          });
      }

      const token =
        jwt.sign(
          {
            id:
              user.id,

            username:
              user.username,

            role:
              user.role,
          },

          process.env.JWT_SECRET,

          {
            expiresIn:
              '12h',
          }
        );

      res.json({
        token,

        user: {
          id:
            user.id,

          name:
            user.name,

          username:
            user.username,

          role:
            user.role,
        },
      });
    } catch (err) {
      console.error(
        'Login error:',
        err
      );

      res
        .status(500)
        .json({
          error:
            'Server error',
        });
    }
  }
);

/* =========================================================
   GET /api/auth/profile
   ========================================================= */

router.get(
  '/profile',
  requireAuth,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
            SELECT
              id,
              name,
              username,
              role

            FROM users

            WHERE id = $1
          `,
          [
            req.user.id,
          ]
        );

      const user =
        result.rows[0];

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              'User not found',
          });
      }

      res.json({
        id:
          user.id,

        name:
          user.name,

        username:
          user.username,

        role:
          user.role,
      });
    } catch (error) {
      console.error(
        'Load profile error:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'Failed to load profile',
        });
    }
  }
);

/* =========================================================
   PATCH /api/auth/profile
   ========================================================= */

router.patch(
  '/profile',
  requireAuth,
  async (req, res) => {
    const name =
      typeof req.body?.name ===
      'string'
        ? req.body.name.trim()
        : '';

    if (!name) {
      return res
        .status(400)
        .json({
          error:
            'Full name is required',
        });
    }

    if (
      name.length > 100
    ) {
      return res
        .status(400)
        .json({
          error:
            'Full name is too long',
        });
    }

    try {
      const result =
        await pool.query(
          `
            UPDATE users

            SET
              name = $1

            WHERE id = $2

            RETURNING
              id,
              name,
              username,
              role
          `,
          [
            name,
            req.user.id,
          ]
        );

      const user =
        result.rows[0];

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              'User not found',
          });
      }

      res.json({
        id:
          user.id,

        name:
          user.name,

        username:
          user.username,

        role:
          user.role,
      });
    } catch (error) {
      console.error(
        'Update profile error:',
        error
      );

      res
        .status(500)
        .json({
          error:
            'Failed to update profile',
        });
    }
  }
);

/* =========================================================
   PATCH /api/auth/password
   ========================================================= */

router.patch(
  '/password',
  requireAuth,
  async (req, res) => {
    const currentPassword =
      typeof req.body?.currentPassword === 'string'
        ? req.body.currentPassword
        : '';

    const newPassword =
      typeof req.body?.newPassword === 'string'
        ? req.body.newPassword
        : '';

    if (!currentPassword) {
      return res.status(400).json({
        error: 'Current password is required',
      });
    }

    if (!newPassword) {
      return res.status(400).json({
        error: 'New password is required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: 'New password must be at least 8 characters',
      });
    }

    if (newPassword.length > 128) {
      return res.status(400).json({
        error: 'New password is too long',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'New password must be different from your current password',
      });
    }

    try {
      const result = await pool.query(
        `
          SELECT
            id,
            password_hash

          FROM users

          WHERE id = $1
        `,
        [req.user.id]
      );

      const user = result.rows[0];

      if (!user) {
        return res.status(404).json({
          error: 'User not found',
        });
      }

      const validCurrentPassword =
        await bcrypt.compare(
          currentPassword,
          user.password_hash
        );

      if (!validCurrentPassword) {
        return res.status(400).json({
          error: 'Current password is incorrect',
        });
      }

      const sameAsCurrent =
        await bcrypt.compare(
          newPassword,
          user.password_hash
        );

      if (sameAsCurrent) {
        return res.status(400).json({
          error: 'New password must be different from your current password',
        });
      }

      const newPasswordHash =
        await bcrypt.hash(
          newPassword,
          10
        );

      await pool.query(
        `
          UPDATE users

          SET
            password_hash = $1

          WHERE id = $2
        `,
        [
          newPasswordHash,
          req.user.id,
        ]
      );

      res.json({
        message:
          'Password updated successfully',
      });
    } catch (error) {
      console.error(
        'Update password error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to update password',
      });
    }
  }
);

module.exports = router;