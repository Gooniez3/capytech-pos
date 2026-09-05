import React, { useEffect, useState } from 'react';
import api from '../../api/client';

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function Overview() {
  const [range, setRange] = useState('today');
  const [summary, setSummary] = useState(null);
  const [dailyRevenue, setDailyRevenue] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [range]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [summaryRes, dailyRes, topRes] = await Promise.all([
        api.get(`/reports/summary?range=${range}`),
        api.get('/reports/daily-revenue?days=7'),
        api.get('/reports/top-products?limit=5&days=30'),
      ]);
      setSummary(summaryRes.data);
      setDailyRevenue(dailyRes.data);
      setTopProducts(topRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const maxRevenue = Math.max(...dailyRevenue.map((d) => parseFloat(d.revenue)), 1);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {['today', 'week', 'month'].map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-3 py-1 rounded text-sm font-medium capitalize ${
              range === r ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label={`Revenue (${range})`}
              value={`₱${parseFloat(summary?.revenue || 0).toFixed(2)}`}
            />
            <StatCard
              label="Transactions"
              value={summary?.transaction_count || 0}
            />
            <StatCard
              label="Average Sale"
              value={`₱${parseFloat(summary?.average_sale || 0).toFixed(2)}`}
            />
          </div>

          {/* Simple bar chart - no charting library needed, just styled divs */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-700 mb-3">
              Revenue — Last 7 Days
            </h3>
            {dailyRevenue.length === 0 ? (
              <p className="text-sm text-gray-400">No sales data yet</p>
            ) : (
              <div className="flex items-end gap-2 h-40">
                {dailyRevenue.map((d) => (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col items-center justify-end"
                  >
                    <div className="text-xs text-gray-500 mb-1">
                      ₱{parseFloat(d.revenue).toFixed(0)}
                    </div>
                    <div
                      className="w-full bg-blue-500 rounded-t"
                      style={{
                        height: `${(parseFloat(d.revenue) / maxRevenue) * 100}%`,
                        minHeight: '4px',
                      }}
                    />
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(d.date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-700 mb-3">
              Top Products (Last 30 Days)
            </h3>
            {topProducts.length === 0 ? (
              <p className="text-sm text-gray-400">No sales data yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2">Product</th>
                    <th className="pb-2">Qty Sold</th>
                    <th className="pb-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => (
                    <tr key={p.product_id} className="border-b last:border-0">
                      <td className="py-2">{p.product_name}</td>
                      <td className="py-2">{p.total_quantity_sold}</td>
                      <td className="py-2">
                        ₱{parseFloat(p.total_revenue).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
