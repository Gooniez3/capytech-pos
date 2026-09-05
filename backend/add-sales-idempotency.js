require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

async function run() {
  try {
    // Existing sales remain NULL.
    // New checkouts will receive a UUID.
    await pool.query(`
      ALTER TABLE sales
      ADD COLUMN IF NOT EXISTS idempotency_key UUID
    `);

    // PostgreSQL allows existing NULL values,
    // but every real idempotency key must be unique.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        idx_sales_idempotency_key
      ON sales (idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);

    console.log(
      'Sales idempotency column/index created successfully.'
    );
  } catch (error) {
    console.error(
      'Failed to create sales idempotency:',
      error
    );

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();