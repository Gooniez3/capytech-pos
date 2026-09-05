const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/staff - list all staff accounts (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, username, role, created_at FROM users ORDER BY created_at'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/staff - create a new cashier/admin account (admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username, and password are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, username, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, username, role, created_at`,
      [name, username, passwordHash, role === 'admin' ? 'admin' : 'cashier']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/staff/:id/sales-count - quick performance view: how many sales this staff member made
router.get('/:id/sales-count', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS sales_count, COALESCE(SUM(total), 0) AS total_revenue
       FROM sales
       WHERE user_id = $1 AND status = 'completed'`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/staff/:id - deactivate a staff account
// (kept simple: hard delete is risky since sales reference user_id; we block delete if they have sales)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const salesCheck = await pool.query('SELECT COUNT(*) FROM sales WHERE user_id = $1', [req.params.id]);
    if (parseInt(salesCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({
        error: 'Cannot delete a staff account with recorded sales. Consider this a permanent record.',
      });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'Staff account removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
