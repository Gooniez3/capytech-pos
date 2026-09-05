# POS Frontend — Setup Guide

## What you need
- Node.js (already installed for the backend)
- The backend running (from Step 1) on port 4000

## Setup steps

### 1. Install dependencies
```
cd frontend
npm install
```

### 2. Run the dev server
```
npm run dev
```
You should see something like:
```
  Local:   http://localhost:3000/
  Network: http://192.168.1.5:3000/
```

### 3. Open it
- On the store PC: go to `http://localhost:3000`
- On your phone: connect to the **same store WiFi**, then open the "Network" address shown in the terminal (e.g. `http://192.168.1.5:3000`)

### 4. Log in
Use the admin username/password you created in Step 1 (backend setup).

## How it works
- The barcode/QR scan input box is always focused — scan a product's QR/barcode and it's added to the cart automatically (works with any USB barcode scanner, since scanners just "type" the code + Enter).
- Click products directly to add them to the cart too (useful before you've printed QR labels for everything).
- "Checkout & Print" creates the invoice and deducts stock. **Printing isn't wired up yet** — that's Step 3.

## Note on adding your first products
There's no "Add Product" screen yet (that's next). For now, you can add products directly by testing the API — for example using the Thunder Client VS Code extension, calling:
```
POST http://localhost:4000/api/products
Authorization: Bearer <your admin token>
Body: { "sku": "MOUSE001", "name": "Wireless Mouse", "price": 599 }
```
Or tell me and I'll build the Add Product admin screen next — it's a quick addition.
