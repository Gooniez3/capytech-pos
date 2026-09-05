const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

require('dotenv').config();

/* =========================================================
   ROUTES
   ========================================================= */

const dashboardRoutes =
  require('./routes/dashboard');

const authRoutes =
  require('./routes/auth');

const productRoutes =
  require('./routes/products');

const salesRoutes =
  require('./routes/sales');

const reportsRoutes =
  require('./routes/reports');

const staffRoutes =
  require('./routes/staff');

const categoriesRoutes =
  require('./routes/categories');

const customerRoutes =
  require('./routes/customers');

const settingsRoutes =
  require('./routes/settings');

const notificationRoutes =
  require('./routes/notifications');

/* =========================================================
   APP
   ========================================================= */

const app = express();

/* =========================================================
   ALLOWED FRONTEND ORIGINS
   ========================================================= */

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://192.168.1.7:5173',
];

/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(
  cors({
    origin: allowedOrigins,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
    ],
  })
);

app.use(
  express.json()
);

/* =========================================================
   API ROUTES
   ========================================================= */

app.use(
  '/api/auth',
  authRoutes
);

app.use(
  '/api/products',
  productRoutes
);

app.use(
  '/api/sales',
  salesRoutes
);

app.use(
  '/api/dashboard',
  dashboardRoutes
);

app.use(
  '/api/reports',
  reportsRoutes
);

app.use(
  '/api/staff',
  staffRoutes
);

app.use(
  '/api/categories',
  categoriesRoutes
);

app.use(
  '/api/customers',
  customerRoutes
);

app.use(
  '/api/settings',
  settingsRoutes
);

app.use(
  '/api/notifications',
  notificationRoutes
);

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      status: 'ok',
      time:
        new Date().toISOString(),
    });
  }
);

/* =========================================================
   HTTP SERVER
   ========================================================= */

const httpServer =
  http.createServer(app);

/* =========================================================
   SOCKET.IO
   ========================================================= */

const io = new Server(
  httpServer,
  {
    cors: {
      origin: allowedOrigins,

      methods: [
        'GET',
        'POST',
      ],
    },
  }
);

/*
 * Active wireless scanner sessions.
 *
 * sessionId -> {
 *   posSocketId,
 *   scannerSocketId
 * }
 */

const scannerSessions =
  new Map();

/* =========================================================
   CREATE SECURE SESSION ID
   ========================================================= */

function createScannerSessionId() {
  return crypto
    .randomBytes(16)
    .toString('hex');
}

/* =========================================================
   SOCKET CONNECTION
   ========================================================= */

io.on(
  'connection',
  (socket) => {
    console.log(
      `Socket connected: ${socket.id}`
    );

    /* -----------------------------------------------------
       DESKTOP POS CREATES WIRELESS SCANNER SESSION
       ----------------------------------------------------- */

    socket.on(
      'scanner:create-session',
      (callback) => {
        const sessionId =
          createScannerSessionId();

        scannerSessions.set(
          sessionId,
          {
            posSocketId:
              socket.id,

            scannerSocketId:
              null,
          }
        );

        console.log(
          `Scanner session created: ${sessionId}`
        );

        if (
          typeof callback ===
          'function'
        ) {
          callback({
            success: true,
            sessionId,
          });
        }
      }
    );

    /* -----------------------------------------------------
       PHONE JOINS DESKTOP SESSION
       ----------------------------------------------------- */

    socket.on(
      'scanner:join',
      (
        { sessionId },
        callback
      ) => {
        const session =
          scannerSessions.get(
            sessionId
          );

        if (!session) {
          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              error:
                'Scanner session not found or expired.',
            });
          }

          return;
        }

        session.scannerSocketId =
          socket.id;

        scannerSessions.set(
          sessionId,
          session
        );

        /*
         * Tell desktop that phone
         * successfully connected.
         */
        io.to(
          session.posSocketId
        ).emit(
          'scanner:connected'
        );

        console.log(
          `Scanner phone joined session: ${sessionId}`
        );

        if (
          typeof callback ===
          'function'
        ) {
          callback({
            success: true,
          });
        }
      }
    );

    /* -----------------------------------------------------
       PHONE SENDS BARCODE
       ----------------------------------------------------- */

    socket.on(
      'scanner:barcode',
      (
        {
          sessionId,
          code,
        },
        callback
      ) => {
        const session =
          scannerSessions.get(
            sessionId
          );

        if (!session) {
          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              error:
                'Scanner session expired.',
            });
          }

          return;
        }

        /*
         * Only the phone connected to
         * this session may send scans.
         */
        if (
          session.scannerSocketId !==
          socket.id
        ) {
          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              error:
                'Scanner is not paired with this POS.',
            });
          }

          return;
        }

        const cleanCode =
          String(code || '')
            .trim();

        if (!cleanCode) {
          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              error:
                'Barcode is empty.',
            });
          }

          return;
        }

        /*
         * Send barcode ONLY to the
         * paired desktop POS.
         */
        io.to(
          session.posSocketId
        ).emit(
          'scanner:barcode',
          {
            code:
              cleanCode,
          }
        );

        console.log(
          `Wireless scan ${sessionId}: ${cleanCode}`
        );

        if (
          typeof callback ===
          'function'
        ) {
          callback({
            success: true,
          });
        }
      }
    );

    /* -----------------------------------------------------
       DESKTOP CLOSES SCANNER SESSION
       ----------------------------------------------------- */

    socket.on(
      'scanner:close-session',
      ({ sessionId }) => {
        const session =
          scannerSessions.get(
            sessionId
          );

        if (!session) {
          return;
        }

        if (
          session.posSocketId !==
          socket.id
        ) {
          return;
        }

        if (
          session.scannerSocketId
        ) {
          io.to(
            session.scannerSocketId
          ).emit(
            'scanner:session-closed'
          );
        }

        scannerSessions.delete(
          sessionId
        );

        console.log(
          `Scanner session closed: ${sessionId}`
        );
      }
    );

    /* -----------------------------------------------------
       DISCONNECT CLEANUP
       ----------------------------------------------------- */

    socket.on(
      'disconnect',
      () => {
        console.log(
          `Socket disconnected: ${socket.id}`
        );

        for (
          const [
            sessionId,
            session,
          ]
          of scannerSessions
        ) {
          /*
           * Desktop disconnected.
           * End entire scanner session.
           */
          if (
            session.posSocketId ===
            socket.id
          ) {
            if (
              session.scannerSocketId
            ) {
              io.to(
                session.scannerSocketId
              ).emit(
                'scanner:session-closed'
              );
            }

            scannerSessions.delete(
              sessionId
            );

            continue;
          }

          /*
           * Phone disconnected.
           * Keep desktop session alive
           * so another reconnect is possible.
           */
          if (
            session.scannerSocketId ===
            socket.id
          ) {
            session.scannerSocketId =
              null;

            scannerSessions.set(
              sessionId,
              session
            );

            io.to(
              session.posSocketId
            ).emit(
              'scanner:disconnected'
            );
          }
        }
      }
    );
  }
);

/* =========================================================
   SERVER
   ========================================================= */

const PORT =
  process.env.PORT ||
  4000;

httpServer.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `POS backend running on port ${PORT}`
    );

    console.log(
      `Local access: http://localhost:${PORT}`
    );

    console.log(
      `Network access: http://<your-PC-local-IP>:${PORT}`
    );

    console.log(
      'Wireless scanner socket ready'
    );
  }
);