const express = require('express');

const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/* =========================================================
   GET /api/notifications/preferences
   ========================================================= */

router.get(
  '/preferences',
  requireAuth,
  async (req, res) => {
    try {
      /*
       * Ensure every authenticated user has
       * a preferences row.
       */
      await pool.query(
        `
          INSERT INTO notification_preferences (
            user_id
          )
          VALUES ($1)
          ON CONFLICT (user_id) DO NOTHING
        `,
        [req.user.id]
      );

      const result = await pool.query(
        `
          SELECT
            user_id,
            low_stock,
            daily_sales_summary,
            new_staff,
            refund_activity,
            updated_at

          FROM notification_preferences

          WHERE user_id = $1
        `,
        [req.user.id]
      );

      const preferences = result.rows[0];

      res.json({
        userId:
          preferences.user_id,

        lowStock:
          preferences.low_stock,

        dailySalesSummary:
          preferences.daily_sales_summary,

        newStaff:
          preferences.new_staff,

        refundActivity:
          preferences.refund_activity,

        updatedAt:
          preferences.updated_at,
      });
    } catch (error) {
      console.error(
        'Load notification preferences error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to load notification preferences',
      });
    }
  }
);

/* =========================================================
   PUT /api/notifications/preferences
   ========================================================= */

router.put(
  '/preferences',
  requireAuth,
  async (req, res) => {
    const {
      lowStock,
      dailySalesSummary,
      newStaff,
      refundActivity,
    } = req.body ?? {};

    /*
     * Don't silently accept strings such as
     * "true" or "false".
     */
    if (
      typeof lowStock !== 'boolean' ||
      typeof dailySalesSummary !== 'boolean' ||
      typeof newStaff !== 'boolean' ||
      typeof refundActivity !== 'boolean'
    ) {
      return res.status(400).json({
        error:
          'All notification preferences must be boolean values',
      });
    }

    try {
      const result = await pool.query(
        `
          INSERT INTO notification_preferences (
            user_id,
            low_stock,
            daily_sales_summary,
            new_staff,
            refund_activity,
            updated_at
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            NOW()
          )

          ON CONFLICT (user_id)

          DO UPDATE SET
            low_stock =
              EXCLUDED.low_stock,

            daily_sales_summary =
              EXCLUDED.daily_sales_summary,

            new_staff =
              EXCLUDED.new_staff,

            refund_activity =
              EXCLUDED.refund_activity,

            updated_at =
              NOW()

          RETURNING
            user_id,
            low_stock,
            daily_sales_summary,
            new_staff,
            refund_activity,
            updated_at
        `,
        [
          req.user.id,
          lowStock,
          dailySalesSummary,
          newStaff,
          refundActivity,
        ]
      );

      const preferences = result.rows[0];

      res.json({
        userId:
          preferences.user_id,

        lowStock:
          preferences.low_stock,

        dailySalesSummary:
          preferences.daily_sales_summary,

        newStaff:
          preferences.new_staff,

        refundActivity:
          preferences.refund_activity,

        updatedAt:
          preferences.updated_at,
      });
    } catch (error) {
      console.error(
        'Update notification preferences error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to update notification preferences',
      });
    }
  }
);

/* =========================================================
   GET /api/notifications
   List notifications for current user
   ========================================================= */

router.get(
  '/',
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            id,
            type,
            title,
            message,
            is_read,
            related_sale_id,
            created_at

          FROM notifications

          WHERE user_id = $1

          ORDER BY created_at DESC

          LIMIT 50
        `,
        [req.user.id]
      );

      const notifications =
        result.rows.map((row) => ({
          id: row.id,

          type: row.type,

          title: row.title,

          message: row.message,

          isRead: row.is_read,

          relatedSaleId:
            row.related_sale_id,

          createdAt:
            row.created_at,
        }));

      const unreadCount =
        notifications.filter(
          (notification) =>
            !notification.isRead
        ).length;

      res.json({
        notifications,
        unreadCount,
      });
    } catch (error) {
      console.error(
        'Load notifications error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to load notifications',
      });
    }
  }
);


/* =========================================================
   PATCH /api/notifications/:id/read
   Mark one notification as read
   ========================================================= */

router.patch(
  '/:id/read',
  requireAuth,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
          UPDATE notifications

          SET
            is_read = TRUE

          WHERE
            id = $1
            AND user_id = $2

          RETURNING
            id,
            type,
            title,
            message,
            is_read,
            related_sale_id,
            created_at
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );

      const row =
        result.rows[0];

      if (!row) {
        return res
          .status(404)
          .json({
            error:
              'Notification not found',
          });
      }

      res.json({
        id: row.id,

        type: row.type,

        title: row.title,

        message: row.message,

        isRead: row.is_read,

        relatedSaleId:
          row.related_sale_id,

        createdAt:
          row.created_at,
      });
    } catch (error) {
      console.error(
        'Mark notification read error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to update notification',
      });
    }
  }
);


/* =========================================================
   PATCH /api/notifications/read-all
   Mark all notifications as read
   ========================================================= */

router.patch(
  '/read-all',
  requireAuth,
  async (req, res) => {
    try {
      await pool.query(
        `
          UPDATE notifications

          SET
            is_read = TRUE

          WHERE
            user_id = $1
            AND is_read = FALSE
        `,
        [req.user.id]
      );

      res.json({
        message:
          'All notifications marked as read',
      });
    } catch (error) {
      console.error(
        'Mark all notifications read error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to update notifications',
      });
    }
  }
);

/* =========================================================
   DELETE /api/notifications
   Delete all notifications for current user
   ========================================================= */

router.delete(
  '/',
  requireAuth,
  async (req, res) => {
    try {
      await pool.query(
        `
          DELETE FROM notifications
          WHERE user_id = $1
        `,
        [req.user.id]
      );

      res.json({
        message:
          'All notifications deleted',
      });
    } catch (error) {
      console.error(
        'Delete notifications error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to delete notifications',
      });
    }
  }
);

module.exports = router;