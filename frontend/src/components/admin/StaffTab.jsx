import React, { useEffect, useState } from 'react';
import api from '../../api/client';

export default function StaffTab() {
  const [staff, setStaff] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'cashier' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [performance, setPerformance] = useState({}); // { userId: { sales_count, total_revenue } }

  useEffect(() => {
    loadStaff();
  }, []);

  const loadStaff = async () => {
    const res = await api.get('/staff');
    setStaff(res.data);
    // Load performance for each staff member
    res.data.forEach(async (s) => {
      const perf = await api.get(`/staff/${s.id}/sales-count`);
      setPerformance((prev) => ({ ...prev, [s.id]: perf.data }));
    });
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await api.post('/staff', form);
      setStaff([...staff, res.data]);
      setForm({ name: '', username: '', password: '', role: 'cashier' });
      setShowForm(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add staff member');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this staff account?')) return;
    try {
      await api.delete(`/staff/${id}`);
      loadStaff();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove staff account');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-gray-700">Staff Accounts</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Add Staff'}
        </button>
      </div>

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
              Full Name
            </label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              name="username"
              value={form.username}
              onChange={handleChange}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              required
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              name="role"
              value={form.role}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            >
              <option value="cashier">Cashier</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-4 py-2 rounded font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Create Account'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="p-3">Name</th>
              <th className="p-3">Username</th>
              <th className="p-3">Role</th>
              <th className="p-3">Sales Made</th>
              <th className="p-3">Revenue</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="p-3">{s.name}</td>
                <td className="p-3">{s.username}</td>
                <td className="p-3 capitalize">{s.role}</td>
                <td className="p-3">{performance[s.id]?.sales_count ?? '—'}</td>
                <td className="p-3">
                  {performance[s.id]
                    ? `₱${parseFloat(performance[s.id].total_revenue).toFixed(2)}`
                    : '—'}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-red-600 underline text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
