import React, { useEffect, useState } from 'react';
import api from '../../api/client';

export default function SalesHistoryTab() {
  const [sales, setSales] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    loadSales();
  }, [page]);

  const loadSales = async () => {
    const res = await api.get(`/reports/sales-history?page=${page}&limit=${limit}`);
    setSales(res.data.sales);
    setTotal(res.data.total);
  };

  const handleVoid = async (saleId) => {
    if (!confirm('Void this sale? This will restore stock quantities.')) return;
    try {
      await api.post(`/sales/${saleId}/void`);
      loadSales();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to void sale');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-gray-700">Sales History</h2>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-3">Invoice #</th>
              <th className="p-3">Date</th>
              <th className="p-3">Cashier</th>
              <th className="p-3">Total</th>
              <th className="p-3">Status</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="p-3 font-mono text-xs">{s.invoice_number}</td>
                <td className="p-3">
                  {new Date(s.created_at).toLocaleString()}
                </td>
                <td className="p-3">{s.cashier_name || '—'}</td>
                <td className="p-3">₱{parseFloat(s.total).toFixed(2)}</td>
                <td className="p-3">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      s.status === 'voided'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {s.status}
                  </span>
                </td>
                <td className="p-3">
                  {s.status === 'completed' && (
                    <button
                      onClick={() => handleVoid(s.id)}
                      className="text-red-600 underline text-xs"
                    >
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-gray-400 text-center">
                  No sales yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex gap-2 items-center justify-center text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
