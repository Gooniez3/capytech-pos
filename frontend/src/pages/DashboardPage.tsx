import {
  useEffect,
  useState,
} from 'react';

import { Link } from 'react-router-dom';

import {
  DollarSign,
  ShoppingBag,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Receipt,
  RotateCcw,
  PackageX,
  Package,
  Activity,
  CreditCard,
  HeartPulse,
  RefreshCw,
} from 'lucide-react';

import { StatCard } from '@/components/ui/StatCard';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { StockStatusBadge } from '@/components/ui/StatusBadge';

import { api } from '@/lib/api';

import {
  formatCurrency,
  formatCompact,
} from '@/lib/currency';

import {
  formatTime,
  relativeTime,
} from '@/lib/format';

/* =========================================================
   API TYPES
   ========================================================= */

interface DashboardStats {
  todayRevenue: number;
  grossProfit: number;
  grossMargin: number;

  transactions: number;
  averageSale: number;
  unitsSold: number;

  lowStockCount: number;
  outOfStockCount: number;

  storeHealth: number;
}

interface RevenuePoint {
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
}

interface RecentActivity {
  id: string;

  invoice: string;

  status:
    | 'completed'
    | 'refunded'
    | 'voided';

  total: number;

  paymentMethod: string;

  cashierName: string;

  units: number;

  date: string;
}

interface AttentionItem {
  productId: string;

  variantId:
    | string
    | null;

  name: string;
  sku: string;

  stock: number;

  reorderLevel: number;

  status:
    | 'low_stock'
    | 'out_of_stock';
}

interface PaymentBreakdown {
  method: string;

  transactions: number;

  amount: number;
}

interface DashboardResponse {
  stats: DashboardStats;

  revenueSeries:
    RevenuePoint[];

  topProducts:
    TopProduct[];

  recentActivity:
    RecentActivity[];

  attention:
    AttentionItem[];

  paymentBreakdown:
    PaymentBreakdown[];
}

/* =========================================================
   PAYMENT LABELS
   ========================================================= */

function paymentLabel(
  method: string
) {
  switch (
    method.toLowerCase()
  ) {
    case 'kbzpay':
      return 'KBZPay';

    case 'wavepay':
      return 'WavePay';

    case 'mmqr':
      return 'MMQR';

    case 'banking':
      return 'Banking';

    case 'cash':
      return 'Cash';

    default:
      return method;
  }
}

/* =========================================================
   DASHBOARD PAGE
   ========================================================= */

export function DashboardPage() {
  const [
    dashboard,
    setDashboard,
  ] = useState<
    DashboardResponse | null
  >(null);

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
     LOAD DASHBOARD
     ========================================================= */

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);

    setError(null);

    try {
      const data =
        await api.get<
          DashboardResponse
        >(
          '/api/dashboard'
        );

      setDashboard(
        data
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Failed to load dashboard.'
      );
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     LOADING
     ========================================================= */

  if (loading) {
    return (
      <div className="space-y-6">

        <PageHeader
          title="Dashboard"
          subtitle="Your store overview and performance."
        />

        <Card>
          <div className="flex min-h-[420px] flex-col items-center justify-center text-slate-400">

            <RefreshCw className="mb-3 h-7 w-7 animate-spin" />

            <p className="text-sm font-medium">
              Loading dashboard...
            </p>

          </div>
        </Card>

      </div>
    );
  }

  /* =========================================================
     ERROR
     ========================================================= */

  if (
    error ||
    !dashboard
  ) {
    return (
      <div className="space-y-6">

        <PageHeader
          title="Dashboard"
          subtitle="Your store overview and performance."
        />

        <Card>
          <div className="flex min-h-[320px] flex-col items-center justify-center">

            <AlertTriangle className="mb-3 h-8 w-8 text-danger-500" />

            <p className="font-semibold text-slate-900">
              Dashboard could not be loaded
            </p>

            <p className="mt-1 text-sm text-slate-500">
              {error ??
                'Unknown error'}
            </p>

            <button
              type="button"
              onClick={
                loadDashboard
              }
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Try Again
            </button>

          </div>
        </Card>

      </div>
    );
  }

  const {
    stats,
    revenueSeries,
    topProducts,
    recentActivity,
    attention,
    paymentBreakdown,
  } = dashboard;

  const paymentTotal =
    paymentBreakdown.reduce(
      (
        sum,
        payment
      ) =>
        sum +
        payment.amount,
      0
    );

  /* =========================================================
     UI
     ========================================================= */

  return (
    <div className="space-y-6">

      {/* =====================================================
          HEADER
          ===================================================== */}

      <PageHeader
        title="Dashboard"
        subtitle="Your store performance, sales, and inventory at a glance."
      />

      {/* =====================================================
          PRIMARY KPIs
          ===================================================== */}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">

        <StatCard
          label="Today's Revenue"
          value={formatCurrency(
            stats.todayRevenue
          )}
          icon={
            <DollarSign className="h-5 w-5" />
          }
          accent="brand"
        />

        <StatCard
          label="Gross Profit"
          value={formatCurrency(
            stats.grossProfit
          )}
          icon={
            <TrendingUp className="h-5 w-5" />
          }
          accent="success"
        />

        <StatCard
          label="Transactions"
          value={String(
            stats.transactions
          )}
          icon={
            <ShoppingBag className="h-5 w-5" />
          }
          accent="neutral"
        />

        <StatCard
          label="Average Sale"
          value={formatCurrency(
            stats.averageSale
          )}
          icon={
            <Receipt className="h-5 w-5" />
          }
          accent="brand"
        />

      </div>

      {/* =====================================================
          SECONDARY METRICS
          ===================================================== */}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">

        {/* Units Sold */}

        <Card>
          <div className="flex items-center justify-between">

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Units Sold Today
              </p>

              <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                {stats.unitsSold}
              </p>
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Package className="h-5 w-5" />
            </div>

          </div>
        </Card>

        {/* Margin */}

        <Card>
          <div className="flex items-center justify-between">

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Gross Margin
              </p>

              <p className="mt-2 text-2xl font-bold text-success-600 tabular-nums">
                {stats.grossMargin.toFixed(
                  1
                )}
                %
              </p>
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success-50 text-success-600">
              <TrendingUp className="h-5 w-5" />
            </div>

          </div>
        </Card>

        {/* Low Stock */}

        <Card>
          <div className="flex items-center justify-between">

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Low Stock
              </p>

              <p className="mt-2 text-2xl font-bold text-warning-600 tabular-nums">
                {stats.lowStockCount}
              </p>
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning-50 text-warning-600">
              <AlertTriangle className="h-5 w-5" />
            </div>

          </div>
        </Card>

        {/* Out of Stock */}

        <Card>
          <div className="flex items-center justify-between">

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Out of Stock
              </p>

              <p className="mt-2 text-2xl font-bold text-danger-600 tabular-nums">
                {stats.outOfStockCount}
              </p>
            </div>

            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
              <PackageX className="h-5 w-5" />
            </div>

          </div>
        </Card>

      </div>

      {/* =====================================================
          SALES PERFORMANCE + STORE HEALTH
          ===================================================== */}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">

        {/* Sales Chart */}

        <Card
          title="Sales Performance"
          subtitle="Revenue vs gross profit • Last 7 days"
          className="xl:col-span-2"
        >
          <RevenueChart
            data={
              revenueSeries
            }
          />
        </Card>

        {/* Store Health */}

        <Card
          title="Store Health"
          subtitle="Overall operational status"
        >
          <div className="space-y-5">

            {/* Score */}

            <div className="flex items-center justify-between">

              <div>
                <p className="text-4xl font-bold text-slate-900 tabular-nums">
                  {
                    stats.storeHealth
                  }
                  <span className="text-lg font-semibold text-slate-400">
                    /100
                  </span>
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  {stats.storeHealth >=
                  85
                    ? 'Store is operating well'
                    : stats.storeHealth >=
                      65
                    ? 'Some areas need attention'
                    : 'Store needs attention'}
                </p>
              </div>

              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success-50 text-success-600">
                <HeartPulse className="h-7 w-7" />
              </div>

            </div>

            {/* Health bar */}

            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">

              <div
                className="h-full rounded-full bg-success-500 transition-all"
                style={{
                  width: `${stats.storeHealth}%`,
                }}
              />

            </div>

            {/* Health metrics */}

            <div className="space-y-3 border-t border-slate-100 pt-4">

              <HealthRow
                label="Sales Activity"
                good={
                  stats.transactions >
                  0
                }
              />

              <HealthRow
                label="Gross Margin"
                good={
                  stats.grossMargin >=
                  10
                }
              />

              <HealthRow
                label="Low Stock"
                good={
                  stats.lowStockCount ===
                  0
                }
              />

              <HealthRow
                label="Stockouts"
                good={
                  stats.outOfStockCount ===
                  0
                }
              />

            </div>

            {(stats.lowStockCount >
              0 ||
              stats.outOfStockCount >
                0) && (
              <Link
                to="/inventory"
                className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50"
              >
                Review inventory

                <ArrowRight className="h-4 w-4" />
              </Link>
            )}

          </div>
        </Card>

      </div>

      {/* =====================================================
          TOP PRODUCTS + NEEDS ATTENTION + PAYMENT
          ===================================================== */}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">

        {/* Top Products */}

        <Card
          title="Top Selling"
          subtitle="Best performers • Last 7 days"
        >
          {topProducts.length ===
          0 ? (
            <EmptyDashboardMessage
              text="No sales data yet."
            />
          ) : (
            <div className="space-y-3">

              {topProducts.map(
                (
                  product,
                  index
                ) => (
                  <div
                    key={`${product.productId}-${product.variantId ?? 'product'}`}
                    className="flex items-center gap-3 rounded-xl px-1 py-2"
                  >

                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-bold text-slate-600">
                      {index +
                        1}
                    </span>

                    <div className="min-w-0 flex-1">

                      <p className="truncate text-sm font-semibold text-slate-900">
                        {
                          product.name
                        }
                      </p>

                      <p className="mt-0.5 truncate font-mono text-xs text-slate-400">
                        {product.sku ||
                          `${product.units} units sold`}
                      </p>

                      {product.sku && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {
                            product.units
                          }{' '}
                          units sold
                        </p>
                      )}

                    </div>

                    <div className="text-right">

                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatCompact(
                          product.revenue
                        )}
                      </p>

                    </div>

                  </div>
                )
              )}

            </div>
          )}
        </Card>

        {/* Inventory Attention */}

        <Card
          title="Needs Attention"
          subtitle="Inventory requiring action"
          action={
            <Link
              to="/inventory"
              className="flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              View all

              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {attention.length ===
          0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center text-center">

              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success-50 text-success-600">
                <Package className="h-5 w-5" />
              </div>

              <p className="mt-3 text-sm font-semibold text-slate-900">
                Inventory looks healthy
              </p>

              <p className="mt-1 text-xs text-slate-500">
                No items currently need attention.
              </p>

            </div>
          ) : (
            <div className="space-y-3">

              {attention.map(
                (
                  item
                ) => (
                  <div
                    key={`${item.productId}-${item.variantId ?? 'product'}`}
                    className="flex items-center gap-3"
                  >

                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        item.status ===
                        'out_of_stock'
                          ? 'bg-danger-50 text-danger-600'
                          : 'bg-warning-50 text-warning-600'
                      }`}
                    >
                      {item.status ===
                      'out_of_stock' ? (
                        <PackageX className="h-5 w-5" />
                      ) : (
                        <AlertTriangle className="h-5 w-5" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">

                      <p className="truncate text-sm font-semibold text-slate-900">
                        {
                          item.name
                        }
                      </p>

                      <p className="truncate font-mono text-xs text-slate-400">
                        {
                          item.sku
                        }
                      </p>

                    </div>

                    <div className="text-right">

                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {
                          item.stock
                        }
                      </p>

                      <StockStatusBadge
                        status={
                          item.status
                        }
                      />

                    </div>

                  </div>
                )
              )}

            </div>
          )}
        </Card>

        {/* Payment Methods */}

        <Card
          title="Payment Methods"
          subtitle="Today's payment mix"
        >
          {paymentBreakdown.length ===
          0 ? (
            <EmptyDashboardMessage
              text="No payments today."
            />
          ) : (
            <div className="space-y-4">

              {paymentBreakdown.map(
                (
                  payment
                ) => {
                  const percentage =
                    paymentTotal >
                    0
                      ? (payment.amount /
                          paymentTotal) *
                        100
                      : 0;

                  return (
                    <div
                      key={
                        payment.method
                      }
                      className="space-y-2"
                    >

                      <div className="flex items-center justify-between">

                        <div className="flex items-center gap-2">

                          <CreditCard className="h-4 w-4 text-slate-400" />

                          <span className="text-sm font-semibold text-slate-700">
                            {paymentLabel(
                              payment.method
                            )}
                          </span>

                        </div>

                        <div className="text-right">

                          <p className="text-sm font-bold text-slate-900 tabular-nums">
                            {formatCurrency(
                              payment.amount
                            )}
                          </p>

                          <p className="text-[11px] text-slate-400">
                            {
                              payment.transactions
                            }{' '}
                            transaction
                            {payment.transactions ===
                            1
                              ? ''
                              : 's'}
                          </p>

                        </div>

                      </div>

                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">

                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{
                            width: `${percentage}%`,
                          }}
                        />

                      </div>

                      <p className="text-right text-[11px] font-medium text-slate-400">
                        {percentage.toFixed(
                          1
                        )}
                        %
                      </p>

                    </div>
                  );
                }
              )}

            </div>
          )}
        </Card>

      </div>

      {/* =====================================================
          RECENT ACTIVITY
          ===================================================== */}

      <Card
        title="Recent Activity"
        subtitle="Latest sales and refunds"
        noPadding
        action={
          <Link
            to="/sales"
            className="flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            View Sales

            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {recentActivity.length ===
        0 ? (
          <div className="py-14 text-center text-sm text-slate-400">
            No activity yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">

            {recentActivity.map(
              (
                activity
              ) => {
                const refunded =
                  activity.status ===
                  'refunded';

                const voided =
                  activity.status ===
                  'voided';

                return (
                  <div
                    key={
                      activity.id
                    }
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50/50"
                  >

                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        refunded ||
                        voided
                          ? 'bg-danger-50 text-danger-600'
                          : 'bg-brand-50 text-brand-600'
                      }`}
                    >
                      {refunded ? (
                        <RotateCcw className="h-5 w-5" />
                      ) : voided ? (
                        <AlertTriangle className="h-5 w-5" />
                      ) : (
                        <Receipt className="h-5 w-5" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">

                      <div className="flex items-center gap-2">

                        <p className="font-mono text-sm font-semibold text-slate-900">
                          {
                            activity.invoice
                          }
                        </p>

                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            refunded
                              ? 'bg-danger-50 text-danger-600'
                              : voided
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-success-50 text-success-600'
                          }`}
                        >
                          {
                            activity.status
                          }
                        </span>

                      </div>

                      <p className="mt-1 text-xs text-slate-500">
                        {
                          activity.cashierName
                        }{' '}
                        •{' '}
                        {
                          activity.units
                        }{' '}
                        unit
                        {activity.units ===
                        1
                          ? ''
                          : 's'}{' '}
                        •{' '}
                        {paymentLabel(
                          activity.paymentMethod
                        )}{' '}
                        •{' '}
                        {formatTime(
                          activity.date
                        )}
                      </p>

                    </div>

                    <div className="text-right">

                      <p
                        className={`text-sm font-bold tabular-nums ${
                          refunded
                            ? 'text-danger-600'
                            : 'text-slate-900'
                        }`}
                      >
                        {refunded
                          ? '-'
                          : ''}
                        {formatCurrency(
                          activity.total
                        )}
                      </p>

                      <p className="mt-0.5 text-xs text-slate-400">
                        {relativeTime(
                          activity.date
                        )}
                      </p>

                    </div>

                  </div>
                );
              }
            )}

          </div>
        )}
      </Card>

    </div>
  );
}

/* =========================================================
   STORE HEALTH ROW
   ========================================================= */

function HealthRow({
  label,
  good,
}: {
  label: string;
  good: boolean;
}) {
  return (
    <div className="flex items-center justify-between">

      <span className="text-sm text-slate-600">
        {label}
      </span>

      <span
        className={`flex items-center gap-1.5 text-xs font-semibold ${
          good
            ? 'text-success-600'
            : 'text-warning-600'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            good
              ? 'bg-success-500'
              : 'bg-warning-500'
          }`}
        />

        {good
          ? 'Healthy'
          : 'Attention'}
      </span>

    </div>
  );
}

/* =========================================================
   EMPTY DASHBOARD MESSAGE
   ========================================================= */

function EmptyDashboardMessage({
  text,
}: {
  text: string;
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center text-center">

      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Activity className="h-5 w-5" />
      </div>

      <p className="mt-3 text-sm font-medium text-slate-500">
        {text}
      </p>

    </div>
  );
}