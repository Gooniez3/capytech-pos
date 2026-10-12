import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Receipt,
  Search,
  Eye,
  Printer,
  RotateCcw,
  X,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { SaleStatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

import { useToast } from '@/context/ToastContext';

import { api } from '@/lib/api';

import type {
  Sale,
} from '@/types';

import {
  formatCurrency,
} from '@/lib/currency';

import {
  formatDateTime,
  formatDate,
} from '@/lib/format';
import { warrantySnapshotLabel } from '@/lib/serializedInventory';

/* =========================================================
   API TYPES
   ========================================================= */

interface ApiSaleItem {
  id:
    number | string;

  sale_id:
    number | string;

  product_id:
    number | string | null;

  variant_id:
    number | string | null;

  product_name:
    string;

  variant_name:
    string | null;

  variant_sku:
    string | null;

  quantity:
    number | string;

  unit_price:
    number | string;

  line_total:
    number | string;

  shop_warranty_eligible: boolean | null;
  shop_warranty_months: number | string | null;
  shop_warranty_start_date: string | null;
  shop_warranty_end_date: string | null;
  product_sku_snapshot: string | null;
  variant_sku_snapshot: string | null;
  stock_units: Array<{
    stock_unit_id: number | string;
    internal_sku_snapshot: string;
    manufacturer_serial_number_snapshot: string;
    current_state: string;
  }>;
}

interface ApiSale {
  id:
    number | string;

  invoice_number:
    string;

  user_id:
    number | string;

  cashier_name:
    string | null;

  subtotal:
    number | string;

  discount:
    number | string;

  tax?:
    number | string;

  total:
    number | string;

  payment_method:
    Sale['paymentMethod'];

  status:
    Sale['status'];

  created_at:
    string;

  refund_reason:
  string | null;

refunded_at:
  string | null;

refunded_by:
  number | string | null;

refunded_by_name:
  string | null;  

  items:
    ApiSaleItem[];
}

/* =========================================================
   SALES HISTORY PAGE
   ========================================================= */

export function SalesHistoryPage() {
  const {
    toast,
  } = useToast();

  const [
    sales,
    setSales,
  ] =
    useState<Sale[]>([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    search,
    setSearch,
  ] =
    useState('');

  const [
    cashierFilter,
    setCashierFilter,
  ] =
    useState('all');

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState('all');

  const [
    dateFilter,
    setDateFilter,
  ] =
    useState('all');

  const [
    viewSale,
    setViewSale,
  ] =
    useState<Sale | null>(
      null
    );

  const [
    refundSale,
    setRefundSale,
  ] =
    useState<Sale | null>(
      null
    );

  const [
    refunding,
    setRefunding,
  ] =
    useState(false);
const [
  refundReason,
  setRefundReason,
] =
  useState('');    

  /* =========================================================
     LOAD SALES
     ========================================================= */

  useEffect(() => {
    loadSales();
  }, []);

  async function loadSales() {
    setLoading(true);

    try {
      const data =
        await api.get<
          ApiSale[]
        >(
          '/api/sales'
        );

      const mappedSales:
        Sale[] =
        data.map(
          (sale) => ({
            id:
              String(
                sale.id
              ),

            invoice:
              sale.invoice_number,

            date:
              sale.created_at,

            cashierId:
              String(
                sale.user_id
              ),

            cashierName:
              sale.cashier_name ??
              'Unknown',

            items:
              sale.items.map(
                (item) => ({
                  productId:
                    item.product_id !==
                    null
                      ? String(
                          item.product_id
                        )
                      : '',

                  name:
                    item.variant_name
                      ? `${item.product_name} — ${item.variant_name}`
                      : item.product_name,

                  sku:
                    item.variant_sku ??
                    '',

                  price:
                    Number(
                      item.unit_price
                    ),

                  quantity:
                    Number(
                      item.quantity
                    ),

                  subtotal:
                    Number(
                      item.line_total
                      ),
                  shopWarrantyEligible: item.shop_warranty_eligible,
                  shopWarrantyMonths: item.shop_warranty_months == null ? null : Number(item.shop_warranty_months),
                  shopWarrantyStartDate: item.shop_warranty_start_date,
                  shopWarrantyEndDate: item.shop_warranty_end_date,
                  productSku: item.product_sku_snapshot,
                  variantSku: item.variant_sku_snapshot,
                  stockUnits: item.stock_units || [],
                })
              ),

            subtotal:
              Number(
                sale.subtotal
              ),

            discount:
              Number(
                sale.discount
              ),

            tax:
              Number(
                sale.tax ?? 0
              ),

            total:
              Number(
                sale.total
              ),

            status:
              sale.status,

            paymentMethod:
  sale.payment_method,

refundReason:
  sale.refund_reason ?? null,

refundedAt:
  sale.refunded_at ?? null,

refundedBy:
  sale.refunded_by_name ?? null,
          })
        );

      setSales(
        mappedSales
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to load sales.',
        'error'
      );
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     REFUND
     ========================================================= */

  async function handleRefund() {
  if (
    !refundSale ||
    refunding
  ) {
    return;
  }

  const reason =
    refundReason.trim();

  if (!reason) {
    toast(
      'Please enter a refund reason.',
      'warning'
    );

    return;
  }

  try {
    setRefunding(true);

    await api.post(
      `/api/sales/${refundSale.id}/refund`,
      {
        reason,
      }
    );

    toast(
      `${refundSale.invoice} refunded successfully.`,
      'success'
    );

    setRefundSale(null);
    setRefundReason('');

    await loadSales();

  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Refund failed.',
      'error'
    );
  } finally {
    setRefunding(false);
  }
}
  /* =========================================================
     INVOICE ACTIONS
     ========================================================= */

  function viewInvoice(
    saleId:
      string | number
  ) {
    const invoiceWindow =
      window.open(
        `/invoice/${saleId}`,
        '_blank',
        'noopener,noreferrer'
      );

    if (!invoiceWindow) {
      toast(
        'Please allow pop-ups to view the invoice.',
        'warning'
      );
    }
  }

  function printInvoice(
    saleId:
      string | number
  ) {
    const invoiceWindow =
      window.open(
        `/invoice/${saleId}?print=1`,
        '_blank',
        'noopener,noreferrer'
      );

    if (!invoiceWindow) {
      toast(
        'Please allow pop-ups to print the invoice.',
        'warning'
      );
    }
  }

  /* =========================================================
     FILTER SALES
     ========================================================= */

  const filtered =
    useMemo(() => {
      return sales
        .filter(
          (sale) => {
            const matchSearch =
              !search ||
              sale.invoice
                .toLowerCase()
                .includes(
                  search.toLowerCase()
                );

            const matchCashier =
              cashierFilter ===
                'all' ||
              sale.cashierId ===
                cashierFilter;

            const matchStatus =
              statusFilter ===
                'all' ||
              sale.status ===
                statusFilter;

            let matchDate =
              true;

            if (
              dateFilter !==
              'all'
            ) {
              const saleDate =
                new Date(
                  sale.date
                );

              const now =
                new Date();

              const diffDays =
                (
                  now.getTime() -
                  saleDate.getTime()
                ) /
                (
                  1000 *
                  60 *
                  60 *
                  24
                );

              if (
                dateFilter ===
                'today'
              ) {
                matchDate =
                  diffDays < 1;
              } else if (
                dateFilter ===
                'week'
              ) {
                matchDate =
                  diffDays < 7;
              } else if (
                dateFilter ===
                'month'
              ) {
                matchDate =
                  diffDays < 30;
              }
            }

            return (
              matchSearch &&
              matchCashier &&
              matchStatus &&
              matchDate
            );
          }
        )
        .sort(
          (a, b) =>
            new Date(
              b.date
            ).getTime() -
            new Date(
              a.date
            ).getTime()
        );
    }, [
      sales,
      search,
      cashierFilter,
      statusFilter,
      dateFilter,
    ]);

  /* =========================================================
     REVENUE
     ========================================================= */

  const totalRevenue =
    filtered
      .filter(
        (sale) =>
          sale.status ===
          'completed'
      )
      .reduce(
        (
          sum,
          sale
        ) =>
          sum +
          sale.total,
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
        title="Sales History"
        subtitle={`${filtered.length} transactions • ${formatCurrency(
          totalRevenue
        )} total`}
      />

      {/* =====================================================
          FILTERS
          ===================================================== */}

      <div className="flex flex-wrap items-center gap-3">

        {/* Search */}

        <div className="relative min-w-[200px] flex-1">

          <Search
            className="
              absolute
              left-3
              top-1/2
              h-4 w-4
              -translate-y-1/2
              text-slate-400
            "
          />

          <input
            value={
              search
            }
            onChange={(
              event
            ) =>
              setSearch(
                event.target
                  .value
              )
            }
            placeholder="Search by invoice number..."
            className="
              h-10
              w-full
              rounded-lg
              border
              border-slate-300
              bg-white
              pl-10
              pr-3
              text-sm
              text-slate-900
              placeholder:text-slate-400
              transition-colors
              focus:border-brand-500
              focus:outline-none
              focus:ring-2
              focus:ring-brand-500/30
            "
          />

        </div>

        {/* Date Filter */}

        <select
          value={
            dateFilter
          }
          onChange={(
            event
          ) =>
            setDateFilter(
              event.target
                .value
            )
          }
          className="
            h-10
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            pr-8
            text-sm
            text-slate-700
            focus:border-brand-500
            focus:outline-none
            focus:ring-2
            focus:ring-brand-500/30
          "
        >
          <option value="all">
            All Dates
          </option>

          <option value="today">
            Today
          </option>

          <option value="week">
            This Week
          </option>

          <option value="month">
            This Month
          </option>
        </select>

        {/* Cashier Filter */}

        <select
          value={
            cashierFilter
          }
          onChange={(
            event
          ) =>
            setCashierFilter(
              event.target
                .value
            )
          }
          className="
            h-10
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            pr-8
            text-sm
            text-slate-700
            focus:border-brand-500
            focus:outline-none
            focus:ring-2
            focus:ring-brand-500/30
          "
        >
          <option value="all">
            All Cashiers
          </option>

          {Array.from(
            new Map(
              sales.map(
                (sale) => [
                  sale.cashierId,
                  sale.cashierName,
                ]
              )
            )
          ).map(
            ([
              id,
              name,
            ]) => (
              <option
                key={
                  id
                }
                value={
                  id
                }
              >
                {name}
              </option>
            )
          )}
        </select>

        {/* Status Filter */}

        <select
          value={
            statusFilter
          }
          onChange={(
            event
          ) =>
            setStatusFilter(
              event.target
                .value
            )
          }
          className="
            h-10
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            pr-8
            text-sm
            text-slate-700
            focus:border-brand-500
            focus:outline-none
            focus:ring-2
            focus:ring-brand-500/30
          "
        >
          <option value="all">
            All Status
          </option>

          <option value="completed">
            Completed
          </option>

          <option value="refunded">
            Refunded
          </option>

          <option value="voided">
            Voided
          </option>
        </select>

      </div>

      {/* =====================================================
          SALES TABLE
          ===================================================== */}

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16 text-slate-400">
            <p className="text-sm font-medium">
              Loading sales...
            </p>
          </div>
        </Card>
      ) : filtered.length ===
        0 ? (
        <Card>
          <EmptyState
            icon={
              <Receipt className="h-8 w-8" />
            }
            title="No sales found"
            description="Try adjusting your filters."
          />
        </Card>
      ) : (
        <DataTable
          data={
            filtered
          }
          rowKey={(
            sale
          ) =>
            sale.id
          }
          minWidth="900px"
          onRowClick={(
            sale
          ) =>
            setViewSale(
              sale
            )
          }
          columns={[
            {
              key:
                'invoice',

              header:
                'Invoice',

              render:
                (
                  sale
                ) => (
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {
                      sale.invoice
                    }
                  </span>
                ),
            },

            {
              key:
                'date',

              header:
                'Date',

              render:
                (
                  sale
                ) => (
                  <div>

                    <p className="text-sm text-slate-700">
                      {formatDate(
                        sale.date
                      )}
                    </p>

                    <p className="text-xs text-slate-400">
                      {new Date(
                        sale.date
                      ).toLocaleTimeString(
                        'en-GB',
                        {
                          hour:
                            '2-digit',

                          minute:
                            '2-digit',
                        }
                      )}
                    </p>

                  </div>
                ),
            },

            {
              key:
                'cashier',

              header:
                'Cashier',

              render:
                (
                  sale
                ) => (
                  <span className="text-sm text-slate-600">
                    {
                      sale.cashierName
                    }
                  </span>
                ),
            },

            {
              key:
                'items',

              header:
                'Items',

              align:
                'center',

              render:
                (
                  sale
                ) => (
                  <span className="text-sm tabular-nums text-slate-600">
                    {
                      sale.items
                        .length
                    }
                  </span>
                ),
            },

            {
              key:
                'total',

              header:
                'Total',

              align:
                'right',

              render:
                (
                  sale
                ) => (
                  <span className="font-bold tabular-nums text-slate-900">
                    {formatCurrency(
                      sale.total
                    )}
                  </span>
                ),
            },

            {
              key:
                'status',

              header:
                'Status',

              render:
                (
                  sale
                ) => (
                  <SaleStatusBadge
                    status={
                      sale.status
                    }
                  />
                ),
            },

            /* =================================================
               ACTIONS
               ================================================= */

            {
              key:
                'actions',

              header:
                'Actions',

              align:
                'right',

              render:
                (
                  sale
                ) => (
                  <div className="flex items-center justify-end gap-1">

                    {/* View A4 Invoice */}

                    <button
                      type="button"
                      onClick={(
                        event
                      ) => {
                        event.stopPropagation();

                        viewInvoice(
                          sale.id
                        );
                      }}
                      className="
                        inline-flex
                        h-8 w-8
                        items-center
                        justify-center
                        rounded-lg
                        text-slate-400
                        transition-colors
                        hover:bg-slate-100
                        hover:text-brand-600
                      "
                      title="View Invoice"
                    >
                      <Eye className="h-4 w-4" />
                    </button>

                    {/* Print A4 Invoice */}

                    <button
                      type="button"
                      onClick={(
                        event
                      ) => {
                        event.stopPropagation();

                        printInvoice(
                          sale.id
                        );
                      }}
                      className="
                        inline-flex
                        h-8 w-8
                        items-center
                        justify-center
                        rounded-lg
                        text-slate-400
                        transition-colors
                        hover:bg-slate-100
                        hover:text-slate-700
                      "
                      title="Print Invoice"
                    >
                      <Printer className="h-4 w-4" />
                    </button>

                  </div>
                ),
            },
          ]}
        />
      )}

      {/* =====================================================
          SALE DETAIL MODAL
          ===================================================== */}

      <Modal
        open={
          !!viewSale
        }
        onClose={() =>
          setViewSale(
            null
          )
        }
        title={
          viewSale?.invoice
        }
        description={
          viewSale
            ? formatDateTime(
                viewSale.date
              )
            : ''
        }
        size="md"
        footer={
          <>

            {/* Print */}

            <Button
              variant="outline"
              leftIcon={
                <Printer className="h-4 w-4" />
              }
              onClick={() => {
                if (
                  viewSale
                ) {
                  printInvoice(
                    viewSale.id
                  );
                }
              }}
            >
              Print Invoice
            </Button>

            {/* Refund */}

            {viewSale?.status ===
              'completed' && (
              <Button
                variant="danger"
                leftIcon={
                  <RotateCcw className="h-4 w-4" />
                }
                onClick={() => {
  setRefundReason('');

  setRefundSale(
    viewSale
  );

  setViewSale(
    null
  );
}}
              >
                Refund
              </Button>
            )}

            {/* Close */}

            <Button
              variant="ghost"
              onClick={() =>
                setViewSale(
                  null
                )
              }
            >
              <X className="h-4 w-4" />
            </Button>

          </>
        }
      >

        {viewSale && (
          <div className="space-y-4">

            {/* Sale Information */}

            <div className="grid grid-cols-2 gap-4 text-sm">

              <div>

                <p className="text-xs font-semibold uppercase text-slate-400">
                  Cashier
                </p>

                <p className="mt-0.5 font-semibold text-slate-900">
                  {
                    viewSale.cashierName
                  }
                </p>

              </div>

              <div>

                <p className="text-xs font-semibold uppercase text-slate-400">
                  Payment
                </p>

                <p className="mt-0.5 font-semibold capitalize text-slate-900">
                  {
                    viewSale.paymentMethod
                  }
                </p>

              </div>

              <div>

                <p className="text-xs font-semibold uppercase text-slate-400">
                  Status
                </p>

                <div className="mt-0.5">

                  <SaleStatusBadge
                    status={
                      viewSale.status
                    }
                  />

                </div>

              </div>

              <div>

                <p className="text-xs font-semibold uppercase text-slate-400">
                  Items
                </p>

                <p className="mt-0.5 font-semibold text-slate-900">
                  {
                    viewSale.items
                      .length
                  }{' '}
                  items
                </p>

              </div>

            </div>

            {/* Items */}

            <div className="overflow-hidden rounded-xl border border-slate-200">

              <table className="w-full">

                <thead>

                  <tr className="border-b border-slate-200 bg-slate-50">

                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                      Product
                    </th>

                    <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase text-slate-500">
                      Qty
                    </th>

                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                      Subtotal
                    </th>

                  </tr>

                </thead>

                <tbody className="divide-y divide-slate-100">

                  {viewSale.items.map(
                    (
                      item,
                      index
                    ) => (
                      <tr
                        key={`${item.productId}-${item.sku}-${index}`}
                      >

                        <td className="px-4 py-3">

                          <p className="text-sm font-medium text-slate-900">
                            {
                              item.name
                            }
                          </p>

                          <p className="font-mono text-xs text-slate-400">
                            {
                              item.sku ||
                              '—'
                            }
                          </p>

                          <p className="mt-1 text-xs text-slate-600">
                            {warrantySnapshotLabel(item)}
                          </p>

                          {item.stockUnits?.map((unit) => (
                            <p key={String(unit.stock_unit_id)} className="mt-1 break-all font-mono text-[11px] text-slate-600">
                              SN: {unit.manufacturer_serial_number_snapshot} · {unit.internal_sku_snapshot}
                            </p>
                          ))}

                        </td>

                        <td className="px-4 py-3 text-center text-sm tabular-nums text-slate-600">
                          {
                            item.quantity
                          }
                        </td>

                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
                          {formatCurrency(
                            item.subtotal
                          )}
                        </td>

                      </tr>
                    )
                  )}

                </tbody>

              </table>

            </div>

            {/* Totals */}

            <div className="space-y-1.5 rounded-xl bg-slate-50 p-4">

              <div className="flex justify-between text-sm">

                <span className="text-slate-500">
                  Subtotal
                </span>

                <span className="font-semibold tabular-nums text-slate-900">
                  {formatCurrency(
                    viewSale.subtotal
                  )}
                </span>

              </div>

              <div className="flex justify-between text-sm">

                <span className="text-slate-500">
                  Discount
                </span>

                <span
                  className={
                    viewSale.discount >
                    0
                      ? 'font-semibold tabular-nums text-danger-600'
                      : 'font-semibold tabular-nums text-slate-900'
                  }
                >
                  {viewSale.discount >
                  0
                    ? `-${formatCurrency(
                        viewSale.discount
                      )}`
                    : formatCurrency(
                        0
                      )}
                </span>

              </div>

              {(viewSale.tax ?? 0) > 0 && (
                <div className="flex justify-between text-sm">

                  <span className="text-slate-500">
                    Tax
                  </span>

                  <span className="font-semibold tabular-nums text-slate-900">
                    {formatCurrency(
                      viewSale.tax ?? 0
                    )}
                  </span>

                </div>
              )}

              <div className="flex justify-between border-t border-slate-200 pt-2">

                <span className="font-bold text-slate-900">
                  Total
                </span>

                <span className="text-lg font-bold tabular-nums text-brand-600">
                  {formatCurrency(
                    viewSale.total
                  )}
                </span>

              </div>

            </div>
            {/* =====================================================
    REFUND INFORMATION
    ===================================================== */}

{viewSale.status === 'refunded' && (
  <div className="overflow-hidden rounded-xl border border-danger-200">

    <div className="border-b border-danger-200 bg-danger-50 px-4 py-3">
      <div className="flex items-center gap-2">

        <RotateCcw className="h-4 w-4 text-danger-600" />

        <p className="text-sm font-bold text-danger-700">
          Refund Information
        </p>

      </div>
    </div>

    <div className="space-y-4 bg-white p-4">

      <div className="grid grid-cols-2 gap-4">

        {/* Refunded By */}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Refunded By
          </p>

          <p className="mt-1 text-sm font-semibold text-slate-900">
            {viewSale.refundedBy || '—'}
          </p>
        </div>

        {/* Refunded At */}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Refunded At
          </p>

          <p className="mt-1 text-sm font-semibold text-slate-900">
            {viewSale.refundedAt
              ? formatDateTime(
                  viewSale.refundedAt
                )
              : '—'}
          </p>
        </div>

      </div>

      {/* Refund Reason */}

      <div className="border-t border-slate-200 pt-4">

        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Refund Reason
        </p>

        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-900">
          {viewSale.refundReason || '—'}
        </p>

      </div>

    </div>

  </div>
)}
          </div>
        )}

      </Modal>

     {/* =====================================================
    REFUND CONFIRMATION MODAL
    ===================================================== */}

<Modal
  open={!!refundSale}
  onClose={() => {
    if (refunding) {
      return;
    }

    setRefundSale(null);
    setRefundReason('');
  }}
  title="Confirm Refund"
  description={
    refundSale
      ? `Refund ${refundSale.invoice}`
      : ''
  }
  size="sm"
  footer={
    <>
      <Button
        variant="outline"
        disabled={refunding}
        onClick={() => {
          setRefundSale(null);
          setRefundReason('');
        }}
      >
        Cancel
      </Button>

      <Button
        variant="danger"
        disabled={
          refunding ||
          !refundReason.trim()
        }
        leftIcon={
          <RotateCcw className="h-4 w-4" />
        }
        onClick={handleRefund}
      >
        {refunding
          ? 'Refunding...'
          : 'Confirm Refund'}
      </Button>
    </>
  }
>
  {refundSale && (
    <div className="space-y-4">

      {/* Warning */}

      <div className="rounded-xl border border-danger-200 bg-danger-50 p-4">
        <p className="font-semibold text-slate-900">
          Refund this sale?
        </p>

        <p className="mt-1 text-sm leading-5 text-slate-600">
          This will mark the transaction as refunded
          and restore all sold items to inventory.
        </p>
      </div>

      {/* Refund Details */}

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">

        <div className="flex justify-between text-sm">
          <span className="text-slate-500">
            Invoice
          </span>

          <span className="font-semibold text-slate-900">
            {refundSale.invoice}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-slate-500">
            Items
          </span>

          <span className="font-semibold text-slate-900">
            {refundSale.items.reduce(
              (sum, item) =>
                sum + item.quantity,
              0
            )}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-slate-500">
            Payment
          </span>

          <span className="font-semibold capitalize text-slate-900">
            {refundSale.paymentMethod}
          </span>
        </div>

        <div className="flex justify-between border-t border-slate-200 pt-2">
          <span className="font-bold text-slate-900">
            Refund Amount
          </span>

          <span className="text-lg font-bold text-danger-600">
            {formatCurrency(
              refundSale.total
            )}
          </span>
        </div>

      </div>

      {/* Refund Reason */}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label
            htmlFor="refund-reason"
            className="text-sm font-semibold text-slate-800"
          >
            Refund Reason
          </label>

          <span className="text-xs font-medium text-danger-600">
            Required
          </span>
        </div>

        <textarea
          id="refund-reason"
          value={refundReason}
          onChange={(event) =>
            setRefundReason(
              event.target.value
            )
          }
          placeholder="Example: Customer returned defective item..."
          rows={3}
          maxLength={500}
          disabled={refunding}
          className="
            w-full
            resize-none
            rounded-xl
            border
            border-slate-300
            bg-white
            px-3
            py-2.5
            text-sm
            text-slate-900
            outline-none
            transition
            placeholder:text-slate-400
            focus:border-danger-400
            focus:ring-2
            focus:ring-danger-100
            disabled:cursor-not-allowed
            disabled:bg-slate-50
          "
        />

        <div className="mt-1 flex justify-between">
          <p className="text-xs text-slate-500">
            This reason will be stored with the refund record.
          </p>

          <span className="text-xs tabular-nums text-slate-400">
            {refundReason.length}/500
          </span>
        </div>
      </div>

      {/* Non-cash Reminder */}

      {refundSale.paymentMethod !==
        'cash' && (
        <div className="rounded-lg bg-amber-50 px-3 py-2.5">
          <p className="text-xs leading-5 text-amber-800">
            The POS will restore the inventory and record
            this refund. Return the customer's money through
            the original payment service separately.
          </p>
        </div>
      )}

    </div>
  )}
</Modal>

    </div>
  );
}
