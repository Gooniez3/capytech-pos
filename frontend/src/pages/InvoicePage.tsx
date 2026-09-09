import {
  useEffect,
  useState,
} from 'react';

import {
  ArrowLeft,
  Printer,
  RefreshCw,
} from 'lucide-react';

import { api } from '@/lib/api';
import {
  formatCurrency,
} from '@/lib/currency';

/* =========================================================
   TYPES
   ========================================================= */

interface InvoiceItem {
  id: string;

  productId:
    string | null;

  variantId:
    string | null;

  productName: string;

  variantName:
    string | null;

  sku: string;

  quantity: number;

  unitPrice: number;

  lineTotal: number;
}

interface InvoiceCustomer {
  name:
    string | null;

  phone:
    string | null;

  email:
    string | null;

  address:
    string | null;
}

interface StoreSettings {
  id: number;
  storeName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: 'ks' | 'usd';
  taxRate: number;
  updatedAt: string;
}

interface InvoiceData {
  id: string;

  invoiceNumber: string;

  createdAt: string;

  status: string;

  cashier: string;

  paymentMethod: string;

  customer:
    InvoiceCustomer;

  subtotal: number;

  discount: number;

  tax: number;

  total: number;

  refundedAt:
  string | null;

refundReason:
  string | null;

refundedBy:
  string | null;

voidedAt:
  string | null;

  items:
    InvoiceItem[];
}

/* =========================================================
   INVOICE PAGE
   ========================================================= */

export function InvoicePage() {
  const saleId =
    window.location.pathname
      .split('/')
      .filter(Boolean)
      .pop();

  const [
    invoice,
    setInvoice,
  ] =
    useState<InvoiceData | null>(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState('');

    const [
  storeSettings,
  setStoreSettings,
] =
  useState<StoreSettings | null>(
    null
  );

  /* =========================================================
     LOAD INVOICE
     ========================================================= */

  useEffect(() => {
    if (!saleId) {
      setError(
        'Invoice ID is missing.'
      );

      setLoading(false);

      return;
    }

    loadInvoice();
  }, [saleId]);

  async function loadInvoice() {
  if (!saleId) {
    return;
  }

  try {
    setLoading(true);
    setError('');

    const [
      invoiceData,
      storeData,
    ] =
      await Promise.all([
        api.get<InvoiceData>(
          `/api/sales/${saleId}/invoice`
        ),

        api.get<StoreSettings>(
          '/api/settings/store'
        ),
      ]);

    setInvoice({
      ...invoiceData,
      tax: Number(invoiceData.tax ?? 0),
    });

    setStoreSettings(
      storeData
    );
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : 'Failed to load invoice.'
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
      <div className="flex min-h-screen items-center justify-center bg-slate-100">

        <div className="flex items-center gap-2 font-medium text-slate-700">

          <RefreshCw className="h-5 w-5 animate-spin" />

          <span>
            Loading invoice...
          </span>

        </div>

      </div>
    );
  }

  /* =========================================================
     ERROR
     ========================================================= */

  if (
    error ||
    !invoice
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">

        <div className="w-full max-w-md rounded-xl border border-slate-300 bg-white p-6 text-center shadow-sm">

          <p className="font-bold text-slate-950">
            Unable to load invoice
          </p>

          <p className="mt-2 text-sm text-slate-700">
            {error}
          </p>

          <button
            type="button"
            onClick={
              loadInvoice
            }
            className="
              mt-5
              rounded-lg
              bg-brand-600
              px-4 py-2
              text-sm
              font-semibold
              text-white
              hover:bg-brand-700
            "
          >
            Try Again
          </button>

        </div>

      </div>
    );
  }

  /* =========================================================
     DISPLAY VALUES
     ========================================================= */

  const date =
    new Date(
      invoice.createdAt
    );

  const hasCustomer =
    Boolean(
      invoice.customer?.name ||
      invoice.customer?.phone ||
      invoice.customer?.email ||
      invoice.customer?.address
    );

  const cashierName =
    invoice.cashier === 'Owner'
      ? 'Admin'
      : invoice.cashier;

  const paymentLabel =
    invoice.paymentMethod
      .replace(/_/g, ' ')
      .replace(
        /\b\w/g,
        (letter) =>
          letter.toUpperCase()
      );

  /* =========================================================
     PAGE
     ========================================================= */

  return (
    <div
      className="
        min-h-screen
        bg-slate-100
        px-4 py-6
        print:bg-white
        print:p-0
      "
    >

      {/* =====================================================
    SCREEN CONTROLS
    ===================================================== */}

<div
  className="
    mx-auto
    mb-4
    flex
    max-w-[210mm]
    items-center
    justify-between
    print:hidden
  "
>
  {/* Back to Sales */}

  <button
    type="button"
    onClick={() => {
      window.close();
    }}
    className="
      flex
      items-center
      gap-2
      rounded-lg
      border
      border-slate-300
      bg-white
      px-4 py-2
      text-sm
      font-semibold
      text-slate-800
      transition-colors
      hover:bg-slate-50
    "
  >
    <ArrowLeft className="h-4 w-4" />

    Back to Sales
  </button>

  {/* Print Invoice */}

  <button
    type="button"
    onClick={() => {
      window.print();
    }}
    className="
      flex
      items-center
      gap-2
      rounded-lg
      bg-brand-600
      px-4 py-2
      text-sm
      font-semibold
      text-white
      transition-colors
      hover:bg-brand-700
    "
  >
    <Printer className="h-4 w-4" />

    Print Invoice
  </button>
</div>
      {/* =====================================================
          A4 PAPER
          ===================================================== */}

      <main
        className="
  invoice-page
  mx-auto
  min-h-[297mm]
  w-full
  max-w-[210mm]
  bg-white
  px-4
  py-5
  text-slate-950
  shadow-lg
  sm:px-6
  md:px-[12mm]
  md:py-[10mm]
  print:min-h-0
  print:max-w-none
  print:px-[12mm]
  print:py-[10mm]
  print:shadow-none
"
      >

        {/* ===================================================
            HEADER
            =================================================== */}

        <header
          className="
  flex
  flex-col
  gap-6
  border-b-2
  border-black
  pb-4
  md:flex-row
  md:items-start
  md:justify-between
  md:gap-8
  print:flex-row
  print:items-start
  print:justify-between
"
        >

          <div className="flex items-start gap-4">

            <img
              src="/logo.png"
              alt={storeSettings?.storeName ?? 'CAPY TECH'}
              className="
                h-16
                w-16
                shrink-0
                object-contain
              "
            />

            <div>

  <h1 className="text-2xl font-black tracking-tight text-black">
    {storeSettings?.storeName ?? 'CAPY TECH'}
  </h1>

  <p className="mt-1 text-sm font-bold text-slate-900">
    Tech Accessories & Computer Shop
  </p>

  <div className="mt-2 space-y-0.5 text-[13px] font-medium leading-5 text-slate-800">

    {storeSettings?.address && (
      <p className="max-w-[90mm] whitespace-pre-line">
        {storeSettings.address}
      </p>
    )}

    {storeSettings?.phone && (
      <p>
        Phone: {storeSettings.phone}
      </p>
    )}

    {storeSettings?.email && (
      <p className="break-all">
        Email: {storeSettings.email}
      </p>
    )}

  </div>

</div>
          </div>

          <div className="text-left md:text-right print:text-right">

            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-800">
              Sales Invoice
            </p>

            <p className="mt-2 text-2xl font-black text-black">
              {invoice.invoiceNumber}
            </p>

            <span
              className={`
                mt-3
                inline-flex
                rounded-full
                border
                px-3 py-1
                text-[11px]
                font-black
                uppercase
                tracking-wide
                ${
                  invoice.status ===
                  'completed'
                    ? `
                      border-emerald-600
                      bg-emerald-50
                      text-emerald-800
                    `
                    : invoice.status ===
                      'refunded'
                    ? `
                      border-red-600
                      bg-red-50
                      text-red-800
                    `
                    : `
                      border-slate-500
                      bg-slate-100
                      text-slate-900
                    `
                }
              `}
            >
              {invoice.status}
            </span>

          </div>

        </header>

        {/* ===================================================
            INVOICE + CUSTOMER
            =================================================== */}

        <section
          className="
  grid
  grid-cols-1
  gap-6
  border-b
  border-slate-400
  py-5
  md:grid-cols-[0.82fr_1.18fr]
  md:gap-12
  print:grid-cols-[0.82fr_1.18fr]
  print:gap-12
"
        >

          {/* Invoice Details */}

          <div>

            <p className="text-xs font-black uppercase tracking-[0.14em] text-black">
              Invoice Details
            </p>

            <dl className="mt-4 space-y-2.5 text-[14px]">

              <div className="flex">
                <dt className="w-28 shrink-0 font-semibold text-slate-800">
                  Invoice No.
                </dt>

                <dd className="font-bold text-black">
                  {invoice.invoiceNumber}
                </dd>
              </div>

              <div className="flex">
                <dt className="w-28 shrink-0 font-semibold text-slate-800">
                  Date
                </dt>

                <dd className="font-bold text-black">
                  {date.toLocaleDateString(
                    'en-GB',
                    {
                      day:
                        '2-digit',

                      month:
                        'short',

                      year:
                        'numeric',
                    }
                  )}
                </dd>
              </div>

              <div className="flex">
                <dt className="w-28 shrink-0 font-semibold text-slate-800">
                  Time
                </dt>

                <dd className="font-bold text-black">
                  {date.toLocaleTimeString(
                    'en-US',
                    {
                      hour:
                        'numeric',

                      minute:
                        '2-digit',
                    }
                  )}
                </dd>
              </div>

              <div className="flex">
                <dt className="w-28 shrink-0 font-semibold text-slate-800">
                  Cashier
                </dt>

                <dd className="font-bold text-black">
                  {cashierName}
                </dd>
              </div>

              <div className="flex">
                <dt className="w-28 shrink-0 font-semibold text-slate-800">
                  Payment
                </dt>

                <dd className="font-bold text-black">
                  {paymentLabel}
                </dd>
              </div>

            </dl>

          </div>

          {/* Customer */}

          <div className="pl-0 md:pl-5 print:pl-5">

            <p className="text-xs font-black uppercase tracking-[0.14em] text-black">
              Customer / Bill To
            </p>

            {hasCustomer ? (
              <dl className="mt-4 space-y-2.5 text-[14px]">

                {invoice.customer.name && (
                  <div className="flex items-start gap-3">

                    <dt className="w-20 shrink-0 font-semibold text-slate-800">
                      Name
                    </dt>

                    <dd className="min-w-0 flex-1 break-words font-bold text-black">
                      {invoice.customer.name}
                    </dd>

                  </div>
                )}

                {invoice.customer.phone && (
                  <div className="flex items-start gap-3">

                    <dt className="w-20 shrink-0 font-semibold text-slate-800">
                      Phone
                    </dt>

                    <dd className="min-w-0 flex-1 break-words font-bold text-black">
                      {invoice.customer.phone}
                    </dd>

                  </div>
                )}

                {invoice.customer.address && (
                  <div className="flex items-start gap-3">

                    <dt className="w-20 shrink-0 font-semibold text-slate-800">
                      Address
                    </dt>

                    <dd
                      className="
                        min-w-0
                        flex-1
                        whitespace-pre-line
                        break-words
                        font-medium
                        leading-5
                        text-black
                      "
                    >
                      {invoice.customer.address}
                    </dd>

                  </div>
                )}

                {invoice.customer.email && (
                  <div className="flex items-start gap-3">

                    <dt className="w-20 shrink-0 font-semibold text-slate-800">
                      Email
                    </dt>

                    <dd className="min-w-0 flex-1 break-all font-medium text-black">
                      {invoice.customer.email}
                    </dd>

                  </div>
                )}

              </dl>
            ) : (
              <div className="mt-4">

                <div className="flex items-start gap-3 text-[14px]">

                  <span className="w-20 shrink-0 font-semibold text-slate-800">
                    Name
                  </span>

                  <span className="font-bold text-black">
                    Walk-in Customer
                  </span>

                </div>

              </div>
            )}

          </div>

        </section>

        {/* ===================================================
            ITEMS
            =================================================== */}

        <section className="py-4">
       <div className="w-full overflow-x-auto">
    <table className="w-full min-w-[680px] table-fixed border-collapse text-[13px] print:min-w-0">
            <thead>

              <tr
                className="
                  border-y-2
                  border-black
                  text-[11px]
                  font-black
                  uppercase
                  tracking-wide
                  text-black
                "
              >

                <th className="w-[5%] py-3 text-left">
                  #
                </th>

                <th className="w-[41%] py-3 pr-3 text-left">
                  Product / Variant
                </th>

                <th className="w-[18%] py-3 pr-2 text-left">
                  SKU
                </th>

                <th className="w-[7%] py-3 text-center">
                  Qty
                </th>

                <th className="w-[14%] py-3 text-right">
                  Unit Price
                </th>

                <th className="w-[15%] py-3 text-right">
                  Amount
                </th>

              </tr>

            </thead>

            <tbody>

              {invoice.items.map(
                (
                  item,
                  index
                ) => (

                  <tr
                    key={item.id}
                    className="
                      break-inside-avoid
                      border-b
                      border-slate-400
                      align-top
                    "
                  >

                    <td className="py-3 font-semibold text-black">
                      {index + 1}
                    </td>

                    <td className="py-3 pr-4">

                      <p className="font-bold leading-5 text-black">
                        {item.productName}
                      </p>

                      {item.variantName && (
                        <p className="mt-1 text-xs font-semibold text-slate-800">
                          Variant:{' '}
                          {item.variantName}
                        </p>
                      )}

                    </td>

                    <td className="break-all py-3 pr-3 font-mono text-[11px] font-semibold text-slate-800">
                      {item.sku || '—'}
                    </td>

                    <td className="py-3 text-center font-bold text-black">
                      {item.quantity}
                    </td>

                    <td className="py-3 text-right font-bold tabular-nums text-black">
                      {formatCurrency(
                        item.unitPrice
                      )}
                    </td>

                    <td className="py-3 text-right font-black tabular-nums text-black">
                      {formatCurrency(
                        item.lineTotal
                      )}
                    </td>

                  </tr>

                )
              )}

            </tbody>

          </table>
            </div>

        </section>

        {/* ===================================================
            TOTALS
            =================================================== */}

        <section className="flex justify-end">

          <div className="w-full sm:w-[70%] md:w-[46%] print:w-[46%]">

            <div className="flex items-center justify-between py-2 text-[14px]">

              <span className="font-semibold text-slate-800">
                Subtotal
              </span>

              <span className="font-bold tabular-nums text-black">
                {formatCurrency(
                  invoice.subtotal
                )}
              </span>

            </div>

            <div className="flex items-center justify-between py-2 text-[14px]">

              <span className="font-semibold text-slate-800">
                Discount
              </span>

              <span className="font-bold tabular-nums text-black">
                {invoice.discount > 0
                  ? `-${formatCurrency(
                      invoice.discount
                    )}`
                  : formatCurrency(0)}
              </span>

            </div>

            {invoice.tax > 0 && (
              <div className="flex items-center justify-between py-2 text-[14px]">

                <span className="font-semibold text-slate-800">
                  Tax
                </span>

                <span className="font-bold tabular-nums text-black">
                  {formatCurrency(
                    invoice.tax
                  )}
                </span>

              </div>
            )}

            <div
              className="
                mt-1
                flex
                items-center
                justify-between
                border-t-2
                border-black
                py-3
              "
            >

              <span className="text-base font-black text-black">
                TOTAL
              </span>

              <span className="text-xl font-black tabular-nums text-black">
                {formatCurrency(
                  invoice.total
                )}
              </span>

            </div>

          </div>

        </section>

        {/* ===================================================
    REFUND INFORMATION
    =================================================== */}

{invoice.status === 'refunded' && (
  <section
    className="
      mt-5
      break-inside-avoid
      border-2
      border-red-700
    "
  >
    {/* Header */}

    <div
      className="
        border-b
        border-red-700
        bg-red-50
        px-4
        py-2.5
      "
    >
      <p
        className="
          text-xs
          font-black
          uppercase
          tracking-[0.14em]
          text-red-800
        "
      >
        Refund Information
      </p>
    </div>

    {/* Details */}

    <div className="px-4 py-3">

      <div
        className="
          grid
          grid-cols-1 sm:grid-cols-2 print:grid-cols-2
          gap-x-8
          gap-y-3
          text-[13px]
        "
      >
        {/* Refunded By */}

        <div>
          <p
            className="
              text-[11px]
              font-black
              uppercase
              tracking-wide
              text-slate-700
            "
          >
            Refunded By
          </p>

          <p className="mt-1 font-bold text-black">
            {invoice.refundedBy || '—'}
          </p>
        </div>

        {/* Refunded At */}

        <div>
          <p
            className="
              text-[11px]
              font-black
              uppercase
              tracking-wide
              text-slate-700
            "
          >
            Refunded At
          </p>

          <p className="mt-1 font-bold text-black">
            {invoice.refundedAt
              ? new Date(
                  invoice.refundedAt
                ).toLocaleString(
                  'en-GB',
                  {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }
                )
              : '—'}
          </p>
        </div>

      </div>

      {/* Refund Reason */}

      <div
        className="
          mt-3
          border-t
          border-slate-400
          pt-3
        "
      >
        <p
          className="
            text-[11px]
            font-black
            uppercase
            tracking-wide
            text-slate-700
          "
        >
          Refund Reason
        </p>

        <p
          className="
            mt-1
            whitespace-pre-wrap
            break-words
            text-[13px]
            font-semibold
            leading-5
            text-black
          "
        >
          {invoice.refundReason || '—'}
        </p>
      </div>

    </div>
  </section>
)}

        {/* ===================================================
            WARRANTY
            =================================================== */}

        <section
          className="
            mt-6
            border-t
            border-slate-400
            pt-4
          "
        >

          <p className="text-xs font-black uppercase tracking-[0.14em] text-black">
            Warranty & Purchase Information
          </p>

          <p className="mt-3 max-w-[155mm] text-[13px] font-medium leading-5 text-slate-900">
            Warranty coverage depends on the individual product
            and manufacturer terms. Please keep this invoice as
            proof of purchase for warranty, return, exchange, or
            after-sales support.
          </p>

        </section>

        {/* ===================================================
            FOOTER
            =================================================== */}

        <footer
          className="
            mt-6
            border-t
            border-slate-400
            pt-4
            text-center
          "
        >

          <p className="text-sm font-black text-black">
  Thank you for shopping with{' '}
  {storeSettings?.storeName ?? 'CAPY TECH'}
</p>

<p className="mt-1.5 text-[12px] font-semibold text-slate-800">
  Tech Accessories & Computer Shop
  {storeSettings?.phone
    ? ` • ${storeSettings.phone}`
    : ''}
</p>

        </footer>

      </main>

      {/* =====================================================
          PRINT CSS
          ===================================================== */}

      <style>
        {`
          @page {
            size: A4 portrait;
            margin: 0;
          }

          @media print {

            html,
            body {
              width: 210mm;
              height: auto;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
            }

            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .invoice-page {
              width: 210mm !important;

              min-height: 297mm !important;

              max-width: none !important;

              box-sizing: border-box !important;

              margin: 0 !important;

              padding:
                10mm
                12mm
                !important;

              background:
                #ffffff
                !important;

              box-shadow:
                none
                !important;

              color:
                #000000
                !important;
            }

            .invoice-page table {
              page-break-inside: auto;
            }

            .invoice-page thead {
              display: table-header-group;
            }

            .invoice-page tr {
              page-break-inside: avoid;
              break-inside: avoid;
            }

            .invoice-page img {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        `}
      </style>

    </div>
  );
}