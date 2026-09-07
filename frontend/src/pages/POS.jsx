import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  clearCheckoutKey,
  getOrCreateCheckoutKey,
} from '../utils/checkoutIdempotency';
import {
  addProductToCart,
  cartCheckoutItems,
  changeCartQuantity,
  inventoryTargetKey,
  removeCartTarget,
} from '../utils/posCart';
import {
  DEFAULT_PAYMENT_METHOD,
  PAYMENT_METHODS,
  checkoutRequestBody,
  parseCheckoutDiscount,
} from '../utils/posCheckout';
import {
  cartProductFromLookup,
  cartProductFromVariant,
  catalogItemKey,
  filterProducts,
  needsVariantSelection,
  productFromSearchRow,
} from '../utils/posCatalog';
import { invoiceFromCheckout, printReceipt } from '../utils/posReceipt';

export default function POS() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]); // [{ product, quantity }]
  const [scanInput, setScanInput] = useState('');
  const [message, setMessage] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(DEFAULT_PAYMENT_METHOD);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [variantPicker, setVariantPicker] = useState(null);
  const [discountInput, setDiscountInput] = useState('');
  const [lastInvoice, setLastInvoice] = useState(null);
  const scanRef = useRef(null);
  const checkoutKeyRef = useRef(null);
  const { user, logout } = useAuth();

  useEffect(() => {
    loadProducts();
    // Keep focus on the scan input so a USB barcode/QR scanner always has
    // somewhere to "type" into, even if the cashier clicks elsewhere.
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!customerPickerOpen || selectedCustomer) return undefined;

    const handle = setTimeout(async () => {
      try {
        const res = await api.get('/customers', {
          params: { search: customerQuery.trim() },
        });
        setCustomerResults(res.data);
      } catch (err) {
        console.error(err);
        setCustomerResults([]);
      }
    }, 200);

    return () => clearTimeout(handle);
  }, [customerQuery, customerPickerOpen, selectedCustomer]);

  useEffect(() => {
    const query = productQuery.trim();
    if (!query) {
      setSearchResults(null);
      return undefined;
    }

    const handle = setTimeout(async () => {
      try {
        const res = await api.get('/products/search', { params: { q: query } });
        setSearchResults(res.data.map(productFromSearchRow));
      } catch (err) {
        console.error(err);
        setSearchResults(filterProducts(products, query));
      }
    }, 200);

    return () => clearTimeout(handle);
  }, [productQuery, products]);

  const loadProducts = async () => {
    try {
      const res = await api.get('/products');
      setProducts(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const addToCart = (product) => {
    setCart((prev) => addProductToCart(prev, product));
  };

  const openVariantPicker = async (product) => {
    const productId = product.product_id ?? product.id;
    try {
      const res = await api.get(`/products/${productId}/variants`);
      if (!res.data.length) {
        setMessage('This product requires a variant');
        setTimeout(() => setMessage(''), 2000);
        return;
      }
      setVariantPicker({ parent: product, variants: res.data });
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to load variants');
      setTimeout(() => setMessage(''), 2000);
    }
  };

  const handleProductClick = async (product) => {
    if (needsVariantSelection(product, products)) {
      await openVariantPicker(product);
      return;
    }
    addToCart(product);
  };

  const updateQuantity = (product, delta) => {
    setCart((prev) => changeCartQuantity(prev, product, delta));
  };

  const removeFromCart = (product) => {
    setCart((prev) => removeCartTarget(prev, product));
  };

  // Handles input from a USB barcode/QR scanner (which types the code + Enter)
  // or a manual SKU typed by the cashier.
  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;

    try {
      const res = await api.get(`/products/lookup/${scanInput.trim()}`);
      const scanned = cartProductFromLookup(res.data);
      if (needsVariantSelection(scanned, products)) {
        await openVariantPicker(scanned);
        setMessage(`Select a variant for ${scanned.name}`);
      } else {
        addToCart(scanned);
        setMessage(`Added: ${scanned.name}`);
      }
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

  const catalog = searchResults ?? filterProducts(products, productQuery);
  const parsedDiscount = parseCheckoutDiscount(discountInput);
  const discountAmount = parsedDiscount.error ? 0 : parsedDiscount.amount;
  const discountTooLarge = !parsedDiscount.error && discountAmount > subtotal;
  const checkoutBlocked =
    cart.length === 0 ||
    checkingOut ||
    Boolean(parsedDiscount.error) ||
    discountTooLarge;
  const total = Math.max(0, subtotal - discountAmount);

  const handleCheckout = async () => {
    if (checkoutBlocked) return;
    setCheckingOut(true);
    const checkoutKey = getOrCreateCheckoutKey(checkoutKeyRef);
    try {
      const res = await api.post('/sales', checkoutRequestBody({
        items: cartCheckoutItems(cart),
        paymentMethod,
        customer: selectedCustomer,
        discount: parsedDiscount.canonical,
        idempotencyKey: checkoutKey,
      }));

      clearCheckoutKey(checkoutKeyRef);
      const invoice = invoiceFromCheckout(res.data);
      setLastInvoice(invoice);
      printReceipt(invoice);
      setMessage(`Sale complete! Invoice ${res.data.sale.invoice_number}`);
      setCart([]);
      setSelectedCustomer(null);
      setCustomerQuery('');
      setCustomerResults([]);
      setCustomerPickerOpen(false);
      setDiscountInput('');
      loadProducts(); // refresh stock counts
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
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-gray-700">Products</h2>
            <input
              type="text"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Search name or SKU"
              className="w-56 max-w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {catalog.map((product) => (
              <button
                key={catalogItemKey(product)}
                onClick={() => handleProductClick(product)}
                disabled={product.stock_quantity <= 0}
                className="border rounded-lg p-3 text-left hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="font-medium text-sm text-gray-800">
                  {product.name}
                </div>
                {product.has_variants && (
                  <div className="text-xs text-amber-700">Choose variant</div>
                )}
                <div className="text-blue-600 font-semibold">
                  ₱{parseFloat(product.price).toFixed(2)}
                </div>
                <div className="text-xs text-gray-500">
                  Stock: {product.stock_quantity}
                </div>
              </button>
            ))}
            {catalog.length === 0 && (
              <p className="text-sm text-gray-400 col-span-full">No matching products</p>
            )}
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
                key={inventoryTargetKey(item.product)}
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
                    onClick={() => updateQuantity(item.product, -1)}
                    className="w-6 h-6 bg-gray-200 rounded"
                  >
                    -
                  </button>
                  <button
                    onClick={() => updateQuantity(item.product, 1)}
                    className="w-6 h-6 bg-gray-200 rounded"
                  >
                    +
                  </button>
                  <button
                    onClick={() => removeFromCart(item.product)}
                    className="text-red-500 ml-1"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t mt-3 pt-3 space-y-3">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">Customer</div>
              {selectedCustomer ? (
                <div className="border rounded px-3 py-2 text-sm bg-gray-50">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="font-medium text-gray-800">{selectedCustomer.name}</div>
                      {selectedCustomer.phone && (
                        <div className="text-gray-500">{selectedCustomer.phone}</div>
                      )}
                      {selectedCustomer.email && (
                        <div className="text-gray-500">{selectedCustomer.email}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerQuery('');
                        setCustomerResults([]);
                        setCustomerPickerOpen(false);
                      }}
                      className="text-xs text-blue-600 underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    onFocus={() => setCustomerPickerOpen(true)}
                    onBlur={() => {
                      setTimeout(() => setCustomerPickerOpen(false), 150);
                    }}
                    placeholder="Search customer (optional)"
                    className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {customerPickerOpen && customerResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto bg-white border rounded shadow">
                      {customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setCustomerQuery('');
                            setCustomerResults([]);
                            setCustomerPickerOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                        >
                          <div className="font-medium text-gray-800">{customer.name}</div>
                          <div className="text-xs text-gray-500">
                            {[customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact details'}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">Payment</div>
              <div className="grid grid-cols-3 gap-1">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setPaymentMethod(method.value)}
                    className={`text-xs py-2 rounded border ${
                      paymentMethod === method.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 hover:bg-blue-50'
                    }`}
                  >
                    {method.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-700 mb-1">Discount</div>
              <input
                type="text"
                inputMode="decimal"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="0.00"
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {(parsedDiscount.error || discountTooLarge) && (
                <div className="text-xs text-red-600 mt-1">
                  {parsedDiscount.error || 'Discount cannot exceed subtotal'}
                </div>
              )}
            </div>

            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>₱{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Discount</span>
                <span>₱{discountAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold text-lg">
                <span>Total</span>
                <span>₱{total.toFixed(2)}</span>
              </div>
            </div>
            <button
              onClick={handleCheckout}
              disabled={checkoutBlocked}
              className="w-full bg-green-600 text-white py-2 rounded font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {checkingOut ? 'Processing...' : 'Checkout & Print'}
            </button>
            {lastInvoice && (
              <button
                type="button"
                onClick={() => printReceipt(lastInvoice)}
                className="w-full border py-2 rounded text-sm text-gray-700 hover:bg-gray-50"
              >
                Reprint last receipt
              </button>
            )}
          </div>
        </div>
      </div>

      {variantPicker && (
        <div className="fixed inset-0 bg-black/40 z-20 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-4">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-gray-800">
                Select variant — {variantPicker.parent.name || variantPicker.parent.product_name}
              </h3>
              <button
                type="button"
                onClick={() => setVariantPicker(null)}
                className="text-sm text-gray-500"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {variantPicker.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  disabled={Number(variant.stock_quantity) <= 0}
                  onClick={() => {
                    addToCart(cartProductFromVariant(variantPicker.parent, variant));
                    setVariantPicker(null);
                  }}
                  className="w-full text-left border rounded px-3 py-2 hover:bg-blue-50 disabled:opacity-40"
                >
                  <div className="font-medium text-sm">{variant.name}</div>
                  <div className="text-xs text-gray-500">
                    ₱{parseFloat(variant.effective_price ?? variant.price ?? 0).toFixed(2)} · Stock {variant.stock_quantity}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
