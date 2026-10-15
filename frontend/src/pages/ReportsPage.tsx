import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  BarChart3,
  Archive,
  Download,
  RefreshCw,
  AlertTriangle,
  CreditCard,
  RotateCcw,
  Package,
  TrendingUp,
  WalletCards,
  ReceiptText,
  Boxes,
  Percent,
  Eye,
  FileText,
  X,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { HistoricalSalesPanel } from '@/components/reports/HistoricalSalesPanel';
import ExcelJS from 'exceljs';

import {
  ReportTrendChart,
} from '@/components/charts/ReportTrendChart';

import { useToast } from '@/context/ToastContext';

import { api } from '@/lib/api';

import {
  formatCurrency,
} from '@/lib/currency';


function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/* =========================================================
   TYPES
   ========================================================= */

type ReportRange =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'year'
  | 'custom';

type ChartRange = 'today' | 'week' | 'month' | 'year';

interface AppliedPeriod {
  range: ReportRange;
  from?: string;
  to?: string;
  label: string;
  query: string;
  chartRange: ChartRange;
}

interface Summary {
  grossSales: number;
  refundAmount: number;
  netSales: number;

  grossCogs: number;
  refundedCogs: number;
  cogs: number;

  grossProfit: number;
  grossMargin: number;

  transactions: number;
  averageSale: number;
  discounts: number;
  taxCollected: number;
  unitsSold: number;
  refundCount: number;
}

interface RevenuePoint {
  date: string;
  label: string;
  revenue: number;
  profit: number;
  cogs?: number;
}

interface TopProduct {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  units: number;
  revenue: number;
  cogs: number;
  profit: number;
}

interface PaymentMethod {
  method: string;
  transactions: number;
  amount: number;
}

interface RefundItem {
  productName: string;
  variantName: string | null;
  quantity: number;
}

interface RefundRow {
  id: string;
  invoice: string;
  total: number;
  paymentMethod: string;
  cashierName: string;
  date: string;
  originalSaleDate?: string;
  reason?: string | null;
  items?: RefundItem[];
}

interface LowStockItem {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
  stock: number;
  reorderLevel: number;
  status:
    | 'low_stock'
    | 'out_of_stock';
}

/* =========================================================
   HELPERS
   ========================================================= */

function rangeLabel(
  range: ReportRange
) {
  switch (range) {
    case 'today':
      return 'Today';

    case 'yesterday':
      return 'Yesterday';

    case 'week':
      return 'Last 7 Days';

    case 'month':
      return 'Last 30 Days';

    case 'year':
      return 'This Year';

    case 'custom':
      return 'Custom';
  }
}

function localDateOnly(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatSelectedDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function presetPeriod(range: Exclude<ReportRange, 'custom'>): AppliedPeriod {
  return {
    range,
    label: rangeLabel(range),
    query: `range=${range}`,
    chartRange: range === 'year' ? 'year' : range === 'week' ? 'week' : range === 'month' ? 'month' : 'today',
  };
}

function paymentLabel(
  method: string
) {
  switch (
    method.toLowerCase()
  ) {
    case 'cash':
      return 'Cash';

    case 'banking':
      return 'Banking';

    case 'kbzpay':
      return 'KBZPay';

    case 'wavepay':
      return 'WavePay';

    case 'mmqr':
      return 'MMQR';

    default:
      return method;
  }
}

function refundReasonText(
  reason?: string | null
) {
  const value = reason?.trim();
  return value ? value : '';
}

function RefundInfo({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">

      <div
        className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${
          tone === 'danger'
            ? 'text-red-500'
            : 'text-slate-400'
        }`}
      >
        {icon}
        {label}
      </div>

      <p className="mt-2 text-sm font-semibold text-slate-800">
        {value}
      </p>

    </div>
  );
}

/* =========================================================
   REPORTS PAGE
   ========================================================= */

export function ReportsPage() {
  const { toast } =
    useToast();

  const [period, setPeriod] = useState<AppliedPeriod>(() => presetPeriod('today'));
  const [loadedPeriod, setLoadedPeriod] = useState<AppliedPeriod>(() => presetPeriod('today'));
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(() => localDateOnly());
  const [customTo, setCustomTo] = useState(() => localDateOnly());
  const [periodError, setPeriodError] = useState<string | null>(null);
  const reportRequestRef = useRef(0);
  const [reportSection, setReportSection] = useState<'current' | 'historical'>('current');

  const [
    summary,
    setSummary,
  ] = useState<Summary | null>(
    null
  );

  const [
    trend,
    setTrend,
  ] = useState<
    RevenuePoint[]
  >([]);

  const [
    topProducts,
    setTopProducts,
  ] = useState<
    TopProduct[]
  >([]);

  const [
    payments,
    setPayments,
  ] = useState<
    PaymentMethod[]
  >([]);

  const [
    refunds,
    setRefunds,
  ] = useState<
    RefundRow[]
  >([]);

  const [
  selectedRefund,
  setSelectedRefund,
] = useState<RefundRow | null>(null);

const [
  showAllRefunds,
  setShowAllRefunds,
] = useState(false);

  const [
    lowStock,
    setLowStock,
  ] = useState<
    LowStockItem[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  /* =========================================================
     LOAD REPORTS
     ========================================================= */

  useEffect(() => {
    loadReports();
    // The applied query is the request identity; other period fields are display metadata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.query]);

  useEffect(() => {
    async function loadLowStock() {
      try {
        setLowStock(await api.get<LowStockItem[]>('/api/reports/low-stock'));
      } catch (loadError) {
        toast(
          loadError instanceof Error ? loadError.message : 'Failed to load low-stock data.',
          'error'
        );
      }
    }
    loadLowStock();
  }, [toast]);

  async function loadReports() {
    const requestId = ++reportRequestRef.current;
    setLoading(true);
    setError(null);

    try {
      const [
        summaryData,
        trendData,
        topData,
        paymentData,
        refundData,
      ] = await Promise.all([
        api.get<Summary>(
          `/api/reports/summary?${period.query}`
        ),

        api.get<RevenuePoint[]>(
          `/api/reports/sales-trend?${period.query}`
        ),

        api.get<TopProduct[]>(
          `/api/reports/top-products?${period.query}&limit=10`
        ),

        api.get<PaymentMethod[]>(
          `/api/reports/payment-methods?${period.query}`
        ),

        api.get<RefundRow[]>(
          `/api/reports/refunds?${period.query}`
        ),
      ]);

      if (requestId !== reportRequestRef.current) return;

      setSummary({
        ...summaryData,
        taxCollected: Number(
          summaryData.taxCollected ?? 0
        ),
      });

      setTrend(
        trendData
      );

      setTopProducts(
        topData
      );

      setPayments(
        paymentData
      );

      setRefunds(
        refundData
      );

      setLoadedPeriod(period);
    } catch (error) {
      if (requestId !== reportRequestRef.current) return;
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to load reports.'
      );
    } finally {
      if (requestId === reportRequestRef.current) setLoading(false);
    }
  }

  function selectPreset(nextRange: Exclude<ReportRange, 'custom'>) {
    setPeriodError(null);
    setCustomOpen(false);
    setPeriod(presetPeriod(nextRange));
  }

  function applyCustomPeriod() {
    const today = localDateOnly();
    if (!customFrom || !customTo) {
      setPeriodError('Choose both From and To dates.');
      return;
    }
    if (customFrom > customTo) {
      setPeriodError('From date cannot be after To date.');
      return;
    }
    if (customTo > today) {
      setPeriodError('Reporting dates cannot be in the future.');
      return;
    }
    const label = customFrom === customTo
      ? formatSelectedDate(customFrom)
      : `${formatSelectedDate(customFrom)} – ${formatSelectedDate(customTo)}`;
    setPeriodError(null);
    setPeriod({
      range: 'custom',
      from: customFrom,
      to: customTo,
      label,
      query: `range=custom&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`,
      chartRange: customFrom === customTo ? 'today' : 'month',
    });
  }

  /* =========================================================
     DERIVED DATA
     ========================================================= */

  const paymentTotal =
    useMemo(
      () =>
        payments.reduce(
          (
            sum,
            payment
          ) =>
            sum +
            payment.amount,
          0
        ),
      [payments]
    );

  const salesRevenue = summary?.netSales ?? 0;

  const unitsPerSale =
    summary &&
    summary.transactions > 0
      ? summary.unitsSold /
        summary.transactions
      : 0;

  const refundRate =
    summary &&
    summary.transactions +
      summary.refundCount >
      0
      ? (
          summary.refundCount /
          (
            summary.transactions +
            summary.refundCount
          )
        ) *
        100
      : 0;
  const visibleRefunds =
  showAllRefunds
    ? refunds
    : refunds.slice(0, 5);    

  /* =========================================================
     EXPORT
     ========================================================= */

  async function exportReport() {
  if (!summary) {
    toast('No report data available.', 'warning');
    return;
  }

  try {
    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'CapyTech';
    workbook.created = new Date();

    /* =====================================================
       OVERVIEW SHEET
       ===================================================== */

    const overview = workbook.addWorksheet('Overview', {
      views: [{ showGridLines: false }],
    });

    overview.columns = [
      { key: 'a', width: 24 },
      { key: 'b', width: 24 },
      { key: 'c', width: 24 },
      { key: 'd', width: 24 },
    ];

    // Main title
    overview.mergeCells('A1:D1');

    const titleCell = overview.getCell('A1');
    titleCell.value = 'CapyTech POS — Business Report';
    titleCell.font = {
      bold: true,
      size: 20,
      color: { argb: 'FF0F172A' },
    };
    titleCell.alignment = {
      vertical: 'middle',
      horizontal: 'left',
    };

    overview.getRow(1).height = 32;

    // Period
    overview.mergeCells('A2:D2');

    const periodCell = overview.getCell('A2');
    periodCell.value = `Reporting Period: ${loadedPeriod.label}`;
    periodCell.font = {
      bold: true,
      size: 11,
      color: { argb: 'FF475569' },
    };

    overview.mergeCells('A3:D3');

    const generatedCell = overview.getCell('A3');
    generatedCell.value =
      `Generated: ${new Date().toLocaleString()}`;
    generatedCell.font = {
      size: 10,
      color: { argb: 'FF94A3B8' },
    };

    /* =====================================================
       PERFORMANCE OVERVIEW
       ===================================================== */

    overview.mergeCells('A5:D5');

    const sectionTitle =
      overview.getCell('A5');

    sectionTitle.value =
      'PERFORMANCE OVERVIEW';

    sectionTitle.font = {
      bold: true,
      size: 12,
      color: { argb: 'FFFFFFFF' },
    };

    sectionTitle.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: 'FF1E293B',
      },
    };

    sectionTitle.alignment = {
      vertical: 'middle',
    };

    overview.getRow(5).height = 24;

    const overviewRows = [
      ['Revenue', summary.netSales],
      ['COGS', summary.cogs],
      ['Gross Profit', summary.grossProfit],
      ['Gross Margin', summary.grossMargin / 100],
      ['Transactions', summary.transactions],
      ['Average Sale', summary.averageSale],
      ['Units Sold', summary.unitsSold],
      ['Discounts', summary.discounts],
      ['Tax Collected', summary.taxCollected],
      ['Refund Count', summary.refundCount],
      ['Refund Amount', summary.refundAmount],
    ];

    let overviewRow = 6;

    overviewRows.forEach(([label, value]) => {
      overview.getCell(`A${overviewRow}`).value =
        label;

      overview.getCell(`A${overviewRow}`).font = {
        bold: true,
        color: {
          argb: 'FF475569',
        },
      };

      overview.getCell(`B${overviewRow}`).value =
        value as number;

      overview.getCell(`B${overviewRow}`).font = {
        bold: true,
        color: {
          argb:
            label === 'Gross Profit'
              ? 'FF059669'
              : label === 'Refund Amount'
                ? 'FFDC2626'
                : 'FF0F172A',
        },
      };

      overview.getCell(`A${overviewRow}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'FFF8FAFC',
        },
      };

      overview.getCell(`B${overviewRow}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'FFFFFFFF',
        },
      };

      if (
        label === 'Revenue' ||
        label === 'COGS' ||
        label === 'Gross Profit' ||
        label === 'Average Sale' ||
        label === 'Discounts' ||
        label === 'Tax Collected' ||
        label === 'Refund Amount'
      ) {
        overview.getCell(
          `B${overviewRow}`
        ).numFmt = '#,##0 "Ks"';
      }

      if (label === 'Gross Margin') {
        overview.getCell(
          `B${overviewRow}`
        ).numFmt = '0.0%';
      }

      overviewRow++;
    });

    /* =====================================================
       PRODUCT PERFORMANCE SHEET
       ===================================================== */

    const productsSheet =
      workbook.addWorksheet(
        'Products',
        {
          views: [
            {
              showGridLines: false,
              state: 'frozen',
              ySplit: 4,
            },
          ],
        }
      );

    productsSheet.columns = [
      { header: '#', key: 'rank', width: 8 },
      {
        header: 'Product / Variant',
        key: 'product',
        width: 42,
      },
      {
        header: 'SKU',
        key: 'sku',
        width: 20,
      },
      {
        header: 'Units',
        key: 'units',
        width: 12,
      },
      {
        header: 'Revenue',
        key: 'revenue',
        width: 18,
      },
      {
        header: 'COGS',
        key: 'cogs',
        width: 18,
      },
      {
        header: 'Profit',
        key: 'profit',
        width: 18,
      },
      {
        header: 'Margin',
        key: 'margin',
        width: 14,
      },
    ];

    productsSheet.mergeCells('A1:H1');

    productsSheet.getCell('A1').value =
      'Product Performance';

    productsSheet.getCell('A1').font = {
      bold: true,
      size: 18,
      color: {
        argb: 'FF0F172A',
      },
    };

    productsSheet.mergeCells('A2:H2');

    productsSheet.getCell('A2').value =
      `${loadedPeriod.label} — Variant-level profitability`;

    productsSheet.getCell('A2').font = {
      size: 10,
      color: {
        argb: 'FF64748B',
      },
    };

    // Header row = row 4
    const productHeader =
      productsSheet.getRow(4);

    [
      '#',
      'Product / Variant',
      'SKU',
      'Units',
      'Revenue',
      'COGS',
      'Profit',
      'Margin',
    ].forEach((value, index) => {
      const cell =
        productHeader.getCell(index + 1);

      cell.value = value;

      cell.font = {
        bold: true,
        color: {
          argb: 'FFFFFFFF',
        },
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'FF334155',
        },
      };

      cell.alignment = {
        vertical: 'middle',
      };
    });

    productHeader.height = 24;

    topProducts.forEach(
      (product, index) => {
        const margin =
          product.revenue > 0
            ? product.profit /
              product.revenue
            : 0;

        const row =
          productsSheet.addRow({
            rank: index + 1,
            product: product.name,
            sku: product.sku || '',
            units: product.units,
            revenue: product.revenue,
            cogs: product.cogs,
            profit: product.profit,
            margin,
          });

        row.getCell(5).numFmt =
          '#,##0 "Ks"';

        row.getCell(6).numFmt =
          '#,##0 "Ks"';

        row.getCell(7).numFmt =
          '#,##0 "Ks"';

        row.getCell(8).numFmt =
          '0.0%';

        row.getCell(7).font = {
          bold: true,
          color: {
            argb: 'FF059669',
          },
        };

        if (index % 2 === 1) {
          row.eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: {
                argb: 'FFF8FAFC',
              },
            };
          });
        }
      }
    );

    productsSheet.autoFilter = {
      from: 'A4',
      to: 'H4',
    };

    /* =====================================================
       PAYMENTS SHEET
       ===================================================== */

    const paymentsSheet =
      workbook.addWorksheet(
        'Payments',
        {
          views: [
            {
              showGridLines: false,
            },
          ],
        }
      );

    paymentsSheet.columns = [
      {
        header: 'Method',
        key: 'method',
        width: 22,
      },
      {
        header: 'Transactions',
        key: 'transactions',
        width: 18,
      },
      {
        header: 'Amount',
        key: 'amount',
        width: 20,
      },
      {
        header: 'Share',
        key: 'share',
        width: 16,
      },
    ];

    paymentsSheet.mergeCells('A1:D1');

    paymentsSheet.getCell('A1').value =
      'Payment Analysis';

    paymentsSheet.getCell('A1').font = {
      bold: true,
      size: 18,
    };

    const paymentHeader =
      paymentsSheet.getRow(3);

    [
      'Method',
      'Transactions',
      'Amount',
      'Share',
    ].forEach((value, index) => {
      const cell =
        paymentHeader.getCell(index + 1);

      cell.value = value;

      cell.font = {
        bold: true,
        color: {
          argb: 'FFFFFFFF',
        },
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'FF334155',
        },
      };
    });

    payments.forEach((payment) => {
      const share =
        paymentTotal > 0
          ? payment.amount /
            paymentTotal
          : 0;

      const row =
        paymentsSheet.addRow({
          method:
            paymentLabel(
              payment.method
            ),
          transactions:
            payment.transactions,
          amount:
            payment.amount,
          share,
        });

      row.getCell(3).numFmt =
        '#,##0 "Ks"';

      row.getCell(4).numFmt =
        '0.0%';
    });

    /* =====================================================
       REFUNDS SHEET
       ===================================================== */

    const refundsSheet =
      workbook.addWorksheet(
        'Refunds',
        {
          views: [
            {
              showGridLines: false,
            },
          ],
        }
      );

    refundsSheet.columns = [
      {
        header: 'Invoice',
        key: 'invoice',
        width: 18,
      },
      {
        header: 'Refunded At',
        key: 'refundedAt',
        width: 24,
      },
      {
        header: 'Original Sale',
        key: 'originalSale',
        width: 24,
      },
      {
        header: 'Cashier',
        key: 'cashier',
        width: 18,
      },
      {
        header: 'Payment',
        key: 'payment',
        width: 18,
      },
      {
        header: 'Amount',
        key: 'amount',
        width: 18,
      },
      {
        header: 'Refund Reason',
        key: 'reason',
        width: 40,
      },
      {
        header: 'Returned Items',
        key: 'items',
        width: 55,
      },
    ];

    refundsSheet.mergeCells('A1:H1');

    refundsSheet.getCell('A1').value =
      'Refund Analysis';

    refundsSheet.getCell('A1').font = {
      bold: true,
      size: 18,
      color: {
        argb: 'FFB91C1C',
      },
    };

    const refundHeader =
      refundsSheet.getRow(3);

    [
      'Invoice',
      'Refunded At',
      'Original Sale',
      'Cashier',
      'Payment',
      'Refund Amount',
      'Refund Reason',
      'Returned Items',
    ].forEach((value, index) => {
      const cell =
        refundHeader.getCell(index + 1);

      cell.value = value;

      cell.font = {
        bold: true,
        color: {
          argb: 'FFFFFFFF',
        },
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'FFB91C1C',
        },
      };
    });

    refunds.forEach((refund) => {
      const items =
        refund.items
          ?.map((item) => {
            const variant =
              item.variantName
                ? ` - ${item.variantName}`
                : '';

            return `${item.productName}${variant} x${item.quantity}`;
          })
          .join('\n') ?? '';

      const row =
        refundsSheet.addRow({
          invoice:
            refund.invoice,

          refundedAt:
            formatDateTime(
              refund.date
            ),

          originalSale:
            refund.originalSaleDate
              ? formatDateTime(
                  refund.originalSaleDate
                )
              : '',

          cashier:
            refund.cashierName,

          payment:
            paymentLabel(
              refund.paymentMethod
            ),

          amount:
            refund.total,

          reason:
            refundReasonText(refund.reason) ||
            'No reason recorded',

          items,
        });

      row.getCell(6).numFmt =
        '#,##0 "Ks"';

      row.getCell(6).font = {
        bold: true,
        color: {
          argb: 'FFDC2626',
        },
      };

      row.getCell(7).alignment = {
        wrapText: true,
        vertical: 'top',
      };

      row.getCell(8).alignment = {
        wrapText: true,
        vertical: 'top',
      };

      const reasonLines = Math.ceil(
        (refundReasonText(refund.reason).length || 18) /
          40
      );

      row.height = Math.max(
        22,
        (refund.items?.length ?? 1) * 18,
        reasonLines * 18
      );
    });

    /* =====================================================
       INVENTORY RISK SHEET
       ===================================================== */

    const inventorySheet =
      workbook.addWorksheet(
        'Inventory Risk',
        {
          views: [
            {
              showGridLines: false,
            },
          ],
        }
      );

    inventorySheet.columns = [
      {
        header: 'Product',
        key: 'product',
        width: 42,
      },
      {
        header: 'SKU',
        key: 'sku',
        width: 22,
      },
      {
        header: 'Stock',
        key: 'stock',
        width: 12,
      },
      {
        header: 'Reorder Level',
        key: 'reorder',
        width: 16,
      },
      {
        header: 'Status',
        key: 'status',
        width: 18,
      },
    ];

    inventorySheet.mergeCells('A1:E1');

    inventorySheet.getCell('A1').value =
      'Inventory Risk';

    inventorySheet.getCell('A1').font = {
      bold: true,
      size: 18,
    };

    const inventoryHeader =
      inventorySheet.getRow(3);

    [
      'Product',
      'SKU',
      'Stock',
      'Reorder Level',
      'Status',
    ].forEach((value, index) => {
      const cell =
        inventoryHeader.getCell(index + 1);

      cell.value = value;

      cell.font = {
        bold: true,
        color: {
          argb: 'FFFFFFFF',
        },
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'FFB45309',
        },
      };
    });

    lowStock.forEach((item) => {
      const row =
        inventorySheet.addRow({
          product:
            item.name,
          sku:
            item.sku,
          stock:
            item.stock,
          reorder:
            item.reorderLevel,
          status:
            item.status ===
            'out_of_stock'
              ? 'Out of Stock'
              : 'Low Stock',
        });

      row.getCell(5).font = {
        bold: true,
        color: {
          argb:
            item.status ===
            'out_of_stock'
              ? 'FFDC2626'
              : 'FFD97706',
        },
      };
    });

    /* =====================================================
       GLOBAL TABLE STYLE
       ===================================================== */

    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.alignment = {
          vertical: 'middle',
        };
      });
    });

    /* =====================================================
       GENERATE XLSX
       ===================================================== */

    const buffer =
      await workbook.xlsx.writeBuffer();

    const blob =
      new Blob(
        [buffer],
        {
          type:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      );

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement('a');

    const date =
      new Date()
        .toISOString()
        .slice(0, 10);

    link.href = url;

    link.download =
      `CapyTech_Report_${loadedPeriod.range}_${loadedPeriod.from || date}_${loadedPeriod.to || date}.xlsx`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(
      link
    );

    URL.revokeObjectURL(url);

    toast(
      `${loadedPeriod.label} Excel report exported successfully.`,
      'success'
    );
  } catch (error) {
    console.error(
      'Excel export error:',
      error
    );

    toast(
      'Failed to export Excel report.',
      'error'
    );
  }
}
  if (reportSection === 'historical') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          subtitle="Current business reporting and isolated legacy sales history."
        />
        <ReportSectionTabs active={reportSection} onChange={setReportSection} />
        <HistoricalSalesPanel />
      </div>
    );
  }

  /* =========================================================
     LOADING
     ========================================================= */

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          subtitle="Business intelligence and financial analytics."
        />

        <Card>
          <div className="flex min-h-[420px] flex-col items-center justify-center text-slate-400">
            <RefreshCw className="mb-3 h-7 w-7 animate-spin" />

            <p className="text-sm font-medium">
              Loading reports...
            </p>
          </div>
        </Card>
      </div>
    );
  }

  /* =========================================================
     ERROR
     ========================================================= */

  if (!summary) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          subtitle="Business intelligence and financial analytics."
        />

        <Card>
          <div className="flex min-h-[320px] flex-col items-center justify-center">
            <AlertTriangle className="mb-3 h-8 w-8 text-danger-500" />

            <p className="font-semibold text-slate-900">
              Reports could not be loaded
            </p>

            <p className="mt-1 text-sm text-slate-500">
              {error ??
                'Unknown error'}
            </p>

            <button
              type="button"
              onClick={
                loadReports
              }
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Try Again
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* =====================================================
          HEADER
          ===================================================== */}

      <PageHeader
        title="Reports"
        subtitle="Analyze revenue, profit, products, payments, refunds, and operational performance."
        actions={
          <Button
            variant="outline"
            leftIcon={
              <Download className="h-4 w-4" />
            }
            onClick={
              exportReport
            }
            disabled={loading}
          >
            Export
          </Button>
        }
      />

      <ReportSectionTabs active={reportSection} onChange={setReportSection} />

      {/* =====================================================
          ANALYSIS TOOLBAR
          ===================================================== */}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">

        <div className="flex flex-wrap items-center justify-between gap-4">

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Reporting Period
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  'today',
                  'yesterday',
                  'week',
                  'month',
                  'year',
                ] as Exclude<ReportRange, 'custom'>[]
              ).map(
                (
                  item
                ) => {
                  const active =
                    period.range ===
                    item;

                  return (
                    <button
                      key={
                        item
                      }
                      type="button"
                      onClick={() => selectPreset(item)}
                      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                        active
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {rangeLabel(
                        item
                      )}
                    </button>
                  );
                }
              )}
              <button
                type="button"
                onClick={() => {
                  setCustomOpen(true);
                  setPeriodError(null);
                }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                  period.range === 'custom'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                Custom
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 px-4 py-3 text-right">
            <p className="text-xs font-medium text-slate-400">
              Active analysis
            </p>

            <p className="mt-0.5 text-sm font-semibold text-slate-900">
              {loading ? `Loading ${period.label}…` : loadedPeriod.label}
            </p>
          </div>

        </div>

        {customOpen && (
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm font-semibold text-slate-700">
              From Date
              <input
                type="date"
                value={customFrom}
                max={localDateOnly()}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              To Date
              <input
                type="date"
                value={customTo}
                max={localDateOnly()}
                onChange={(event) => setCustomTo(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3"
              />
            </label>
            <Button onClick={applyCustomPeriod}>Apply Dates</Button>
            {periodError && (
              <p className="text-sm font-semibold text-danger-600 sm:col-span-3">{periodError}</p>
            )}
          </div>
        )}

        {error && summary && (
          <div className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700">
            {error} The previous successful report remains displayed.
          </div>
        )}

      </div>

      {/* =====================================================
          PERFORMANCE OVERVIEW
          ===================================================== */}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-200 px-5 py-4">
  <p className="text-sm font-bold uppercase tracking-[0.12em] text-slate-800">
    Performance Overview
  </p>

  <p className="mt-1 text-sm font-medium text-slate-600">
    Financial results for {loadedPeriod.label}.
  </p>
</div>

        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 md:grid-cols-3 xl:grid-cols-9">

          <ReportMetric
  label="Gross Sales"
  value={formatCurrency(
    summary.grossSales
  )}
  icon={
    <WalletCards className="h-4 w-4" />
  }
/>

<ReportMetric
  label="Refunds"
  value={formatCurrency(
    summary.refundAmount
  )}
  icon={
    <RotateCcw className="h-4 w-4" />
  }
  valueClassName={
    summary.refundAmount > 0
      ? 'text-danger-600'
      : undefined
  }
/>

<ReportMetric
  label="Net Sales"
  value={formatCurrency(
    summary.netSales
  )}
  icon={
    <WalletCards className="h-4 w-4" />
  }
  valueClassName="text-brand-600"
/>

          <ReportMetric
            label="Tax Collected"
            value={formatCurrency(
              summary.taxCollected
            )}
            icon={
              <ReceiptText className="h-4 w-4" />
            }
          />

          <ReportMetric
            label="COGS"
            value={formatCurrency(
              summary.cogs
            )}
            icon={
              <Boxes className="h-4 w-4" />
            }
          />

          <ReportMetric
            label="Gross Profit"
            value={formatCurrency(
              summary.grossProfit
            )}
            icon={
              <TrendingUp className="h-4 w-4" />
            }
            valueClassName="text-success-600"
          />

          <ReportMetric
            label="Margin"
            value={`${summary.grossMargin.toFixed(
              1
            )}%`}
            icon={
              <Percent className="h-4 w-4" />
            }
            valueClassName="text-success-600"
          />

          <ReportMetric
            label="Transactions"
            value={String(
              summary.transactions
            )}
            icon={
              <ReceiptText className="h-4 w-4" />
            }
          />

          <ReportMetric
            label="Average Sale"
            value={formatCurrency(
              summary.averageSale
            )}
            icon={
              <BarChart3 className="h-4 w-4" />
            }
          />

          <ReportMetric
            label="Units Sold"
            value={String(
              summary.unitsSold
            )}
            icon={
              <Package className="h-4 w-4" />
            }
          />

        </div>

      </section>

      {/* =====================================================
          SALES ANALYSIS
          ===================================================== */}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">

          <div>
            <h2 className="text-base font-bold text-slate-900">
              Revenue & Profit Analysis
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Revenue, cost, and profitability over {loadedPeriod.label.toLowerCase()}.
            </p>
          </div>

          <div className="flex items-center gap-5 text-xs">

            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
              Revenue
            </span>

            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full bg-success-500" />
              Gross Profit
            </span>

            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
              COGS
            </span>

          </div>

        </div>

        <div className="p-5">
          <ReportTrendChart
            data={trend}
            range={loadedPeriod.chartRange}
          />
        </div>

      </section>

      {/* =====================================================
          PRODUCT PERFORMANCE
          ===================================================== */}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">
            Product Performance
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Variant-level profitability and sales contribution.
          </p>
        </div>

        {topProducts.length ===
        0 ? (
          <EmptyMessage
            text="No product sales for this period."
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">

            <table
              className="w-full"
              style={{
                minWidth:
                  '1050px',
              }}
            >
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">

                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Rank
                  </th>

                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Product / Variant
                  </th>

                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    SKU
                  </th>

                  <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Units
                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Revenue
                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    COGS
                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Profit
                  </th>

                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Margin
                  </th>

                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">

                {topProducts.map(
                  (
                    product,
                    index
                  ) => {
                    const margin =
                      product.revenue >
                      0
                        ? (
                            product.profit /
                            product.revenue
                          ) *
                          100
                        : 0;

                    return (
                      <tr
                        key={`${product.productId}-${product.variantId ?? 'product'}`}
                        className="transition-colors hover:bg-slate-50/60"
                      >

                        <td className="px-5 py-4">
                          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-bold text-slate-600">
                            {index +
                              1}
                          </span>
                        </td>

                        <td className="px-5 py-4">

                          <p className="max-w-[320px] truncate text-sm font-semibold text-slate-900">
                            {
                              product.name
                            }
                          </p>

                        </td>

                        <td className="px-5 py-4 font-mono text-xs text-slate-400">
                          {product.sku ||
                            '—'}
                        </td>

                        <td className="px-5 py-4 text-center text-sm font-semibold text-slate-700 tabular-nums">
                          {
                            product.units
                          }
                        </td>

                        <td className="px-5 py-4 text-right text-sm font-bold text-slate-900 tabular-nums">
                          {formatCurrency(
                            product.revenue
                          )}
                        </td>

                        <td className="px-5 py-4 text-right text-sm text-slate-600 tabular-nums">
                          {formatCurrency(
                            product.cogs
                          )}
                        </td>

                        <td className="px-5 py-4 text-right text-sm font-bold text-success-600 tabular-nums">
                          {formatCurrency(
                            product.profit
                          )}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <span className="inline-flex rounded-md bg-success-50 px-2 py-1 text-xs font-semibold text-success-700">
                            {margin.toFixed(
                              1
                            )}
                            %
                          </span>
                        </td>

                      </tr>
                    );
                  }
                )}

              </tbody>

            </table>

          </div>
        )}

      </section>

      {/* =====================================================
          PAYMENT + TRANSACTION QUALITY
          ===================================================== */}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">

        {/* Payment Analysis */}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-3">

          <div className="border-b border-slate-200 px-5 py-4">

            <h2 className="text-base font-bold text-slate-900">
              Payment Analysis
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Revenue contribution by payment method.
            </p>

          </div>

          {payments.length ===
          0 ? (
            <EmptyMessage
              text="No payment data for this period."
            />
          ) : (
            <div className="overflow-x-auto">

              <table className="w-full">

                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">

                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                      Method
                    </th>

                    <th className="px-5 py-3 text-center text-xs font-semibold uppercase text-slate-500">
                      Transactions
                    </th>

                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-slate-500">
                      Amount
                    </th>

                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-slate-500">
                      Share
                    </th>

                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">

                  {payments.map(
                    (
                      payment
                    ) => {
                      const percentage =
                        paymentTotal >
                        0
                          ? (
                              payment.amount /
                              paymentTotal
                            ) *
                            100
                          : 0;

                      return (
                        <tr
                          key={
                            payment.method
                          }
                          className="hover:bg-slate-50/50"
                        >

                          <td className="px-5 py-4">

                            <div className="flex items-center gap-3">

                              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                <CreditCard className="h-4 w-4" />
                              </span>

                              <span className="text-sm font-semibold text-slate-900">
                                {paymentLabel(
                                  payment.method
                                )}
                              </span>

                            </div>

                          </td>

                          <td className="px-5 py-4 text-center text-sm font-semibold text-slate-700">
                            {
                              payment.transactions
                            }
                          </td>

                          <td className="px-5 py-4 text-right text-sm font-bold text-slate-900">
                            {formatCurrency(
                              payment.amount
                            )}
                          </td>

                          <td className="px-5 py-4 text-right">

                            <div className="ml-auto w-[110px]">

                              <p className="mb-1 text-xs font-semibold text-slate-600">
                                {percentage.toFixed(
                                  1
                                )}
                                %
                              </p>

                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">

                                <div
                                  className="h-full rounded-full bg-brand-500"
                                  style={{
                                    width: `${percentage}%`,
                                  }}
                                />

                              </div>

                            </div>

                          </td>

                        </tr>
                      );
                    }
                  )}

                </tbody>

              </table>

            </div>
          )}

        </section>

        {/* Sales Efficiency */}

<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-2">

  {/* Header */}
  <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">

    <div className="flex items-center gap-3">

      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <TrendingUp className="h-5 w-5" />
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Sales Efficiency
        </p>

        <h2 className="mt-0.5 text-base font-bold text-slate-900">
          Transaction performance
        </h2>
      </div>

    </div>

  </div>

  {/* Metrics */}
  <div className="divide-y divide-slate-100 px-5">

    <QualityMetric
      label="Sales Revenue"
      value={formatCurrency(salesRevenue)}
      valueClassName="text-brand-600"
    />

    <QualityMetric
      label="Average Sale"
      value={formatCurrency(summary.averageSale)}
    />

    <QualityMetric
      label="Units / Transaction"
      value={unitsPerSale.toFixed(2)}
    />

    <QualityMetric
      label="Discounts"
      value={formatCurrency(summary.discounts)}
    />

    <QualityMetric
      label="Tax Collected"
      value={formatCurrency(summary.taxCollected)}
    />

    <QualityMetric
      label="Refund Rate"
      value={`${refundRate.toFixed(1)}%`}
      valueClassName={
        refundRate >= 20
          ? 'text-danger-600'
          : refundRate > 0
            ? 'text-warning-600'
            : 'text-success-600'
      }
    />

  </div>

</section>

      </div>

      {/* =====================================================
    REFUND ANALYSIS
    ===================================================== */}

<section className="overflow-hidden rounded-xl border border-red-100 bg-white shadow-sm">

  {/* Header */}
  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-red-100 bg-gradient-to-r from-red-50/60 via-white to-white px-5 py-4">

    <div className="flex items-center gap-3">

      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-red-100">
        <RotateCcw className="h-5 w-5" />
      </div>

      <div>
        <h2 className="text-base font-bold text-slate-900">
          Refund Analysis
        </h2>

        <p className="mt-0.5 text-sm text-slate-500">
          Review refund activity and financial impact.
        </p>
      </div>

    </div>

    <div className="flex items-center gap-6">

      <div className="text-right">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Refunds
        </p>

        <p className="mt-0.5 text-lg font-bold text-slate-900">
          {refunds.length}
        </p>
      </div>

      <div className="h-9 w-px bg-red-100" />

      <div className="text-right">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-red-400">
          Total Impact
        </p>

        <p className="mt-0.5 text-lg font-bold text-red-600">
          -
          {formatCurrency(
            refunds.reduce(
              (sum, refund) => sum + refund.total,
              0
            )
          )}
        </p>
      </div>

    </div>

  </div>

  {/* Refund rows */}
  {refunds.length === 0 ? (
    <EmptyMessage text="No refunds for this period." />
  ) : (
    <>
      <div className="divide-y divide-slate-100">

        {visibleRefunds.map((refund) => {

          const totalUnits =
            refund.items?.reduce(
              (sum, item) => sum + item.quantity,
              0
            ) ?? 0;

          return (
            <div
              key={refund.id}
              className="group flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-red-50/20 lg:flex-row lg:items-center"
            >

              {/* Invoice */}
              <div className="flex min-w-[190px] items-center gap-3">

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500">
                  <ReceiptText className="h-4.5 w-4.5" />
                </div>

                <div>
                  <div className="flex items-center gap-2">

                    <span className="font-mono text-sm font-bold text-slate-900">
                      {refund.invoice}
                    </span>

                    <span className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      Refunded
                    </span>

                  </div>

                  <p className="mt-1 text-xs text-slate-400">
                    {totalUnits} {totalUnits === 1 ? 'unit' : 'units'} returned
                  </p>
                </div>

              </div>

              {/* Refund date */}
              <div className="min-w-[180px] flex-1">

                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Refunded At
                </p>

                <p className="mt-1 text-sm font-medium text-slate-700">
                  {formatDateTime(refund.date)}
                </p>

              </div>

              {/* Cashier */}
              <div className="min-w-[120px]">

                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Cashier
                </p>

                <p className="mt-1 text-sm font-medium text-slate-700">
                  {refund.cashierName}
                </p>

              </div>

              {/* Payment */}
              <div className="min-w-[110px]">

                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Payment
                </p>

                <p className="mt-1 text-sm font-medium text-slate-700">
                  {paymentLabel(refund.paymentMethod)}
                </p>

              </div>

              {/* Reason */}
              <div className="min-w-[180px] max-w-[280px] flex-1">

                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Reason
                </p>

                {refundReasonText(refund.reason) ? (
                  <p
                    title={refundReasonText(refund.reason)}
                    className="mt-1 line-clamp-2 text-sm font-medium text-slate-700"
                  >
                    {refundReasonText(refund.reason)}
                  </p>
                ) : (
                  <p className="mt-1 text-sm italic text-slate-400">
                    No reason recorded
                  </p>
                )}

              </div>

              {/* Amount */}
              <div className="min-w-[130px] lg:text-right">

                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Amount
                </p>

                <p className="mt-1 text-sm font-bold text-red-600">
                  -{formatCurrency(refund.total)}
                </p>

              </div>

              {/* View details */}
              <div className="lg:ml-2">

                <button
                  type="button"
                  onClick={() => setSelectedRefund(refund)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm transition-all hover:border-brand-200 hover:bg-brand-50 hover:text-brand-600"
                >
                  <Eye className="h-4 w-4" />
                  View details
                </button>

              </div>

            </div>
          );
        })}

      </div>

      {/* Show all */}
      {refunds.length > 5 && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-center">

          <button
            type="button"
            onClick={() =>
              setShowAllRefunds((current) => !current)
            }
            className="text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            {showAllRefunds
              ? 'Show fewer refunds'
              : `View all ${refunds.length} refunds`}
          </button>

        </div>
      )}
    </>
  )}

</section>

{/* =====================================================
    REFUND DETAIL MODAL
    ===================================================== */}

{selectedRefund && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
    onClick={() => setSelectedRefund(null)}
  >

    <div
      className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
      onClick={(event) => event.stopPropagation()}
    >

      {/* Modal header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-red-100 bg-gradient-to-r from-red-50 via-white to-white px-5 py-4">

        <div className="flex items-center gap-3">

          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <RotateCcw className="h-5 w-5" />
          </div>

          <div>

            <div className="flex items-center gap-2">

              <h2 className="font-mono text-base font-bold text-slate-900">
                {selectedRefund.invoice}
              </h2>

              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">
                Refunded
              </span>

            </div>

            <p className="mt-0.5 text-xs text-slate-500">
              Refund transaction details
            </p>

          </div>

        </div>

        <button
          type="button"
          onClick={() => setSelectedRefund(null)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>

      </div>

      <div className="space-y-5 p-5">

        {/* Refund amount */}
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50/50 p-4">

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-400">
              Refund Amount
            </p>

            <p className="mt-1 text-sm text-slate-500">
              Financial impact of this transaction
            </p>
          </div>

          <p className="text-2xl font-bold text-red-600">
            -{formatCurrency(selectedRefund.total)}
          </p>

        </div>

        {/* Metadata */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">

          <RefundInfo
            icon={<RotateCcw className="h-4 w-4" />}
            label="Refunded At"
            value={formatDateTime(selectedRefund.date)}
            tone="danger"
          />

          <RefundInfo
            icon={<ReceiptText className="h-4 w-4" />}
            label="Original Sale"
            value={
              selectedRefund.originalSaleDate
                ? formatDateTime(selectedRefund.originalSaleDate)
                : '—'
            }
          />

          <RefundInfo
            icon={<Package className="h-4 w-4" />}
            label="Cashier"
            value={selectedRefund.cashierName}
          />

          <RefundInfo
            icon={<CreditCard className="h-4 w-4" />}
            label="Payment Method"
            value={paymentLabel(selectedRefund.paymentMethod)}
          />

        </div>

        {/* Refund reason */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">

          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <FileText className="h-4 w-4" />
            Refund Reason
          </div>

          {refundReasonText(selectedRefund.reason) ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 font-medium text-slate-800">
              {refundReasonText(selectedRefund.reason)}
            </p>
          ) : (
            <p className="mt-2 text-sm italic text-slate-400">
              No reason recorded
            </p>
          )}

        </div>

        {/* Returned items */}
        {selectedRefund.items &&
          selectedRefund.items.length > 0 && (

          <div className="overflow-hidden rounded-xl border border-slate-200">

            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">

              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-slate-500" />

                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Returned Items
                </p>
              </div>

              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                {selectedRefund.items.reduce(
                  (sum, item) => sum + item.quantity,
                  0
                )}{' '}
                units
              </span>

            </div>

            <div className="divide-y divide-slate-100">

              {selectedRefund.items.map((item, index) => (

                <div
                  key={`${selectedRefund.id}-${index}`}
                  className="flex items-center justify-between gap-4 px-4 py-3.5"
                >

                  <div className="flex min-w-0 items-center gap-3">

                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <Package className="h-4 w-4" />
                    </div>

                    <div className="min-w-0">

                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.productName}
                      </p>

                      {item.variantName && (
                        <p className="mt-0.5 text-xs text-slate-400">
                          Variant: {item.variantName}
                        </p>
                      )}

                    </div>

                  </div>

                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-700">
                    ×{item.quantity}
                  </span>

                </div>
              ))}

            </div>

          </div>
        )}

      </div>

    </div>

  </div>
)}

      {/* =====================================================
          INVENTORY RISK
          ===================================================== */}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-200 px-5 py-4">

          <h2 className="text-base font-bold text-slate-900">
            Inventory Risk
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Products and variants currently at or below reorder levels.
          </p>

        </div>

        {lowStock.length ===
        0 ? (
          <EmptyMessage
            text="Inventory is healthy."
          />
        ) : (
          <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">

            {lowStock
              .slice(
                0,
                6
              )
              .map(
                (
                  item
                ) => (
                  <div
                    key={`${item.productId}-${item.variantId ?? 'product'}`}
                    className="flex items-center gap-3 p-4"
                  >

                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                        item.status ===
                        'out_of_stock'
                          ? 'bg-danger-50 text-danger-600'
                          : 'bg-warning-50 text-warning-600'
                      }`}
                    >
                      <Package className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1">

                      <p className="truncate text-sm font-semibold text-slate-900">
                        {
                          item.name
                        }
                      </p>

                      <p className="mt-0.5 truncate font-mono text-xs text-slate-400">
                        {
                          item.sku
                        }
                      </p>

                    </div>

                    <div className="text-right">

                      <p className="text-lg font-bold text-slate-900">
                        {
                          item.stock
                        }
                      </p>

                      <p className="text-[11px] text-slate-400">
                        reorder{' '}
                        {
                          item.reorderLevel
                        }
                      </p>

                    </div>

                  </div>
                )
              )}

          </div>
        )}

      </section>

    </div>
  );
}

function ReportSectionTabs({
  active,
  onChange,
}: {
  active: 'current' | 'historical';
  onChange: (section: 'current' | 'historical') => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" role="tablist" aria-label="Report sections">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'current'}
        onClick={() => onChange('current')}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${active === 'current' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
      >
        <BarChart3 className="h-4 w-4" />
        Current Reports
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'historical'}
        onClick={() => onChange('historical')}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${active === 'historical' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
      >
        <Archive className="h-4 w-4" />
        Historical Sales
      </button>
    </div>
  );
}

/* =========================================================
   REPORT METRIC
   ========================================================= */

function ReportMetric({
  label,
  value,
  icon,
  valueClassName = 'text-slate-900',
}: {
  label: string;
  value: string;
  icon:
    React.ReactNode;
  valueClassName?:
    string;
}) {
  return (
    <div className="min-h-[122px] p-4">

      <div className="flex items-center gap-2 text-slate-400">
        {icon}

        <span className="text-[11px] font-semibold uppercase tracking-wide">
          {label}
        </span>
      </div>

      <p
        className={`mt-4 text-xl font-bold tabular-nums ${valueClassName}`}
      >
        {value}
      </p>

    </div>
  );
}

/* =========================================================
   QUALITY METRIC
   ========================================================= */

function QualityMetric({
  label,
  value,
  valueClassName = 'text-slate-900',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-h-[64px] items-center justify-between gap-4 py-4">

      <span className="text-sm font-medium text-slate-500">
        {label}
      </span>

      <span
        className={`text-base font-bold tabular-nums ${valueClassName}`}
      >
        {value}
      </span>

    </div>
  );
}

/* =========================================================
   EMPTY MESSAGE
   ========================================================= */

function EmptyMessage({
  text,
}: {
  text: string;
}) {
  return (
    <div className="flex min-h-[170px] flex-col items-center justify-center text-center">

      <BarChart3 className="h-7 w-7 text-slate-300" />

      <p className="mt-3 text-sm font-medium text-slate-500">
        {text}
      </p>

    </div>
  );
}
