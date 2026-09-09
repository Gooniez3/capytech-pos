const express = require('express');
const pool = require('../db/pool');
const {
  requireAuth,
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

/* =========================================================
   DATE RANGE HELPERS
   ========================================================= */

function getRangeStart(range) {
  switch (range) {
    case 'today':
      return "CURRENT_DATE";

    case 'week':
      return "CURRENT_DATE - INTERVAL '6 days'";

    case 'month':
      return "CURRENT_DATE - INTERVAL '29 days'";

    case 'year':
      return "DATE_TRUNC('year', CURRENT_DATE)";

    default:
      return "CURRENT_DATE - INTERVAL '29 days'";
  }
}

/* =========================================================
   GET /api/reports/summary
   ========================================================= */

router.get(
  '/summary',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const range = String(
      req.query.range || 'month'
    );

    const rangeStart =
      getRangeStart(range);

    try {
      // ---------------------------------
      // 1. Gross sales + transaction data
      // ---------------------------------
      const salesResult =
  await pool.query(`
    SELECT
      COALESCE(
        SUM(total),
        0
      ) AS gross_sales,

      COUNT(*) AS transactions,

      COALESCE(
        SUM(discount),
        0
      ) AS discounts

    FROM sales

    WHERE
      status IN (
        'completed',
        'refunded'
      )
      AND created_at::date >=
        ${rangeStart}
  `);
      // ---------------------------------
      // 2. Gross COGS + gross units sold
      // ---------------------------------
      const grossCostResult =
        await pool.query(`
          SELECT
            COALESCE(
              SUM(
                si.unit_cost *
                si.quantity
              ),
              0
            ) AS gross_cogs,

            COALESCE(
              SUM(si.quantity),
              0
            ) AS gross_units_sold

          FROM sale_items si

          JOIN sales s
            ON s.id = si.sale_id

          WHERE
            s.status IN (
              'completed',
              'refunded'
            )
            AND s.created_at::date >=
              ${rangeStart}
        `);

      // ---------------------------------
      // 3. Refund amount
      // Refunds belong to refunded_at date
      // ---------------------------------
      const refundResult =
        await pool.query(`
          SELECT
            COUNT(*) AS refund_count,

            COALESCE(
              SUM(total),
              0
            ) AS refund_amount

          FROM sales

          WHERE
            status = 'refunded'
            AND refunded_at IS NOT NULL
            AND refunded_at::date >=
              ${rangeStart}
        `);

      // ---------------------------------
      // 4. Refunded COGS
      // Reverse cost on refund date
      // ---------------------------------
      const refundedCostResult =
        await pool.query(`
          SELECT
            COALESCE(
              SUM(
                si.unit_cost *
                si.quantity
              ),
              0
            ) AS refunded_cogs,

            COALESCE(
              SUM(si.quantity),
              0
            ) AS refunded_units

          FROM sale_items si

          JOIN sales s
            ON s.id = si.sale_id

          WHERE
            s.status = 'refunded'
            AND s.refunded_at IS NOT NULL
            AND s.refunded_at::date >=
              ${rangeStart}
        `);

      // ---------------------------------
      // 5. Calculate final report values
      // ---------------------------------
      const grossSales =
        Number(
          salesResult.rows[0]
            .gross_sales
        );

      const refundAmount =
        Number(
          refundResult.rows[0]
            .refund_amount
        );

      const netSales =
        grossSales - refundAmount;

      const grossCogs =
        Number(
          grossCostResult.rows[0]
            .gross_cogs
        );

      const refundedCogs =
        Number(
          refundedCostResult.rows[0]
            .refunded_cogs
        );

      const cogs =
        grossCogs - refundedCogs;

      const grossProfit =
        netSales - cogs;

      const grossMargin =
        netSales !== 0
          ? (
              grossProfit /
              netSales
            ) * 100
          : 0;

      const unitsSold =
        Number(
          grossCostResult.rows[0]
            .gross_units_sold
        ) -
        Number(
          refundedCostResult.rows[0]
            .refunded_units
        );

       const transactions =
  Number(
    salesResult.rows[0]
      .transactions
  );

const averageSale =
  transactions > 0
    ? netSales / transactions
    : 0;

const refundCount =
  Number(
    refundResult.rows[0]
      .refund_count
  );

const refundRate =
  transactions > 0
    ? (refundCount / transactions) * 100
    : 0; 

      // ---------------------------------
      // 6. Response
      // ---------------------------------
      res.json({
        grossSales,

        refundAmount,

        netSales,

        grossCogs,

        refundedCogs,

        cogs,

        grossProfit,

        grossMargin,

        transactions,

        averageSale,

        discounts:
          Number(
            salesResult.rows[0]
              .discounts
          ),

        unitsSold,

        refundCount,

        refundRate,
      });
    } catch (err) {
      console.error(
        'Reports summary error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to load report summary',
      });
    }
  }
);

/* =========================================================
   GET /api/reports/sales-trend
   ========================================================= */

router.get(
  '/sales-trend',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const range = String(
      req.query.range || 'month'
    );

    try {
      /* =====================================================
         TODAY → HOURLY
         ===================================================== */

      if (range === 'today') {
  const result =
    await pool.query(`
      WITH hours AS (
        SELECT
          generate_series(
            0,
            23
          ) AS hour
      ),

      gross_sales AS (
        SELECT
          EXTRACT(
            HOUR FROM created_at
          )::integer AS hour,

          COALESCE(
            SUM(total),
            0
          ) AS gross_sales

        FROM sales

        WHERE
          status IN (
            'completed',
            'refunded'
          )
          AND created_at::date =
            CURRENT_DATE

        GROUP BY
          EXTRACT(
            HOUR FROM created_at
          )
      ),

      refunds AS (
        SELECT
          EXTRACT(
            HOUR FROM refunded_at
          )::integer AS hour,

          COALESCE(
            SUM(total),
            0
          ) AS refund_amount

        FROM sales

        WHERE
          status = 'refunded'
          AND refunded_at IS NOT NULL
          AND refunded_at::date =
            CURRENT_DATE

        GROUP BY
          EXTRACT(
            HOUR FROM refunded_at
          )
      ),

      gross_cogs AS (
        SELECT
          EXTRACT(
            HOUR FROM s.created_at
          )::integer AS hour,

          COALESCE(
            SUM(
              si.unit_cost *
              si.quantity
            ),
            0
          ) AS gross_cogs

        FROM sale_items si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          s.status IN (
            'completed',
            'refunded'
          )
          AND s.created_at::date =
            CURRENT_DATE

        GROUP BY
          EXTRACT(
            HOUR FROM s.created_at
          )
      ),

      refunded_cogs AS (
        SELECT
          EXTRACT(
            HOUR FROM s.refunded_at
          )::integer AS hour,

          COALESCE(
            SUM(
              si.unit_cost *
              si.quantity
            ),
            0
          ) AS refunded_cogs

        FROM sale_items si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          s.status = 'refunded'
          AND s.refunded_at IS NOT NULL
          AND s.refunded_at::date =
            CURRENT_DATE

        GROUP BY
          EXTRACT(
            HOUR FROM s.refunded_at
          )
      )

      SELECT
        hours.hour,

        LPAD(
          hours.hour::text,
          2,
          '0'
        ) || ':00' AS label,

        COALESCE(
          gross_sales.gross_sales,
          0
        )
        -
        COALESCE(
          refunds.refund_amount,
          0
        ) AS revenue,

        (
          COALESCE(
            gross_sales.gross_sales,
            0
          )
          -
          COALESCE(
            refunds.refund_amount,
            0
          )
        )
        -
        (
          COALESCE(
            gross_cogs.gross_cogs,
            0
          )
          -
          COALESCE(
            refunded_cogs.refunded_cogs,
            0
          )
        ) AS profit,

        COALESCE(
          gross_cogs.gross_cogs,
          0
        )
        -
        COALESCE(
          refunded_cogs.refunded_cogs,
          0
        ) AS cogs

      FROM hours

      LEFT JOIN gross_sales
        ON gross_sales.hour =
          hours.hour

      LEFT JOIN refunds
        ON refunds.hour =
          hours.hour

      LEFT JOIN gross_cogs
        ON gross_cogs.hour =
          hours.hour

      LEFT JOIN refunded_cogs
        ON refunded_cogs.hour =
          hours.hour

      ORDER BY
        hours.hour
    `);

  return res.json(
    result.rows.map(
      (row) => ({
        date:
          `${new Date()
            .toISOString()
            .slice(0, 10)}T${String(
            row.hour
          ).padStart(
            2,
            '0'
          )}:00:00`,

        label:
          row.label,

        revenue:
          Number(
            row.revenue
          ),

        profit:
          Number(
            row.profit
          ),

        cogs:
          Number(
            row.cogs
          ),
      })
    )
  );
}

      /* =====================================================
         7 DAYS → DAILY
         ===================================================== */

      if (range === 'week') {
  const result =
    await pool.query(`
      WITH days AS (
        SELECT
          generate_series(
            CURRENT_DATE -
              INTERVAL '6 days',

            CURRENT_DATE,

            INTERVAL '1 day'
          )::date AS day
      ),

      gross_sales AS (
        SELECT
          created_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS gross_sales

        FROM sales

        WHERE
          status IN (
            'completed',
            'refunded'
          )

          AND created_at::date >=
            CURRENT_DATE -
              INTERVAL '6 days'

        GROUP BY
          created_at::date
      ),

      refunds AS (
        SELECT
          refunded_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS refund_amount

        FROM sales

        WHERE
          status = 'refunded'

          AND refunded_at IS NOT NULL

          AND refunded_at::date >=
            CURRENT_DATE -
              INTERVAL '6 days'

        GROUP BY
          refunded_at::date
      ),

      gross_cogs AS (
        SELECT
          s.created_at::date AS day,

          COALESCE(
            SUM(
              si.unit_cost *
              si.quantity
            ),
            0
          ) AS gross_cogs

        FROM sale_items si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          s.status IN (
            'completed',
            'refunded'
          )

          AND s.created_at::date >=
            CURRENT_DATE -
              INTERVAL '6 days'

        GROUP BY
          s.created_at::date
      ),

      refunded_cogs AS (
        SELECT
          s.refunded_at::date AS day,

          COALESCE(
            SUM(
              si.unit_cost *
              si.quantity
            ),
            0
          ) AS refunded_cogs

        FROM sale_items si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          s.status = 'refunded'

          AND s.refunded_at IS NOT NULL

          AND s.refunded_at::date >=
            CURRENT_DATE -
              INTERVAL '6 days'

        GROUP BY
          s.refunded_at::date
      )

      SELECT
        days.day AS date,

        TO_CHAR(
          days.day,
          'Dy'
        ) AS label,

        COALESCE(
          gross_sales.gross_sales,
          0
        )
        -
        COALESCE(
          refunds.refund_amount,
          0
        ) AS revenue,

        (
          COALESCE(
            gross_sales.gross_sales,
            0
          )
          -
          COALESCE(
            refunds.refund_amount,
            0
          )
        )
        -
        (
          COALESCE(
            gross_cogs.gross_cogs,
            0
          )
          -
          COALESCE(
            refunded_cogs.refunded_cogs,
            0
          )
        ) AS profit,

        COALESCE(
          gross_cogs.gross_cogs,
          0
        )
        -
        COALESCE(
          refunded_cogs.refunded_cogs,
          0
        ) AS cogs

      FROM days

      LEFT JOIN gross_sales
        ON gross_sales.day =
          days.day

      LEFT JOIN refunds
        ON refunds.day =
          days.day

      LEFT JOIN gross_cogs
        ON gross_cogs.day =
          days.day

      LEFT JOIN refunded_cogs
        ON refunded_cogs.day =
          days.day

      ORDER BY
        days.day
    `);

  return res.json(
    result.rows.map(
      (row) => ({
        date:
          row.date,

        label:
          row.label,

        revenue:
          Number(
            row.revenue
          ),

        profit:
          Number(
            row.profit
          ),

        cogs:
          Number(
            row.cogs
          ),
      })
    )
  );
}

      /* =====================================================
   30 DAYS → DAILY
   ===================================================== */

if (range === 'month') {
  const result =
    await pool.query(`
      WITH days AS (
        SELECT
          generate_series(
            CURRENT_DATE -
              INTERVAL '29 days',

            CURRENT_DATE,

            INTERVAL '1 day'
          )::date AS day
      ),

      gross_sales AS (
        SELECT
          created_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS gross_sales

        FROM sales

        WHERE
          status IN (
            'completed',
            'refunded'
          )

          AND created_at::date >=
            CURRENT_DATE -
              INTERVAL '29 days'

        GROUP BY
          created_at::date
      ),

      refunds AS (
        SELECT
          refunded_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS refund_amount

        FROM sales

        WHERE
          status = 'refunded'

          AND refunded_at IS NOT NULL

          AND refunded_at::date >=
            CURRENT_DATE -
              INTERVAL '29 days'

        GROUP BY
          refunded_at::date
      ),

      gross_cogs AS (
        SELECT
          s.created_at::date AS day,

          COALESCE(
            SUM(
              si.unit_cost *
              si.quantity
            ),
            0
          ) AS gross_cogs

        FROM sale_items si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          s.status IN (
            'completed',
            'refunded'
          )

          AND s.created_at::date >=
            CURRENT_DATE -
              INTERVAL '29 days'

        GROUP BY
          s.created_at::date
      ),

      refunded_cogs AS (
        SELECT
          s.refunded_at::date AS day,

          COALESCE(
            SUM(
              si.unit_cost *
              si.quantity
            ),
            0
          ) AS refunded_cogs

        FROM sale_items si

        JOIN sales s
          ON s.id = si.sale_id

        WHERE
          s.status = 'refunded'

          AND s.refunded_at IS NOT NULL

          AND s.refunded_at::date >=
            CURRENT_DATE -
              INTERVAL '29 days'

        GROUP BY
          s.refunded_at::date
      )

      SELECT
        days.day AS date,

        TO_CHAR(
          days.day,
          'Mon DD'
        ) AS label,

        COALESCE(
          gross_sales.gross_sales,
          0
        )
        -
        COALESCE(
          refunds.refund_amount,
          0
        ) AS revenue,

        (
          COALESCE(
            gross_sales.gross_sales,
            0
          )
          -
          COALESCE(
            refunds.refund_amount,
            0
          )
        )
        -
        (
          COALESCE(
            gross_cogs.gross_cogs,
            0
          )
          -
          COALESCE(
            refunded_cogs.refunded_cogs,
            0
          )
        ) AS profit,

        COALESCE(
          gross_cogs.gross_cogs,
          0
        )
        -
        COALESCE(
          refunded_cogs.refunded_cogs,
          0
        ) AS cogs

      FROM days

      LEFT JOIN gross_sales
        ON gross_sales.day =
          days.day

      LEFT JOIN refunds
        ON refunds.day =
          days.day

      LEFT JOIN gross_cogs
        ON gross_cogs.day =
          days.day

      LEFT JOIN refunded_cogs
        ON refunded_cogs.day =
          days.day

      ORDER BY
        days.day
    `);

  return res.json(
    result.rows.map(
      (row) => ({
        date:
          row.date,

        label:
          row.label,

        revenue:
          Number(
            row.revenue
          ),

        profit:
          Number(
            row.profit
          ),

        cogs:
          Number(
            row.cogs
          ),
      })
    )
  );
}

      /* =====================================================
   THIS YEAR → MONTHLY
   ===================================================== */

const result =
  await pool.query(`
    WITH months AS (
      SELECT
        generate_series(
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          ),

          DATE_TRUNC(
            'year',
            CURRENT_DATE
          ) +
            INTERVAL '11 months',

          INTERVAL '1 month'
        )::date AS month
    ),

    gross_sales AS (
      SELECT
        DATE_TRUNC(
          'month',
          created_at
        )::date AS month,

        COALESCE(
          SUM(total),
          0
        ) AS gross_sales

      FROM sales

      WHERE
        status IN (
          'completed',
          'refunded'
        )

        AND created_at >=
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          )

        AND created_at <
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          ) +
            INTERVAL '1 year'

      GROUP BY
        DATE_TRUNC(
          'month',
          created_at
        )
    ),

    refunds AS (
      SELECT
        DATE_TRUNC(
          'month',
          refunded_at
        )::date AS month,

        COALESCE(
          SUM(total),
          0
        ) AS refund_amount

      FROM sales

      WHERE
        status = 'refunded'

        AND refunded_at IS NOT NULL

        AND refunded_at >=
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          )

        AND refunded_at <
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          ) +
            INTERVAL '1 year'

      GROUP BY
        DATE_TRUNC(
          'month',
          refunded_at
        )
    ),

    gross_cogs AS (
      SELECT
        DATE_TRUNC(
          'month',
          s.created_at
        )::date AS month,

        COALESCE(
          SUM(
            si.unit_cost *
            si.quantity
          ),
          0
        ) AS gross_cogs

      FROM sale_items si

      JOIN sales s
        ON s.id = si.sale_id

      WHERE
        s.status IN (
          'completed',
          'refunded'
        )

        AND s.created_at >=
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          )

        AND s.created_at <
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          ) +
            INTERVAL '1 year'

      GROUP BY
        DATE_TRUNC(
          'month',
          s.created_at
        )
    ),

    refunded_cogs AS (
      SELECT
        DATE_TRUNC(
          'month',
          s.refunded_at
        )::date AS month,

        COALESCE(
          SUM(
            si.unit_cost *
            si.quantity
          ),
          0
        ) AS refunded_cogs

      FROM sale_items si

      JOIN sales s
        ON s.id = si.sale_id

      WHERE
        s.status = 'refunded'

        AND s.refunded_at IS NOT NULL

        AND s.refunded_at >=
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          )

        AND s.refunded_at <
          DATE_TRUNC(
            'year',
            CURRENT_DATE
          ) +
            INTERVAL '1 year'

      GROUP BY
        DATE_TRUNC(
          'month',
          s.refunded_at
        )
    )

    SELECT
      months.month AS date,

      TO_CHAR(
        months.month,
        'Mon'
      ) AS label,

      COALESCE(
        gross_sales.gross_sales,
        0
      )
      -
      COALESCE(
        refunds.refund_amount,
        0
      ) AS revenue,

      (
        COALESCE(
          gross_sales.gross_sales,
          0
        )
        -
        COALESCE(
          refunds.refund_amount,
          0
        )
      )
      -
      (
        COALESCE(
          gross_cogs.gross_cogs,
          0
        )
        -
        COALESCE(
          refunded_cogs.refunded_cogs,
          0
        )
      ) AS profit,

      COALESCE(
        gross_cogs.gross_cogs,
        0
      )
      -
      COALESCE(
        refunded_cogs.refunded_cogs,
        0
      ) AS cogs

    FROM months

    LEFT JOIN gross_sales
      ON gross_sales.month =
        months.month

    LEFT JOIN refunds
      ON refunds.month =
        months.month

    LEFT JOIN gross_cogs
      ON gross_cogs.month =
        months.month

    LEFT JOIN refunded_cogs
      ON refunded_cogs.month =
        months.month

    ORDER BY
      months.month
  `);

return res.json(
  result.rows.map(
    (row) => ({
      date:
        row.date,

      label:
        row.label,

      revenue:
        Number(
          row.revenue
        ),

      profit:
        Number(
          row.profit
        ),

      cogs:
        Number(
          row.cogs
        ),
    })
  )
);
    } catch (err) {
      console.error(
        'Sales trend error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to load sales trend',
      });
    }
  }
);

/* =========================================================
   GET /api/reports/top-products
   ========================================================= */

router.get(
  '/top-products',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const range = String(
      req.query.range || 'month'
    );

    const rangeStart =
      getRangeStart(range);

    const limit =
      Math.min(
        Number(
          req.query.limit
        ) || 10,
        50
      );

    try {
      const result =
        await pool.query(
          `
          WITH product_events AS (

            /* ---------------------------------
               SALES
               --------------------------------- */
            SELECT
              si.product_id,
              si.variant_id,
              si.product_name,
              si.variant_name,
              si.variant_sku,

              si.quantity
                AS units,

              CASE
                WHEN s.subtotal > 0
                THEN
                  si.line_total *
                  (
                    s.total /
                    s.subtotal
                  )
                ELSE
                  si.line_total
              END
                AS revenue,

              (
                si.unit_cost *
                si.quantity
              ) AS cogs

            FROM sale_items si

            JOIN sales s
              ON s.id = si.sale_id

            WHERE
              s.status IN (
                'completed',
                'refunded'
              )

              AND s.created_at::date >=
                ${rangeStart}


            UNION ALL


            /* ---------------------------------
               REFUND REVERSALS
               --------------------------------- */
            SELECT
              si.product_id,
              si.variant_id,
              si.product_name,
              si.variant_name,
              si.variant_sku,

              -si.quantity
                AS units,

              -(
                CASE
                  WHEN s.subtotal > 0
                  THEN
                    si.line_total *
                    (
                      s.total /
                      s.subtotal
                    )
                  ELSE
                    si.line_total
                END
              ) AS revenue,

              -(
                si.unit_cost *
                si.quantity
              ) AS cogs

            FROM sale_items si

            JOIN sales s
              ON s.id = si.sale_id

            WHERE
              s.status = 'refunded'

              AND s.refunded_at
                IS NOT NULL

              AND
                s.refunded_at::date >=
                  ${rangeStart}
          ),

          totals AS (
            SELECT
              product_id,
              variant_id,
              product_name,
              variant_name,
              variant_sku,

              SUM(units)
                AS units,

              SUM(revenue)
                AS revenue,

              SUM(cogs)
                AS cogs

            FROM product_events

            GROUP BY
              product_id,
              variant_id,
              product_name,
              variant_name,
              variant_sku
          )

          SELECT
            product_id,
            variant_id,
            product_name,
            variant_name,
            variant_sku,

            units,
            revenue,
            cogs,

            revenue - cogs
              AS profit

          FROM totals

          WHERE
            units <> 0
            OR revenue <> 0
            OR cogs <> 0

          ORDER BY
            revenue DESC,
            units DESC

          LIMIT $1
          `,
          [limit]
        );

      res.json(
        result.rows.map(
          (row) => ({
            productId:
              row.product_id !== null
                ? String(
                    row.product_id
                  )
                : `deleted-${row.product_name}-${row.variant_sku ?? 'product'}`,

            variantId:
              row.variant_id !== null
                ? String(
                    row.variant_id
                  )
                : null,

            name:
              row.variant_name
                ? `${row.product_name} — ${row.variant_name}`
                : row.product_name,

            sku:
              row.variant_sku ??
              '',

            units:
              Number(
                row.units
              ),

            revenue:
              Number(
                row.revenue
              ),

            cogs:
              Number(
                row.cogs
              ),

            profit:
              Number(
                row.profit
              ),
          })
        )
      );
    } catch (err) {
      console.error(
        'Top products error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to load top products',
      });
    }
  }
);

/* =========================================================
   GET /api/reports/payment-methods
   ========================================================= */

router.get(
  '/payment-methods',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const range = String(
      req.query.range || 'month'
    );

    const rangeStart =
      getRangeStart(range);

    try {
      const result =
        await pool.query(`
          WITH sales_by_method AS (
            SELECT
              payment_method,

              COUNT(*) AS transactions,

              COALESCE(
                SUM(total),
                0
              ) AS gross_amount

            FROM sales

            WHERE
              status IN (
                'completed',
                'refunded'
              )

              AND created_at::date >=
                ${rangeStart}

            GROUP BY
              payment_method
          ),

          refunds_by_method AS (
            SELECT
              payment_method,

              COALESCE(
                SUM(total),
                0
              ) AS refund_amount

            FROM sales

            WHERE
              status = 'refunded'

              AND refunded_at IS NOT NULL

              AND refunded_at::date >=
                ${rangeStart}

            GROUP BY
              payment_method
          )

          SELECT
            COALESCE(
              s.payment_method,
              r.payment_method
            ) AS payment_method,

            COALESCE(
              s.transactions,
              0
            ) AS transactions,

            COALESCE(
              s.gross_amount,
              0
            )
            -
            COALESCE(
              r.refund_amount,
              0
            ) AS amount

          FROM sales_by_method s

          FULL OUTER JOIN
            refunds_by_method r
            ON r.payment_method =
              s.payment_method

          ORDER BY
            amount DESC
        `);

      res.json(
        result.rows.map(
          (row) => ({
            method:
              row.payment_method,

            transactions:
              Number(
                row.transactions
              ),

            amount:
              Number(
                row.amount
              ),
          })
        )
      );
    } catch (err) {
      console.error(
        'Payment report error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to load payment report',
      });
    }
  }
);

/* =========================================================
   GET /api/reports/refunds
   ========================================================= */

router.get(
  '/refunds',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const range = String(req.query.range || 'month');
    const rangeStart = getRangeStart(range);

    try {
      const result = await pool.query(`
        SELECT
          s.id,
          s.invoice_number,
          s.total,
          s.payment_method,
          s.created_at,
          s.refunded_at,
          s.refund_reason,
          u.name AS cashier_name,

          COALESCE(
            json_agg(
              json_build_object(
                'productName', si.product_name,
                'variantName', si.variant_name,
                'quantity', si.quantity
              )
              ORDER BY si.id
            ) FILTER (WHERE si.id IS NOT NULL),
            '[]'::json
          ) AS items

        FROM sales s

        LEFT JOIN users u
          ON u.id = s.user_id

        LEFT JOIN sale_items si
          ON si.sale_id = s.id

        WHERE
          s.status = 'refunded'
          AND s.refunded_at IS NOT NULL
          AND s.refunded_at::date >= ${rangeStart}

        GROUP BY
          s.id,
          s.invoice_number,
          s.total,
          s.payment_method,
          s.created_at,
          s.refunded_at,
          s.refund_reason,
          u.name

        ORDER BY
          s.refunded_at DESC

        LIMIT 50
      `);

      res.json(
        result.rows.map((row) => ({
          id: String(row.id),

          invoice: row.invoice_number,

          total: Number(row.total),

          paymentMethod: row.payment_method,

          cashierName:
            row.cashier_name ?? 'Unknown',

          // Actual time the refund happened
          date: row.refunded_at,

          // Original transaction time
          originalSaleDate: row.created_at,

          reason: row.refund_reason ?? null,

          // Products returned in this refund
          items: Array.isArray(row.items)
            ? row.items.map((item) => ({
                productName: item.productName,
                variantName: item.variantName ?? null,
                quantity: Number(item.quantity),
              }))
            : [],
        }))
      );
    } catch (err) {
      console.error(
        'Refund report error:',
        err
      );

      res.status(500).json({
        error: 'Failed to load refund report',
      });
    }
  }
);

/* =========================================================
   GET /api/reports/low-stock
   ========================================================= */

router.get(
  '/low-stock',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT *
          FROM (
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
              ON p.id =
                pv.product_id

            WHERE
              p.is_active = TRUE
              AND pv.is_active =
                TRUE
              AND pv.stock_quantity <=
                pv.low_stock_threshold

            UNION ALL

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
                  pv.product_id =
                    p.id
                  AND pv.is_active =
                    TRUE
              )

              AND p.stock_quantity <=
                p.low_stock_threshold
          ) inventory

          ORDER BY
            stock ASC,
            product_name ASC
        `);

      res.json(
        result.rows.map(
          (row) => ({
            productId:
              String(
                row.product_id
              ),

            variantId:
              row.variant_id
                ? String(
                    row.variant_id
                  )
                : null,

            name:
              row.variant_name
                ? `${row.product_name} — ${row.variant_name}`
                : row.product_name,

            sku:
              row.sku,

            stock:
              Number(
                row.stock
              ),

            reorderLevel:
              Number(
                row.reorder_level
              ),

            status:
              Number(
                row.stock
              ) === 0
                ? 'out_of_stock'
                : 'low_stock',
          })
        )
      );
    } catch (err) {
      console.error(
        'Low stock report error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to load low stock report',
      });
    }
  }
);

/* =========================================================
   GET /api/reports/sales-history
   ========================================================= */

router.get(
  '/sales-history',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const page =
      Math.max(
        Number(
          req.query.page
        ) || 1,
        1
      );

    const limit =
      Math.min(
        Number(
          req.query.limit
        ) || 20,
        100
      );

    const offset =
      (page - 1) *
      limit;

    try {
      const result =
        await pool.query(
          `
          SELECT
            s.*,

            u.name AS cashier_name

          FROM sales s

          LEFT JOIN users u
            ON s.user_id =
              u.id

          ORDER BY
            s.created_at DESC

          LIMIT $1
          OFFSET $2
          `,
          [
            limit,
            offset,
          ]
        );

      const countResult =
        await pool.query(
          `
          SELECT
            COUNT(*)

          FROM sales
          `
        );

      res.json({
        sales:
          result.rows,

        total:
          Number(
            countResult.rows[0]
              .count
          ),

        page,

        limit,
      });
    } catch (err) {
      console.error(
        'Sales history report error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to load sales history',
      });
    }
  }
);

module.exports = router;