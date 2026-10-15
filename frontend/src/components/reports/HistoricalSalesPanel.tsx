import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FileCheck2,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/currency';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';

interface HistoricalSummary {
  totalTransactions: number;
  completedTransactions: number;
  completedAmount: number;
  refundedTransactions: number;
  refundedAmount: number;
}

interface HistoricalMonth {
  saleMonth: string;
  completedTransactions: number;
  completedAmount: number;
  refundedTransactions: number;
  refundedAmount: number;
}

interface HistoricalTransaction {
  legacyId: string;
  invoiceNumber: string;
  createdAt: string;
  status: 'completed' | 'refunded' | 'voided';
  paymentMethod: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  source: 'Archived / Legacy POS';
}

interface HistoricalReport {
  imported: boolean;
  archive: null | {
    digest: string;
    sourceLabel: string;
    transactionCount: number;
    importedAt: string;
  };
  summary: HistoricalSummary | null;
  months: HistoricalMonth[];
  transactions: HistoricalTransaction[];
}

interface Preview {
  digest: string;
  expiresAt: string;
  previewToken: string;
  summary: HistoricalSummary;
  months: HistoricalMonth[];
}

type ArchiveFiles = {
  historicalSales: File | null;
  monthlySummary: File | null;
  allTimeSummary: File | null;
};

const EMPTY_FILES: ArchiveFiles = {
  historicalSales: null,
  monthlySummary: null,
  allTimeSummary: null,
};

function monthName(value: string) {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

// Legacy timestamps are rendered from their text components so the browser
// cannot silently reinterpret a timezone-less shop timestamp.
function legacyDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return value;
  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  const zone = match[7] ? ` ${match[7]}` : ' (legacy local time)';
  return `${date}, ${match[4]}:${match[5]}${match[6] ? `:${match[6]}` : ''}${zone}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function archiveForm(files: ArchiveFiles, preview?: Preview) {
  const form = new FormData();
  for (const [field, file] of Object.entries(files)) {
    if (file) form.append(field, file, file.name);
  }
  if (preview) {
    form.append('previewToken', preview.previewToken);
    form.append('confirm', 'IMPORT ARCHIVED SALES');
  }
  return form;
}

export function HistoricalSalesPanel() {
  const { toast } = useToast();
  const [report, setReport] = useState<HistoricalReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [files, setFiles] = useState<ArchiveFiles>(EMPTY_FILES);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ status });
      if (appliedSearch) query.set('q', appliedSearch);
      setReport(await api.get<HistoricalReport>(`/api/reports/historical?${query}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load historical sales.');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, status]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const allFilesSelected = useMemo(
    () => Object.values(files).every((file) => file !== null),
    [files]
  );

  function selectFile(field: keyof ArchiveFiles, file: File | null) {
    setFiles((current) => ({ ...current, [field]: file }));
    setPreview(null);
  }

  async function runPreview() {
    if (!allFilesSelected) return;
    setPreviewing(true);
    try {
      const result = await api.post<Preview>('/api/reports/historical/preview', archiveForm(files));
      setPreview(result);
      toast('Archive validated. Review the totals before importing.', 'success');
    } catch (previewError) {
      setPreview(null);
      toast(previewError instanceof Error ? previewError.message : 'Archive validation failed.', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const result = await api.post<{ imported: boolean; alreadyImported: boolean }>(
        '/api/reports/historical/import',
        archiveForm(files, preview)
      );
      setConfirmOpen(false);
      setPreview(null);
      setFiles(EMPTY_FILES);
      toast(result.alreadyImported ? 'This exact archive was already imported.' : 'Historical sales imported successfully.', 'success');
      await loadReport();
    } catch (importError) {
      toast(importError instanceof Error ? importError.message : 'Historical import failed.', 'error');
    } finally {
      setImporting(false);
    }
  }

  function exportCsv() {
    if (!report?.transactions.length) return;
    const headers = ['Source', 'Original invoice', 'Transaction date', 'Status', 'Payment method', 'Subtotal', 'Discount', 'Tax', 'Total'];
    const rows = report.transactions.map((sale) => [
      sale.source, sale.invoiceNumber, sale.createdAt, sale.status, sale.paymentMethod,
      sale.subtotal.toFixed(2), sale.discount.toFixed(2), sale.tax.toFixed(2), sale.total.toFixed(2),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}\r\n`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'CapyTech_Historical_Sales.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (loading && !report) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        <RefreshCw className="mr-3 h-5 w-5 animate-spin text-slate-400" />
        <span className="text-sm font-medium text-slate-500">Loading historical sales…</span>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-danger-500" />
        <p className="mt-3 font-semibold text-slate-900">Historical reports could not be loaded</p>
        <p className="mt-1 text-sm text-slate-500">{error}</p>
        <Button className="mt-4" onClick={() => void loadReport()}>Try Again</Button>
      </div>
    );
  }

  if (!report?.imported || !report.summary) {
    return (
      <div className="space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600"><Archive className="h-5 w-5" /></div>
            <div>
              <h2 className="font-bold text-slate-900">Import Archived / Legacy POS sales</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Owner-only. Select the complete three-file archive, validate it, review the preview, then explicitly confirm. Imported records stay separate from current sales and inventory.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <FilePicker label="Historical transactions" expected="historical-sales.csv" file={files.historicalSales} onChange={(file) => selectFile('historicalSales', file)} />
            <FilePicker label="Monthly summary" expected="monthly-sales-summary.csv" file={files.monthlySummary} onChange={(file) => selectFile('monthlySummary', file)} />
            <FilePicker label="All-time summary" expected="all-time-sales-summary.csv" file={files.allTimeSummary} onChange={(file) => selectFile('allTimeSummary', file)} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button leftIcon={<FileCheck2 className="h-4 w-4" />} disabled={!allFilesSelected} loading={previewing} onClick={() => void runPreview()}>
              Validate &amp; Preview
            </Button>
            <span className="text-xs text-slate-400">Maximum 1 MiB per file; no file is imported during preview.</span>
          </div>
        </section>

        {preview && (
          <PreviewCard preview={preview} onImport={() => setConfirmOpen(true)} />
        )}

        <ConfirmDialog
          open={confirmOpen}
          title="Import validated historical sales?"
          description={`Import ${preview?.summary.totalTransactions ?? 0} read-only Archived / Legacy POS transactions. This archive cannot be replaced through the application.`}
          confirmLabel="Import Archived Sales"
          variant="warning"
          busy={importing}
          onConfirm={confirmImport}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-success-600" />
          <div>
            <p className="text-sm font-bold text-slate-900">Archived / Legacy POS</p>
            <p className="text-xs text-slate-500">Read-only historical records. They do not affect current sales, invoices, or inventory.</p>
          </div>
        </div>
        <Button variant="outline" leftIcon={<Download className="h-4 w-4" />} disabled={!report.transactions.length} onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Completed sales" value={formatCurrency(report.summary.completedAmount)} />
        <SummaryCard label="Completed transactions" value={formatNumber(report.summary.completedTransactions)} />
        <SummaryCard label="Refunded amount" value={formatCurrency(report.summary.refundedAmount)} tone="danger" />
        <SummaryCard label="Refunded transactions" value={formatNumber(report.summary.refundedTransactions)} tone="danger" />
        <SummaryCard label="Total historical transactions" value={formatNumber(report.summary.totalTransactions)} />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-bold text-slate-900">Monthly history</h2>
          <p className="mt-1 text-sm text-slate-500">Completed totals are not reduced by the separately reported refunds.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3">Month</th><th className="px-5 py-3 text-right">Completed</th><th className="px-5 py-3 text-right">Completed amount</th><th className="px-5 py-3 text-right">Refunded</th><th className="px-5 py-3 text-right">Refunded amount</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.months.map((month) => (
                <tr key={month.saleMonth}>
                  <td className="whitespace-nowrap px-5 py-3 font-semibold text-slate-900">{monthName(month.saleMonth)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatNumber(month.completedTransactions)}</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatCurrency(month.completedAmount)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-danger-600">{formatNumber(month.refundedTransactions)}</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-danger-600">{formatCurrency(month.refundedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Historical transactions</h2>
              <p className="mt-1 text-sm text-slate-500">Archived / Legacy POS invoices are read-only and may share numbers with current invoices.</p>
            </div>
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim()); }}>
              <Input aria-label="Search historical invoice" placeholder="Search invoice number" value={search} leftIcon={<Search className="h-4 w-4" />} onChange={(event) => setSearch(event.target.value)} />
              <select aria-label="Filter historical status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30">
                <option value="all">All statuses</option><option value="completed">Completed</option><option value="refunded">Refunded</option><option value="voided">Voided</option>
              </select>
              <Button type="submit" disabled={loading}>Search</Button>
            </form>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Original invoice</th><th className="px-4 py-3">Transaction date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3 text-right">Subtotal</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Tax</th><th className="px-4 py-3 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {report.transactions.map((sale) => (
                <tr key={`legacy-${sale.legacyId}`}>
                  <td className="px-4 py-3"><p className="font-mono font-bold text-slate-900">{sale.invoiceNumber}</p><p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-600">Archived / Legacy POS</p></td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{legacyDate(sale.createdAt)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold capitalize ${sale.status === 'completed' ? 'bg-success-50 text-success-700' : sale.status === 'refunded' ? 'bg-danger-50 text-danger-700' : 'bg-slate-100 text-slate-600'}`}>{sale.status}</span></td>
                  <td className="px-4 py-3 text-slate-600">{sale.paymentMethod}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(sale.subtotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(sale.discount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(sale.tax)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{formatCurrency(sale.total)}</td>
                </tr>
              ))}
              {!report.transactions.length && <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-500">No archived transactions match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FilePicker({ label, expected, file, onChange }: { label: string; expected: string; file: File | null; onChange: (file: File | null) => void }) {
  return (
    <label className="block rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/30">
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Upload className="h-4 w-4 text-brand-600" />{label}</span>
      <span className="mt-1 block font-mono text-xs text-slate-500">{expected}</span>
      <input className="mt-3 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:font-semibold file:text-slate-700" type="file" accept=".csv,text/csv" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      {file && <span className="mt-2 block truncate text-xs font-medium text-success-700">Selected: {file.name}</span>}
    </label>
  );
}

function SummaryCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-3 text-xl font-bold tabular-nums ${tone === 'danger' ? 'text-danger-600' : 'text-slate-900'}`}>{value}</p></div>;
}

function PreviewCard({ preview, onImport }: { preview: Preview; onImport: () => void }) {
  return (
    <section className="rounded-xl border border-success-200 bg-success-50/30 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-bold text-slate-900">Validated import preview</h2><p className="mt-1 text-sm text-slate-500">All three files reconcile. Preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}.</p></div>
        <Button variant="success" leftIcon={<Archive className="h-4 w-4" />} onClick={onImport}>Review &amp; Confirm Import</Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Completed sales" value={formatCurrency(preview.summary.completedAmount)} />
        <SummaryCard label="Completed count" value={formatNumber(preview.summary.completedTransactions)} />
        <SummaryCard label="Refunded amount" value={formatCurrency(preview.summary.refundedAmount)} tone="danger" />
        <SummaryCard label="Refunded count" value={formatNumber(preview.summary.refundedTransactions)} tone="danger" />
        <SummaryCard label="Total records" value={formatNumber(preview.summary.totalTransactions)} />
      </div>
    </section>
  );
}
