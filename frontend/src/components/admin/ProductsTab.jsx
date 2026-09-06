import React, { useEffect, useState } from 'react';
import api from '../../api/client';

export default function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [deletedProducts, setDeletedProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [qrPreview, setQrPreview] = useState(null);
  const [form, setForm] = useState({
    sku: '',
    name: '',
    category_id: '',
    price: '',
    cost: '',
    stock_quantity: '',
    low_stock_threshold: '5',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProducts();
    loadDeletedProducts();
    loadCategories();
  }, []);

  const loadProducts = async () => {
    const res = await api.get('/products');
    setProducts(res.data);
  };

  const loadDeletedProducts = async () => {
    const res = await api.get('/products/deleted');
    setDeletedProducts(res.data);
  };

  const refreshProductLists = async () => {
    await Promise.all([loadProducts(), loadDeletedProducts()]);
  };

  const loadCategories = async () => {
    const res = await api.get('/categories');
    setCategories(res.data);
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await api.post('/products', {
        ...form,
        category_id: form.category_id || null,
        price: parseFloat(form.price),
        cost: parseFloat(form.cost) || 0,
        stock_quantity: parseInt(form.stock_quantity, 10) || 0,
        low_stock_threshold: parseInt(form.low_stock_threshold, 10) || 5,
      });
      setProducts([...products, res.data]);
      setForm({
        sku: '',
        name: '',
        category_id: '',
        price: '',
        cost: '',
        stock_quantity: '',
        low_stock_threshold: '5',
      });
      setShowForm(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add product');
    } finally {
      setSaving(false);
    }
  };

  const viewQr = async (product) => {
    const res = await api.get(`/products/${product.id}/barcode`);
    setQrPreview({ name: product.name, sku: res.data.sku, image: res.data.barcode });
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(
      `Remove ${product.name} from active POS inventory? It can be restored from the Recycle Bin.`
    )) return;

    setError('');
    try {
      await api.delete(`/products/${product.id}`);
      await refreshProductLists();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove product');
    }
  };

  const restoreProduct = async (product) => {
    if (!window.confirm(
      `Restore ${product.name}? Any child variants that are still active will become sellable again.`
    )) return;

    setError('');
    try {
      await api.post(`/products/${product.id}/restore`);
      await refreshProductLists();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to restore product');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-gray-700">
          Products ({products.length})
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowRecycleBin(!showRecycleBin); loadDeletedProducts(); }}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm font-medium hover:bg-gray-50"
          >
            {showRecycleBin ? 'Active Products' : `Recycle Bin (${deletedProducts.length})`}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ Add Product'}
          </button>
        </div>
      </div>

      {error && !showForm && (
        <div className="bg-red-100 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {error && (
            <div className="sm:col-span-2 bg-red-100 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SKU (also encoded in QR)
            </label>
            <input
              name="sku"
              value={form.sku}
              onChange={handleChange}
              required
              className="w-full border rounded px-3 py-2"
              placeholder="MOUSE001"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Product Name
            </label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              className="w-full border rounded px-3 py-2"
              placeholder="Wireless Mouse"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              name="category_id"
              value={form.category_id}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Price (₱)
            </label>
            <input
              name="price"
              type="number"
              step="0.01"
              value={form.price}
              onChange={handleChange}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cost (₱, optional)
            </label>
            <input
              name="cost"
              type="number"
              step="0.01"
              value={form.cost}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Starting Stock
            </label>
            <input
              name="stock_quantity"
              type="number"
              value={form.stock_quantity}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Low Stock Alert Threshold
            </label>
            <input
              name="low_stock_threshold"
              type="number"
              value={form.low_stock_threshold}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-4 py-2 rounded font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Product'}
            </button>
          </div>
        </form>
      )}

      {!showRecycleBin ? (
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-3">SKU</th>
              <th className="p-3">Name</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stock</th>
              <th className="p-3">QR</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="p-3 font-mono text-xs">{p.sku}</td>
                <td className="p-3">{p.name}</td>
                <td className="p-3">₱{parseFloat(p.price).toFixed(2)}</td>
                <td className="p-3">{p.stock_quantity}</td>
                <td className="p-3">
                  <button
                    onClick={() => viewQr(p)}
                    className="text-blue-600 underline text-xs"
                  >
                    View QR
                  </button>
                </td>
                <td className="p-3">
                  <button
                    onClick={() => deleteProduct(p)}
                    className="text-red-600 underline text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="p-3">Product</th>
                <th className="p-3">Deleted</th>
                <th className="p-3">Variants</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {deletedProducts.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {p.image_url ? <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 rounded bg-gray-100" />}
                      <div><div>{p.name}</div><div className="font-mono text-xs text-gray-500">{p.sku}</div></div>
                    </div>
                  </td>
                  <td className="p-3 text-xs">
                    <div>{p.deleted_at ? new Date(p.deleted_at).toLocaleString() : 'Unknown'}</div>
                    <div className="text-gray-500">{p.deleted_by_username || 'Unknown'}</div>
                  </td>
                  <td className="p-3 text-xs">
                    {p.variant_count} total / {p.active_variant_count} active / {p.inactive_variant_count} inactive
                  </td>
                  <td className="p-3">
                    <button onClick={() => restoreProduct(p)} className="text-green-700 underline text-xs">Restore</button>
                  </td>
                </tr>
              ))}
              {deletedProducts.length === 0 && (
                <tr><td className="p-4 text-gray-500" colSpan="4">Recycle Bin is empty.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {qrPreview && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setQrPreview(null)}
        >
          <div
            className="bg-white rounded-lg p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-2">{qrPreview.name}</h3>
            <img src={qrPreview.image} alt="QR code" className="mx-auto w-48 h-48" />
            <p className="text-xs text-gray-500 mt-2 font-mono">{qrPreview.sku}</p>
            <button
              onClick={() => setQrPreview(null)}
              className="mt-4 text-sm text-blue-600 underline"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
