export type Role = 'admin' | 'manager' | 'cashier';

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export type SaleStatus = 'completed' | 'refunded' | 'voided';

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
  salesMade: number;
  revenue: number;
  status: 'active' | 'inactive';
  joinedAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  price: number;
  cost: number;
  stock: number;
  reorderLevel: number;
  image?: string;
  barcode: string;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface SaleItem {
  productId: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  subtotal: number;
}

export interface Sale {
  id: string;

  invoice: string;

  date: string;

  cashierId: string;

  cashierName: string;

  items: SaleItem[];

  subtotal: number;

  discount: number;

  tax?: number;

  total: number;

  status: SaleStatus;

  paymentMethod:
    | 'cash'
    | 'banking'
    | 'kbzpay'
    | 'wavepay'
    | 'mmqr';

  // Refund audit information
  refundReason?: string | null;

  refundedAt?: string | null;

  refundedBy?: string | null;
}

export interface DashboardStats {
  todayRevenue: number;
  transactions: number;
  averageSale: number;
  lowStockCount: number;
  profit: number;
}

export interface RevenuePoint {
  label: string;
  revenue: number;
  profit: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  sku: string;
  units: number;
  revenue: number;
}
