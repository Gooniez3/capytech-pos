import React, { useEffect, useState } from 'react';
import api from '../../api/client';

export default function LowStockTab() {
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLowStock();
  }, []);

  const loadLowStock = async () => {
    setLoading(true);
    const res = await api.get('/reports/low-stock');
    setLowStock(res.data);
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-gray-700">
        Low Stock Alerts {lowStock.length > 0 && `(${lowStock.length})`}
      </h2>

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : lowStock.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-4 text-sm text-gray-500">
          All products are above their low-stock threshold. Nothing to restock right now.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="p-3">SKU</th>
                <th className="p-3">Product</th>
                <th className="p-3">Current Stock</th>
                <th className="p-3">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3 font-mono text-xs">{p.sku}</td>
                  <td className="p-3">{p.name}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        p.stock_quantity === 0
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {p.stock_quantity}
                    </span>
                  </td>
                  <td className="p-3">{p.low_stock_threshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
