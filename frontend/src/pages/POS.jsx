import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  clearCheckoutKey,
  getOrCreateCheckoutKey,
} from '../utils/checkoutIdempotency';

export default function POS() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]); // [{ product, quantity }]
  const [scanInput, setScanInput] = useState('');
  const [message, setMessage] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const scanRef = useRef(null);
  const checkoutKeyRef = useRef(null);
  const { user, logout } = useAuth();

  useEffect(() => {
    loadProducts();
    // Keep focus on the scan input so a USB barcode/QR scanner always has
    // somewhere to "type" into, even if the cashier clicks elsewhere.
    scanRef.current?.focus();
  }, []);

  const loadProducts = async () => {
    try {
      const res = await api.get('/products');
      setProducts(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId, delta) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Handles input from a USB barcode/QR scanner (which types the code + Enter)
  // or a manual SKU typed by the cashier.
  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;

    try {
      const res = await api.get(`/products/lookup/${scanInput.trim()}`);
      addToCart(res.data);
      setMessage(`Added: ${res.data.name}`);
    } catch (err) {
      setMessage('Product not found for that code');
    }
    setScanInput('');
    setTimeout(() => setMessage(''), 2000);
  };

  const subtotal = cart.reduce(
    (sum, item) => sum + parseFloat(item.product.price) * item.quantity,
    0
  );

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setCheckingOut(true);
    const checkoutKey = getOrCreateCheckoutKey(checkoutKeyRef);
    try {
      const res = await api.post('/sales', {
        items: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
        payment_method: 'cash',
        idempotency_key: checkoutKey,
      });

      clearCheckoutKey(checkoutKeyRef);
      setMessage(`Sale complete! Invoice ${res.data.sale.invoice_number}`);
      setCart([]);
      loadProducts(); // refresh stock counts

      // TODO: this is where we'll trigger the thermal printer receipt
      // once printer integration is added (Step 3).
    } catch (err) {
      setMessage(err.response?.data?.error || 'Checkout failed');
    } finally {
      setCheckingOut(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div className="min-h-screen p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold text-gray-800">
          Computer Accessories POS
        </h1>
        <div className="text-sm text-gray-600">
          {user?.name} ({user?.role}){' '}
          {user?.role === 'admin' && (
            <Link to="/admin" className="text-blue-600 underline ml-2">
              Admin Dashboard
            </Link>
          )}
          <button onClick={logout} className="text-blue-600 underline ml-2">
            Logout
          </button>
        </div>
      </div>

      {/* Barcode/QR scan input - always focused, accepts scanner or manual entry */}
      <form onSubmit={handleScanSubmit} className="mb-4">
        <input
          ref={scanRef}
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          placeholder="Scan barcode/QR or type SKU, then press Enter"
          className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
      </form>

      {message && (
        <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded mb-4 text-sm">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Product grid */}
        <div className="md:col-span-2 bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-3 text-gray-700">Products</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {products.map((product) => (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                disabled={product.stock_quantity <= 0}
                className="border rounded-lg p-3 text-left hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="font-medium text-sm text-gray-800">
                  {product.name}
                </div>
                <div className="text-blue-600 font-semibold">
                  ₱{parseFloat(product.price).toFixed(2)}
                </div>
                <div className="text-xs text-gray-500">
                  Stock: {product.stock_quantity}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Cart */}
        <div className="bg-white rounded-lg shadow p-4 flex flex-col">
          <h2 className="font-semibold mb-3 text-gray-700">Cart</h2>
          <div className="flex-1 overflow-y-auto space-y-2">
            {cart.length === 0 && (
              <p className="text-sm text-gray-400">Cart is empty</p>
            )}
            {cart.map((item) => (
              <div
                key={item.product.id}
                className="flex justify-between items-center border-b pb-2 text-sm"
              >
                <div className="flex-1">
                  <div className="font-medium">{item.product.name}</div>
                  <div className="text-gray-500">
                    ₱{parseFloat(item.product.price).toFixed(2)} ×{' '}
                    {item.quantity}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateQuantity(item.product.id, -1)}
                    className="w-6 h-6 bg-gray-200 rounded"
                  >
                    -
                  </button>
                  <button
                    onClick={() => updateQuantity(item.product.id, 1)}
                    className="w-6 h-6 bg-gray-200 rounded"
                  >
                    +
                  </button>
                  <button
                    onClick={() => removeFromCart(item.product.id)}
                    className="text-red-500 ml-1"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t mt-3 pt-3">
            <div className="flex justify-between font-semibold text-lg mb-3">
              <span>Total</span>
              <span>₱{subtotal.toFixed(2)}</span>
            </div>
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || checkingOut}
              className="w-full bg-green-600 text-white py-2 rounded font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {checkingOut ? 'Processing...' : 'Checkout & Print'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
