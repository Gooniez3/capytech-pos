// temporary: check-sales-schema.js
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
    const result = await pool.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales'
      ORDER BY ordinal_position
    `);

    console.table(result.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();