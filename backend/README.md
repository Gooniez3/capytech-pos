# POS Backend — Setup Guide

## What you need installed on the store PC (all free)
1. **Node.js** (v18+) — https://nodejs.org
2. **PostgreSQL** (v14+) — https://www.postgresql.org/download/

## Setup steps

### 1. Create the database
Open a terminal (or pgAdmin) and run:
```
createdb pos_store
psql -d pos_store -f src/db/schema.sql
```

### 2. Install dependencies
```
cd backend
npm install
```

### 3. Configure environment
Copy `.env.example` to `.env` and fill in your actual PostgreSQL password:
```
cp .env.example .env
```

### 4. Create your first admin user
Since passwords must be hashed, run this once in a `node` console (inside the `backend` folder):
```js
const bcrypt = require('bcrypt');
bcrypt.hash('yourpassword', 10).then(console.log);
```
Copy the output hash, then insert the user manually:
```sql
INSERT INTO users (name, username, password_hash, role)
VALUES ('Owner', 'admin', 'PASTE_HASH_HERE', 'admin');
```

### 5. Run the server
```
npm run dev
```
You should see:
```
POS backend running on port 4000
Local access:   http://localhost:4000
Network access: http://<your-PC-local-IP>:4000
```

### 6. Find your PC's local IP (for phone access)
- Windows: run `ipconfig`, look for "IPv4 Address" (e.g. 192.168.1.5)
- Mac/Linux: run `ifconfig` or `ip addr`

On your phone (connected to the same store WiFi), you'll later open:
`http://192.168.1.5:3000` (once the frontend is running too)

## Test it's working
Visit `http://localhost:4000/api/health` in your browser — you should see `{"status":"ok"}`.

## What's built so far
- ✅ User login (JWT + bcrypt password hashing)
- ✅ Product CRUD with auto QR code generation (encodes the SKU)
- ✅ Barcode/QR lookup endpoint (for scanner input)
- ✅ Checkout flow (creates invoice, deducts stock, records line items)
- ✅ Void sale (admin-only, restores stock, logs to audit_log)
- ✅ Rate limiting on login (brute-force protection)
- ✅ Role-based access (admin vs cashier)

## Not built yet (next steps)
- Frontend (React) — the actual POS screen you click through
- Thermal printer integration (QZ Tray connection)
- PWA setup for "install on phone" experience
