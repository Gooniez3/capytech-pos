const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/*
 * GET /api/dashboard
 *
 * Real dashboard data:
 * - today's revenue
 * - today's gross profit
 * - transactions
 * - average sale
 * - units sold
 * - gross margin
 * - weekly revenue/profit
 * - top selling variants/products
 * - recent activity
 * - inventory alerts
 * - payment breakdown
 */

router.get('/', requireAuth, async (req, res) => {
  try {
    /* =====================================================
       TODAY SALES STATS
       ===================================================== */

    const statsResult = await pool.query(`
      SELECT
        COALESCE(
          SUM(total) FILTER (
            WHERE
              status = 'completed'
              AND created_at::date = CURRENT_DATE
          ),
          0
        ) AS today_revenue,

        COALESCE(
          SUM(COALESCE(tax, 0)) FILTER (
            WHERE
              status = 'completed'
              AND created_at::date = CURRENT_DATE
          ),
          0
        ) AS today_tax,

        COUNT(*) FILTER (
          WHERE
            status = 'completed'
            AND created_at::date = CURRENT_DATE
        ) AS transactions

      FROM sales
    `);

    const todayRevenue =
      Number(statsResult.rows[0].today_revenue);

    const todayTax =
      Number(statsResult.rows[0].today_tax);

    const transactions =
      Number(statsResult.rows[0].transactions);

    const averageSale =
      transactions > 0
        ? todayRevenue / transactions
        : 0;

    /* =====================================================
       TODAY PROFIT + UNITS SOLD
       ===================================================== */

    const profitResult = await pool.query(`
      SELECT
        COALESCE(
          SUM(
            COALESCE(si.unit_cost, 0) *
            si.quantity
          ),
          0
        ) AS cogs,

        COALESCE(
          SUM(si.quantity),
          0
        ) AS units_sold

      FROM sale_items si

      JOIN sales s
        ON s.id = si.sale_id

      WHERE
        s.status = 'completed'
        AND s.created_at::date = CURRENT_DATE
    `);

    const todayCogs =
      Number(profitResult.rows[0].cogs);

    const unitsSold =
      Number(profitResult.rows[0].units_sold);

    // Tax is collected, not earned. Profit is net-of-tax revenue minus COGS.
    const netOfTax =
      todayRevenue - todayTax;

    const grossProfit =
      netOfTax - todayCogs;

    const grossMargin =
      netOfTax > 0
        ? (grossProfit / netOfTax) * 100
        : 0;

    /* =====================================================
       LOW / OUT OF STOCK
       ===================================================== */

    const inventoryAlertResult = await pool.query(`
      WITH inventory AS (
        SELECT
          p.id,
          p.name,
          p.sku,
          p.low_stock_threshold,

          CASE
            WHEN EXISTS (
              SELECT 1
              FROM product_variants pv
              WHERE
                pv.product_id = p.id
                AND pv.is_active = TRUE
            )

            THEN (
              SELECT
                COALESCE(
                  SUM(pv2.stock_quantity),
                  0
                )
              FROM product_variants pv2
              WHERE
                pv2.product_id = p.id
                AND pv2.is_active = TRUE
            )

            ELSE p.stock_quantity
          END AS stock_quantity

        FROM products p

        WHERE p.is_active = TRUE
      )

      SELECT
        COUNT(*) FILTER (
          WHERE
            stock_quantity > 0
            AND stock_quantity <= low_stock_threshold
        ) AS low_stock_count,

        COUNT(*) FILTER (
          WHERE stock_quantity = 0
        ) AS out_of_stock_count

      FROM inventory
    `);

    const lowStockCount =
      Number(
        inventoryAlertResult.rows[0].low_stock_count
      );

    const outOfStockCount =
      Number(
        inventoryAlertResult.rows[0].out_of_stock_count
      );

    /* =====================================================
       WEEKLY SALES PERFORMANCE
       ===================================================== */

    const revenueSeriesResult = await pool.query(`
      WITH days AS (
        SELECT
          generate_series(
            CURRENT_DATE - INTERVAL '6 days',
            CURRENT_DATE,
            INTERVAL '1 day'
          )::date AS day
      ),

      revenue AS (
        SELECT
          created_at::date AS day,

          SUM(total) AS revenue,

          SUM(COALESCE(tax, 0)) AS tax

        FROM sales

        WHERE
          status = 'completed'
          AND created_at::date >=
            CURRENT_DATE - INTERVAL '6 days'

        GROUP BY
          created_at::date
      ),

      cogs AS (
        SELECT
          s.created_at::date AS day,

          SUM(
            COALESCE(si.unit_cost, 0) *
            si.quantity
          ) AS cogs

        FROM sale_items si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          s.status = 'completed'
          AND s.created_at::date >=
            CURRENT_DATE - INTERVAL '6 days'

        GROUP BY
          s.created_at::date
      )

      SELECT
        TO_CHAR(days.day, 'Dy') AS label,

        COALESCE(
          revenue.revenue,
          0
        ) AS revenue,

        COALESCE(
          revenue.revenue,
          0
        )
        -
        COALESCE(
          revenue.tax,
          0
        )
        -
        COALESCE(
          cogs.cogs,
          0
        ) AS profit,

        COALESCE(
          cogs.cogs,
          0
        ) AS cogs

      FROM days

      LEFT JOIN revenue
        ON revenue.day = days.day

      LEFT JOIN cogs
        ON cogs.day = days.day

      ORDER BY days.day
    `);

    const revenueSeries =
      revenueSeriesResult.rows.map((row) => ({
        label: row.label,
        revenue: Number(row.revenue),
        profit: Number(row.profit),
        cogs: Number(row.cogs),
      }));

    /* =====================================================
       TOP SELLING PRODUCTS / VARIANTS
       ===================================================== */

    const topProductsResult = await pool.query(`
      SELECT
        si.product_id,
        si.variant_id,

        si.product_name,
        si.variant_name,
        si.variant_sku,

        SUM(si.quantity) AS units,

        SUM(
          CASE
            WHEN s.subtotal > 0
            THEN
              si.line_total *
              (
                (s.total - COALESCE(s.tax, 0)) /
                s.subtotal
              )
            ELSE
              si.line_total
          END
        ) AS revenue

      FROM sale_items si

      JOIN sales s
        ON s.id = si.sale_id

      WHERE
        s.status = 'completed'
        AND s.created_at::date >=
          CURRENT_DATE - INTERVAL '6 days'

      GROUP BY
        si.product_id,
        si.variant_id,
        si.product_name,
        si.variant_name,
        si.variant_sku

      ORDER BY
        units DESC,
        revenue DESC

      LIMIT 5
    `);

    const topProducts =
      topProductsResult.rows.map((row) => ({
        productId: String(row.product_id),

        variantId:
          row.variant_id
            ? String(row.variant_id)
            : null,

        name:
          row.variant_name
            ? `${row.product_name} — ${row.variant_name}`
            : row.product_name,

        sku:
          row.variant_sku ?? '',

        units:
          Number(row.units),

        revenue:
          Number(row.revenue),
      }));

    /* =====================================================
       RECENT ACTIVITY
       ===================================================== */

    const recentActivityResult = await pool.query(`
      SELECT
        s.id,
        s.invoice_number,
        s.status,
        s.total,
        s.payment_method,
        s.created_at,

        u.name AS cashier_name,

        COALESCE(
          SUM(si.quantity),
          0
        ) AS item_quantity

      FROM sales s

      LEFT JOIN users u
        ON u.id = s.user_id

      LEFT JOIN sale_items si
        ON si.sale_id = s.id

      GROUP BY
        s.id,
        u.name

      ORDER BY
        s.created_at DESC

      LIMIT 6
    `);

    const recentActivity =
      recentActivityResult.rows.map((row) => ({
        id: String(row.id),

        invoice:
          row.invoice_number,

        status:
          row.status,

        total:
          Number(row.total),

        paymentMethod:
          row.payment_method,

        cashierName:
          row.cashier_name ?? 'Unknown',

        units:
          Number(row.item_quantity),

        date:
          row.created_at,
      }));

    /* =====================================================
       INVENTORY ATTENTION
       ===================================================== */

    const attentionResult = await pool.query(`
      SELECT *
      FROM (
        /*
         * Variant inventory alerts
         */
        SELECT
          p.id AS product_id,
          pv.id AS variant_id,

          p.name AS product_name,
          pv.name AS variant_name,
          pv.sku AS sku,

          pv.stock_quantity AS stock,
          pv.low_stock_threshold AS reorder_level

        FROM product_variants pv

        JOIN products p
          ON p.id = pv.product_id

        WHERE
          p.is_active = TRUE
          AND pv.is_active = TRUE

          AND pv.stock_quantity <=
            pv.low_stock_threshold

        UNION ALL

        /*
         * Normal products without variants
         */
        SELECT
          p.id AS product_id,
          NULL::integer AS variant_id,

          p.name AS product_name,
          NULL::varchar AS variant_name,
          p.sku AS sku,

          p.stock_quantity AS stock,
          p.low_stock_threshold AS reorder_level

        FROM products p

        WHERE
          p.is_active = TRUE

          AND NOT EXISTS (
            SELECT 1
            FROM product_variants pv
            WHERE
              pv.product_id = p.id
              AND pv.is_active = TRUE
          )

          AND p.stock_quantity <=
            p.low_stock_threshold
      ) alerts

      ORDER BY
        stock ASC,
        product_name ASC

      LIMIT 6
    `);

    const attention =
      attentionResult.rows.map((row) => ({
        productId:
          String(row.product_id),

        variantId:
          row.variant_id
            ? String(row.variant_id)
            : null,

        name:
          row.variant_name
            ? `${row.product_name} — ${row.variant_name}`
            : row.product_name,

        sku:
          row.sku,

        stock:
          Number(row.stock),

        reorderLevel:
          Number(row.reorder_level),

        status:
          Number(row.stock) === 0
            ? 'out_of_stock'
            : 'low_stock',
      }));

    /* =====================================================
       PAYMENT BREAKDOWN
       ===================================================== */

    const paymentResult = await pool.query(`
      SELECT
        payment_method,

        COUNT(*) AS transactions,

        COALESCE(
          SUM(total),
          0
        ) AS amount

      FROM sales

      WHERE
        status = 'completed'
        AND created_at::date = CURRENT_DATE

      GROUP BY payment_method

      ORDER BY amount DESC
    `);

    const paymentBreakdown =
      paymentResult.rows.map((row) => ({
        method:
          row.payment_method,

        transactions:
          Number(row.transactions),

        amount:
          Number(row.amount),
      }));

    /* =====================================================
       STORE HEALTH
       ===================================================== */

    let storeHealth = 100;

    storeHealth -=
      Math.min(
        lowStockCount * 4,
        20
      );

    storeHealth -=
      Math.min(
        outOfStockCount * 8,
        30
      );

    if (
      todayRevenue > 0 &&
      grossMargin < 10
    ) {
      storeHealth -= 15;
    }

    storeHealth =
      Math.max(
        0,
        Math.round(storeHealth)
      );

    /* =====================================================
       RESPONSE
       ===================================================== */

    res.json({
      stats: {
        todayRevenue,
        grossProfit,
        grossMargin,
        transactions,
        averageSale,
        unitsSold,
        lowStockCount,
        outOfStockCount,
        storeHealth,
      },

      revenueSeries,

      topProducts,

      recentActivity,

      attention,

      paymentBreakdown,
    });
  } catch (error) {
    console.error(
      'Dashboard error:',
      error
    );

    res.status(500).json({
      error:
        'Failed to load dashboard',
    });
  }
});

module.exports = router;