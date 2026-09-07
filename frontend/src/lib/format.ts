import type { Product, StockStatus } from '@/types';

export function getStockStatus(product: Pick<Product, 'stock' | 'reorderLevel'>): StockStatus {
  if (product.stock <= 0) return 'out_of_stock';
  if (product.stock <= product.reorderLevel) return 'low_stock';
  return 'in_stock';
}

export function stockStatusLabel(status: StockStatus): string {
  switch (status) {
    case 'in_stock':
      return 'In Stock';
    case 'low_stock':
      return 'Low Stock';
    case 'out_of_stock':
      return 'Out of Stock';
  }
}

export function inventoryValue(products: Product[]): number {
  return products.reduce((sum, p) => sum + p.cost * p.stock, 0);
}

export function retailValue(products: Product[]): number {
  return products.reduce((sum, p) => sum + p.price * p.stock, 0);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}
