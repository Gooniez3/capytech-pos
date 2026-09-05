import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Overview from '../components/admin/Overview';
import ProductsTab from '../components/admin/ProductsTab';
import SalesHistoryTab from '../components/admin/SalesHistoryTab';
import StaffTab from '../components/admin/StaffTab';
import LowStockTab from '../components/admin/LowStockTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'products', label: 'Products' },
  { id: 'sales', label: 'Sales History' },
  { id: 'lowstock', label: 'Low Stock' },
  { id: 'staff', label: 'Staff' },
];

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen">
      <div className="bg-white shadow px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold text-gray-800">Admin Dashboard</h1>
          <Link to="/pos" className="text-sm text-blue-600 underline">
            Go to POS screen
          </Link>
        </div>
        <div className="text-sm text-gray-600">
          {user?.name} ({user?.role}){' '}
          <button onClick={logout} className="text-blue-600 underline ml-2">
            Logout
          </button>
        </div>
      </div>

      <div className="bg-white border-b px-4">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {activeTab === 'overview' && <Overview />}
        {activeTab === 'products' && <ProductsTab />}
        {activeTab === 'sales' && <SalesHistoryTab />}
        {activeTab === 'lowstock' && <LowStockTab />}
        {activeTab === 'staff' && <StaffTab />}
      </div>
    </div>
  );
}
