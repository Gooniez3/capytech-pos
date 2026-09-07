import type {
  Category,
  DashboardStats,
  Product,
  RevenuePoint,
  Sale,
  TopProduct,
  User,
} from '@/types';

export const categories: Category[] = [
  { id: 'all', name: 'All Products', icon: 'LayoutGrid' },
  { id: 'keyboards', name: 'Keyboards', icon: 'Keyboard' },
  { id: 'mice', name: 'Mice', icon: 'Mouse' },
  { id: 'audio', name: 'Audio', icon: 'Headphones' },
  { id: 'storage', name: 'Storage', icon: 'HardDrive' },
  { id: 'cables', name: 'Cables & Adapters', icon: 'Cable' },
  { id: 'monitors', name: 'Monitors', icon: 'Monitor' },
  { id: 'accessories', name: 'Accessories', icon: 'Plug' },
  { id: 'webcams', name: 'Webcams', icon: 'Webcam' },
];

export const users: User[] = [
  {
    id: 'u1',
    name: 'Aung Ko',
    username: 'aungko',
    role: 'admin',
    salesMade: 0,
    revenue: 0,
    status: 'active',
    joinedAt: '2023-01-15',
  },
  {
    id: 'u2',
    name: 'Hla Win',
    username: 'hlawin',
    role: 'manager',
    salesMade: 312,
    revenue: 4_820_000,
    status: 'active',
    joinedAt: '2023-03-22',
  },
  {
    id: 'u3',
    name: 'Su Mon',
    username: 'sumon',
    role: 'cashier',
    salesMade: 548,
    revenue: 7_340_000,
    status: 'active',
    joinedAt: '2023-06-10',
  },
  {
    id: 'u4',
    name: 'Kyaw Min',
    username: 'kyawmin',
    role: 'cashier',
    salesMade: 421,
    revenue: 5_980_000,
    status: 'active',
    joinedAt: '2023-08-01',
  },
  {
    id: 'u5',
    name: 'Nilar Soe',
    username: 'nilarsoe',
    role: 'cashier',
    salesMade: 289,
    revenue: 3_120_000,
    status: 'inactive',
    joinedAt: '2023-10-18',
  },
];

export const products: Product[] = [
  { id: 'p1', name: 'Logitech MX Keys S', sku: 'KB-LGX-001', categoryId: 'keyboards', price: 165000, cost: 121000, stock: 24, reorderLevel: 8, barcode: '750008001', image: '' },
  { id: 'p2', name: 'Keychron K2 Wireless', sku: 'KB-KCH-002', categoryId: 'keyboards', price: 145000, cost: 102000, stock: 6, reorderLevel: 8, barcode: '750008002', image: '' },
  { id: 'p3', name: 'Razer BlackWidow V4', sku: 'KB-RZR-003', categoryId: 'keyboards', price: 210000, cost: 156000, stock: 12, reorderLevel: 5, barcode: '750008003', image: '' },
  { id: 'p4', name: 'Logitech MX Master 3S', sku: 'MS-LGX-010', categoryId: 'mice', price: 135000, cost: 98000, stock: 31, reorderLevel: 10, barcode: '750009001', image: '' },
  { id: 'p5', name: 'Razer DeathAdder V3', sku: 'MS-RZR-011', categoryId: 'mice', price: 98000, cost: 71000, stock: 4, reorderLevel: 8, barcode: '750009002', image: '' },
  { id: 'p6', name: 'Logitech G Pro X Superlight', sku: 'MS-LGX-012', categoryId: 'mice', price: 178000, cost: 132000, stock: 0, reorderLevel: 6, barcode: '750009003', image: '' },
  { id: 'p7', name: 'Sony WH-1000XM5', sku: 'AU-SNY-020', categoryId: 'audio', price: 520000, cost: 410000, stock: 9, reorderLevel: 4, barcode: '750010001', image: '' },
  { id: 'p8', name: 'AirPods Pro 2', sku: 'AU-APL-021', categoryId: 'audio', price: 480000, cost: 385000, stock: 15, reorderLevel: 6, barcode: '750010002', image: '' },
  { id: 'p9', name: 'JBL Tune 770NC', sku: 'AU-JBL-022', categoryId: 'audio', price: 145000, cost: 102000, stock: 22, reorderLevel: 8, barcode: '750010003', image: '' },
  { id: 'p10', name: 'Samsung T7 SSD 1TB', sku: 'ST-SMS-030', categoryId: 'storage', price: 175000, cost: 128000, stock: 18, reorderLevel: 6, barcode: '750011001', image: '' },
  { id: 'p11', name: 'WD My Passport 2TB', sku: 'ST-WDC-031', categoryId: 'storage', price: 155000, cost: 112000, stock: 3, reorderLevel: 6, barcode: '750011002', image: '' },
  { id: 'p12', name: 'SanDisk Ultra 128GB', sku: 'ST-SND-032', categoryId: 'storage', price: 38000, cost: 26000, stock: 54, reorderLevel: 20, barcode: '750011003', image: '' },
  { id: 'p13', name: 'Anker USB-C Hub 7-in-1', sku: 'CB-ANK-040', categoryId: 'cables', price: 65000, cost: 42000, stock: 40, reorderLevel: 12, barcode: '750012001', image: '' },
  { id: 'p14', name: 'Belkin Thunderbolt 4 Cable', sku: 'CB-BLK-041', categoryId: 'cables', price: 82000, cost: 58000, stock: 7, reorderLevel: 10, barcode: '750012002', image: '' },
  { id: 'p15', name: 'Anker 511 Charger 30W', sku: 'CB-ANK-042', categoryId: 'cables', price: 42000, cost: 28000, stock: 0, reorderLevel: 15, barcode: '750012003', image: '' },
  { id: 'p16', name: 'Dell UltraSharp 27" 4K', sku: 'MN-DLL-050', categoryId: 'monitors', price: 850000, cost: 690000, stock: 5, reorderLevel: 3, barcode: '750013001', image: '' },
  { id: 'p17', name: 'LG UltraGear 32" 165Hz', sku: 'MN-LG-051', categoryId: 'monitors', price: 720000, cost: 580000, stock: 8, reorderLevel: 4, barcode: '750013002', image: '' },
  { id: 'p18', name: 'Logitech C920 Webcam', sku: 'WC-LGX-060', categoryId: 'webcams', price: 95000, cost: 68000, stock: 16, reorderLevel: 6, barcode: '750014001', image: '' },
  { id: 'p19', name: 'Razer Kiyo Pro', sku: 'WC-RZR-061', categoryId: 'webcams', price: 165000, cost: 122000, stock: 2, reorderLevel: 5, barcode: '750014002', image: '' },
  { id: 'p20', name: 'Logitech Mouse Pad XL', sku: 'AC-LGX-070', categoryId: 'accessories', price: 18000, cost: 9000, stock: 68, reorderLevel: 20, barcode: '750015001', image: '' },
  { id: 'p21', name: 'Laptop Stand Aluminium', sku: 'AC-GNR-071', categoryId: 'accessories', price: 32000, cost: 18000, stock: 27, reorderLevel: 10, barcode: '750015002', image: '' },
  { id: 'p22', name: 'USB-C to HDMI Adapter', sku: 'CB-GNR-072', categoryId: 'cables', price: 28000, cost: 15000, stock: 5, reorderLevel: 12, barcode: '750012004', image: '' },
];

export const dashboardStats: DashboardStats = {
  todayRevenue: 2_450_000,
  transactions: 38,
  averageSale: 64_473,
  lowStockCount: 6,
  profit: 780_000,
};

export const revenueSeries: RevenuePoint[] = [
  { label: 'Mon', revenue: 1_850_000, profit: 520_000 },
  { label: 'Tue', revenue: 2_120_000, profit: 610_000 },
  { label: 'Wed', revenue: 1_640_000, profit: 430_000 },
  { label: 'Thu', revenue: 2_380_000, profit: 690_000 },
  { label: 'Fri', revenue: 2_950_000, profit: 880_000 },
  { label: 'Sat', revenue: 3_420_000, profit: 1_020_000 },
  { label: 'Sun', revenue: 2_450_000, profit: 780_000 },
];

export const topProducts: TopProduct[] = [
  { productId: 'p4', name: 'Logitech MX Master 3S', sku: 'MS-LGX-010', units: 42, revenue: 5_670_000 },
  { productId: 'p8', name: 'AirPods Pro 2', sku: 'AU-APL-021', units: 31, revenue: 14_880_000 },
  { productId: 'p1', name: 'Logitech MX Keys S', sku: 'KB-LGX-001', units: 28, revenue: 4_620_000 },
  { productId: 'p10', name: 'Samsung T7 SSD 1TB', sku: 'ST-SMS-030', units: 24, revenue: 4_200_000 },
  { productId: 'p9', name: 'JBL Tune 770NC', sku: 'AU-JBL-022', units: 19, revenue: 2_755_000 },
];

function makeSale(
  id: number,
  daysAgo: number,
  cashierId: string,
  cashierName: string,
  lines: Array<{ product: Product; quantity: number }>,
  discount: number,
  status: Sale['status'],
): Sale {
  const items = lines.map((l) => ({
    productId: l.product.id,
    name: l.product.name,
    sku: l.product.sku,
    price: l.product.price,
    quantity: l.quantity,
    subtotal: l.product.price * l.quantity,
  }));
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const total = subtotal - discount;
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(9 + (id % 8), (id * 7) % 60, 0, 0);
  return {
    id: `s${id}`,
    invoice: `INV-2026-${String(1000 + id).padStart(4, '0')}`,
    date: date.toISOString(),
    cashierId,
    cashierName,
    items,
    subtotal,
    discount,
    total,
    status,
    paymentMethod: id % 3 === 0 ? 'kbzpay' : id % 5 === 0 ? 'banking' : 'cash',
  };
}

const p = (id: string) => products.find((x) => x.id === id)!;

export const sales: Sale[] = [
  makeSale(1, 0, 'u3', 'Su Mon', [{ product: p('p1'), quantity: 1 }, { product: p('p20'), quantity: 2 }], 0, 'completed'),
  makeSale(2, 0, 'u4', 'Kyaw Min', [{ product: p('p4'), quantity: 1 }], 0, 'completed'),
  makeSale(3, 0, 'u3', 'Su Mon', [{ product: p('p8'), quantity: 1 }, { product: p('p13'), quantity: 1 }], 15000, 'completed'),
  makeSale(4, 0, 'u2', 'Hla Win', [{ product: p('p10'), quantity: 2 }], 0, 'completed'),
  makeSale(5, 1, 'u4', 'Kyaw Min', [{ product: p('p7'), quantity: 1 }], 0, 'completed'),
  makeSale(6, 1, 'u3', 'Su Mon', [{ product: p('p9'), quantity: 1 }, { product: p('p12'), quantity: 2 }], 0, 'completed'),
  makeSale(7, 1, 'u2', 'Hla Win', [{ product: p('p16'), quantity: 1 }], 30000, 'completed'),
  makeSale(8, 2, 'u3', 'Su Mon', [{ product: p('p3'), quantity: 1 }], 0, 'refunded'),
  makeSale(9, 2, 'u4', 'Kyaw Min', [{ product: p('p17'), quantity: 1 }, { product: p('p18'), quantity: 1 }], 0, 'completed'),
  makeSale(10, 3, 'u3', 'Su Mon', [{ product: p('p2'), quantity: 1 }, { product: p('p5'), quantity: 1 }], 0, 'completed'),
  makeSale(11, 3, 'u2', 'Hla Win', [{ product: p('p1'), quantity: 2 }], 20000, 'completed'),
  makeSale(12, 4, 'u4', 'Kyaw Min', [{ product: p('p11'), quantity: 1 }], 0, 'voided'),
  makeSale(13, 4, 'u3', 'Su Mon', [{ product: p('p21'), quantity: 3 }], 0, 'completed'),
  makeSale(14, 5, 'u2', 'Hla Win', [{ product: p('p8'), quantity: 1 }, { product: p('p4'), quantity: 1 }], 0, 'completed'),
  makeSale(15, 6, 'u3', 'Su Mon', [{ product: p('p10'), quantity: 1 }, { product: p('p13'), quantity: 2 }], 0, 'completed'),
  makeSale(16, 6, 'u4', 'Kyaw Min', [{ product: p('p19'), quantity: 1 }], 0, 'completed'),
];
