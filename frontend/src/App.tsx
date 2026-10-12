import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { FullPageLoader } from '@/components/ui/LoadingState';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { POSPage } from '@/pages/POSPage';
import { ProductsPage } from '@/pages/ProductsPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { SalesHistoryPage } from '@/pages/SalesHistoryPage';
import { StaffPage } from '@/pages/StaffPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import type { ReactNode } from 'react';
import { InvoicePage } from '@/pages/InvoicePage';
import { PhoneScannerPage } from '@/pages/PhoneScannerPage';
import { StockUnitsPage } from '@/pages/StockUnitsPage';
import { WarrantyLookupPage } from '@/pages/WarrantyLookupPage';
import {
  WirelessScannerProvider,
} from '@/context/WirelessScannerContext';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <AppLayout>{children}</AppLayout>;
}

function ProtectedStandaloneRoute({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <FullPageLoader />;
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        state={{ from: location }}
        replace
      />
    );
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />

      <Route
        path="/scanner"
        element={<PhoneScannerPage />}
      />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/pos"
        element={
          <ProtectedRoute>
            <POSPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/products"
        element={
          <ProtectedRoute>
            <ProductsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventory"
        element={
          <ProtectedRoute>
            <InventoryPage />
          </ProtectedRoute>
        }
      />

      <Route path="/stock-units" element={<ProtectedRoute><StockUnitsPage /></ProtectedRoute>} />
      <Route path="/warranty-lookup" element={<ProtectedRoute><WarrantyLookupPage /></ProtectedRoute>} />

      <Route
        path="/sales"
        element={
          <ProtectedRoute>
            <SalesHistoryPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/staff"
        element={
          <ProtectedRoute>
            <StaffPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/invoice/:saleId"
        element={
          <ProtectedStandaloneRoute>
            <InvoicePage />
          </ProtectedStandaloneRoute>
        }
      />

      <Route
        path="*"
        element={
          <Navigate
            to="/dashboard"
            replace
          />
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <WirelessScannerProvider>
            <AppRoutes />
          </WirelessScannerProvider>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}


export default App;
