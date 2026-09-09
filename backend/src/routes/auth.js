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

function signUserToken(user, rememberMe = false) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      // Shop till stays signed in overnight when Remember me is on.
      expiresIn: rememberMe ? '30d' : '12h',
    }
  );
}

function userPayload(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  };
}

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
      rememberMe,
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

      res.json({
        token: signUserToken(user, Boolean(rememberMe)),
        user: userPayload(user),
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
   GET /api/auth/setup-status
   First shop owner creates their own login when no users exist.
   ========================================================= */

router.get(
  '/setup-status',
  async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM users'
      );

      res.json({
        needsSetup: result.rows[0].count === 0,
      });
    } catch (err) {
      console.error('Setup status error:', err);
      res.status(500).json({
        error: 'Server error',
      });
    }
  }
);

router.post(
  '/setup',
  loginLimiter,
  async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!name || !username || !password) {
      return res.status(400).json({
        error: 'Name, username, and password are required',
      });
    }

    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({
        error: 'Username must be between 3 and 50 characters',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN EXCLUSIVE MODE');

      const existing = await client.query(
        'SELECT COUNT(*)::int AS count FROM users'
      );

      if (existing.rows[0].count > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'The shop already has an owner account. Sign in instead.',
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const created = await client.query(
        `
          INSERT INTO users (name, username, password_hash, role)
          VALUES ($1, $2, $3, 'admin')
          RETURNING id, name, username, role
        `,
        [name, username, passwordHash]
      );

      await client.query('COMMIT');

      const user = created.rows[0];

      res.status(201).json({
        token: signUserToken(user, true),
        user: userPayload(user),
      });
    } catch (err) {
      await client.query('ROLLBACK');

      if (err.code === '23505') {
        return res.status(409).json({
          error: 'That username is already taken',
        });
      }

      console.error('Setup error:', err);
      res.status(500).json({
        error: 'Failed to create the owner account',
      });
    } finally {
      client.release();
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