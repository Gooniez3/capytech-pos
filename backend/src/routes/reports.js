const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const {
  requireAuth,
  requireAdmin,
} = require('../middleware/auth');
const {
  ReportPeriodError,
  resolveReportPeriod,
} = require('../services/report-period');
const {
  FILES: HISTORICAL_FILES,
  MAX_FILE_BYTES: HISTORICAL_MAX_FILE_BYTES,
  HistoricalArchiveError,
  previewArchive,
  importArchive,
  getHistoricalReport,
} = require('../services/historical-sales-service');

const router = express.Router();

const historicalUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: HISTORICAL_MAX_FILE_BYTES,
    files: 3,
    fields: 4,
  },
}).fields(Object.keys(HISTORICAL_FILES).map((name) => ({ name, maxCount: 1 })));

function receiveHistoricalFiles(req, res, next) {
  historicalUpload(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Each historical CSV must be no larger than ${HISTORICAL_MAX_FILE_BYTES} bytes.`
      : 'Upload exactly the three expected historical CSV files.';
    return res.status(400).json({ error: message, code: 'HISTORICAL_UPLOAD_INVALID' });
  });
}

function historicalBuffers(req) {
  const buffers = {};
  for (const [field, definition] of Object.entries(HISTORICAL_FILES)) {
    const files = req.files?.[field];
    if (!Array.isArray(files) || files.length !== 1) {
      throw new HistoricalArchiveError(`${definition.name} is required.`);
    }
    if (files[0].originalname !== definition.name) {
      throw new HistoricalArchiveError(`${field} must be named ${definition.name}.`);
    }
    buffers[field] = files[0].buffer;
  }
  return buffers;
}

function historicalError(res, error, fallback) {
  if (error instanceof HistoricalArchiveError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(fallback, error?.message || error);
  return res.status(500).json({ error: fallback, code: 'HISTORICAL_REPORT_FAILED' });
}

/* =========================================================
   HISTORICAL SALES (isolated, read-only reporting + admin import)
   ========================================================= */

router.get('/historical', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getHistoricalReport(pool, req.query));
  } catch (error) {
    historicalError(res, error, 'Failed to load historical sales.');
  }
});

router.post(
  '/historical/preview',
  requireAuth,
  requireAdmin,
  receiveHistoricalFiles,
  (req, res) => {
    try {
      const { preview } = previewArchive(historicalBuffers(req), process.env.JWT_SECRET);
      res.json(preview);
    } catch (error) {
      historicalError(res, error, 'Failed to preview the historical archive.');
    }
  }
);

router.post(
  '/historical/import',
  requireAuth,
  requireAdmin,
  receiveHistoricalFiles,
  async (req, res) => {
    if (req.body?.confirm !== 'IMPORT ARCHIVED SALES') {
      return res.status(400).json({
        error: 'Explicit import confirmation is required.',
        code: 'HISTORICAL_CONFIRMATION_REQUIRED',
      });
    }
    try {
      const result = await importArchive(pool, historicalBuffers(req), {
        previewToken: req.body.previewToken,
        userId: req.user.id,
        secret: process.env.JWT_SECRET,
      });
      return res.status(result.imported ? 201 : 200).json(result);
    } catch (error) {
      return historicalError(res, error, 'Failed to import the historical archive.');
    }
  }
);

function reportError(res, error, fallback) {
  if (error instanceof ReportPeriodError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

/* =========================================================
   GET /api/reports/summary
   ========================================================= */

router.get(
  '/summary',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const period = await resolveReportPeriod(pool, req.query);
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

      COALESCE(
        SUM(COALESCE(tax, 0)),
        0
      ) AS gross_tax,

      COUNT(*) FILTER (
        WHERE status = 'completed'
      ) AS transactions,

      COALESCE(
        SUM(discount) FILTER (
          WHERE status = 'completed'
        ),
        0
      ) AS discounts

    FROM sales

    WHERE
      status IN (
        'completed',
        'refunded'
      )
      AND created_at >= $1::date
      AND created_at < ($2::date + INTERVAL '1 day')
  `, period.values);
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
            AND s.created_at >= $1::date
            AND s.created_at < ($2::date + INTERVAL '1 day')
        `, period.values);

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
            ) AS refund_amount,

            COALESCE(
              SUM(COALESCE(tax, 0)),
              0
            ) AS refunded_tax

          FROM sales

          WHERE
            status = 'refunded'
            AND refunded_at IS NOT NULL
            AND refunded_at >= $1::date
            AND refunded_at < ($2::date + INTERVAL '1 day')
        `, period.values);

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
            AND s.refunded_at >= $1::date
            AND s.refunded_at < ($2::date + INTERVAL '1 day')
        `, period.values);

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

      const taxCollected =
        Number(
          salesResult.rows[0]
            .gross_tax
        ) -
        Number(
          refundResult.rows[0]
            .refunded_tax
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

      const netOfTax =
        netSales - taxCollected;

      const grossProfit =
        netOfTax - cogs;

      const grossMargin =
        netOfTax !== 0
          ? (
              grossProfit /
              netOfTax
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
  (transactions + refundCount) > 0
    ? (refundCount / (transactions + refundCount)) * 100
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

        taxCollected,

        unitsSold,

        refundCount,

        refundRate,
      });
    } catch (err) {
      reportError(res, err, 'Failed to load report summary');
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
    try {
      const period = await resolveReportPeriod(pool, req.query);
      /* =====================================================
         TODAY → HOURLY
         ===================================================== */

      if (period.trendGrain === 'hourly') {
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
          ) AS gross_sales,

          COALESCE(
            SUM(COALESCE(tax, 0)),
            0
          ) AS gross_tax

        FROM sales

        WHERE
          status IN (
            'completed',
            'refunded'
          )
          AND created_at >= $1::date
          AND created_at < ($2::date + INTERVAL '1 day')

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
          ) AS refund_amount,

          COALESCE(
            SUM(COALESCE(tax, 0)),
            0
          ) AS refunded_tax

        FROM sales

        WHERE
          status = 'refunded'
          AND refunded_at IS NOT NULL
          AND refunded_at >= $1::date
          AND refunded_at < ($2::date + INTERVAL '1 day')

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
          AND s.created_at >= $1::date
          AND s.created_at < ($2::date + INTERVAL '1 day')

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
          AND s.refunded_at >= $1::date
          AND s.refunded_at < ($2::date + INTERVAL '1 day')

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
            gross_sales.gross_tax,
            0
          )
          -
          COALESCE(
            refunds.refunded_tax,
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
    `, period.values);

  return res.json(
    result.rows.map(
      (row) => ({
        date:
          `${period.from}T${String(
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

      if (period.trendGrain === 'daily-week') {
  const result =
    await pool.query(`
      WITH days AS (
        SELECT
          generate_series(
            $1::date,

            $2::date,

            INTERVAL '1 day'
          )::date AS day
      ),

      gross_sales AS (
        SELECT
          created_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS gross_sales,

          COALESCE(
            SUM(COALESCE(tax, 0)),
            0
          ) AS gross_tax

        FROM sales

        WHERE
          status IN (
            'completed',
            'refunded'
          )

          AND created_at >= $1::date
          AND created_at < ($2::date + INTERVAL '1 day')

        GROUP BY
          created_at::date
      ),

      refunds AS (
        SELECT
          refunded_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS refund_amount,

          COALESCE(
            SUM(COALESCE(tax, 0)),
            0
          ) AS refunded_tax

        FROM sales

        WHERE
          status = 'refunded'

          AND refunded_at IS NOT NULL

          AND refunded_at >= $1::date
          AND refunded_at < ($2::date + INTERVAL '1 day')

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

          AND s.created_at >= $1::date
          AND s.created_at < ($2::date + INTERVAL '1 day')

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

          AND s.refunded_at >= $1::date
          AND s.refunded_at < ($2::date + INTERVAL '1 day')

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
            gross_sales.gross_tax,
            0
          )
          -
          COALESCE(
            refunds.refunded_tax,
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
    `, period.values);

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

if (period.trendGrain === 'daily') {
  const result =
    await pool.query(`
      WITH days AS (
        SELECT
          generate_series(
            $1::date,

            $2::date,

            INTERVAL '1 day'
          )::date AS day
      ),

      gross_sales AS (
        SELECT
          created_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS gross_sales,

          COALESCE(
            SUM(COALESCE(tax, 0)),
            0
          ) AS gross_tax

        FROM sales

        WHERE
          status IN (
            'completed',
            'refunded'
          )

          AND created_at >= $1::date
          AND created_at < ($2::date + INTERVAL '1 day')

        GROUP BY
          created_at::date
      ),

      refunds AS (
        SELECT
          refunded_at::date AS day,

          COALESCE(
            SUM(total),
            0
          ) AS refund_amount,

          COALESCE(
            SUM(COALESCE(tax, 0)),
            0
          ) AS refunded_tax

        FROM sales

        WHERE
          status = 'refunded'

          AND refunded_at IS NOT NULL

          AND refunded_at >= $1::date
          AND refunded_at < ($2::date + INTERVAL '1 day')

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

          AND s.created_at >= $1::date
          AND s.created_at < ($2::date + INTERVAL '1 day')

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

          AND s.refunded_at >= $1::date
          AND s.refunded_at < ($2::date + INTERVAL '1 day')

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
            gross_sales.gross_tax,
            0
          )
          -
          COALESCE(
            refunds.refunded_tax,
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
    `, period.values);

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
            $1::date
          ),

          DATE_TRUNC(
            'year',
            $1::date
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
        ) AS gross_sales,

        COALESCE(
          SUM(COALESCE(tax, 0)),
          0
        ) AS gross_tax

      FROM sales

      WHERE
        status IN (
          'completed',
          'refunded'
        )

        AND created_at >= $1::date
        AND created_at < ($2::date + INTERVAL '1 day')

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
        ) AS refund_amount,

        COALESCE(
          SUM(COALESCE(tax, 0)),
          0
        ) AS refunded_tax

      FROM sales

      WHERE
        status = 'refunded'

        AND refunded_at IS NOT NULL

        AND refunded_at >= $1::date
        AND refunded_at < ($2::date + INTERVAL '1 day')

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

        AND s.created_at >= $1::date
        AND s.created_at < ($2::date + INTERVAL '1 day')

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

        AND s.refunded_at >= $1::date
        AND s.refunded_at < ($2::date + INTERVAL '1 day')

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
          gross_sales.gross_tax,
          0
        )
        -
        COALESCE(
          refunds.refunded_tax,
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
  `, period.values);

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
      reportError(res, err, 'Failed to load sales trend');
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
    const limit =
      Math.min(
        Number(
          req.query.limit
        ) || 10,
        50
      );

    try {
      const period = await resolveReportPeriod(pool, req.query);
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
                    (s.total - COALESCE(s.tax, 0)) /
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

              AND s.created_at >= $1::date
              AND s.created_at < ($2::date + INTERVAL '1 day')


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
                      (s.total - COALESCE(s.tax, 0)) /
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

              AND s.refunded_at >= $1::date
              AND s.refunded_at < ($2::date + INTERVAL '1 day')
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

          LIMIT $3
          `,
          [...period.values, limit]
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
      reportError(res, err, 'Failed to load top products');
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
    try {
      const period = await resolveReportPeriod(pool, req.query);
      const result =
        await pool.query(`
          WITH sales_by_method AS (
            SELECT
              payment_method,

              COUNT(*) FILTER (
                WHERE status = 'completed'
              ) AS transactions,

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

              AND created_at >= $1::date
              AND created_at < ($2::date + INTERVAL '1 day')

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

              AND refunded_at >= $1::date
              AND refunded_at < ($2::date + INTERVAL '1 day')

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
        `, period.values);

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
      reportError(res, err, 'Failed to load payment report');
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
    try {
      const period = await resolveReportPeriod(pool, req.query);
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
          AND s.refunded_at >= $1::date
          AND s.refunded_at < ($2::date + INTERVAL '1 day')

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
      `, period.values);

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
      reportError(res, err, 'Failed to load refund report');
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

              pv.product_code AS sku,

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

              p.product_code AS sku,

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
