import { useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { warrantySnapshotLabel } from '@/lib/serializedInventory';
import { formatDateTime } from '@/lib/format';

interface WarrantyRecord {
  sale_id: number | string; invoice_number: string; sale_status: string; purchase_date: string;
  legacy_warranty_months: number | string | null; sale_item_id: number | string;
  product_name: string; variant_name: string | null;
  product_sku_snapshot: string | null; variant_sku_snapshot: string | null;
  shop_warranty_eligible: boolean | null; shop_warranty_months: number | string | null;
  shop_warranty_start_date: string | null; shop_warranty_end_date: string | null;
  internal_sku_snapshot: string | null; manufacturer_serial_number_snapshot: string | null;
  stock_unit_state: string | null; released_at: string | null; release_reason: string | null;
}

export function WarrantyLookupPage() {
  const { toast } = useToast();
  const [type, setType] = useState<'invoice_number' | 'serial_number' | 'internal_sku'>('invoice_number');
  const [value, setValue] = useState('');
  const [records, setRecords] = useState<WarrantyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function lookup() {
    if (!value.trim() || loading) return;
    setLoading(true); setSearched(true);
    try {
      const result = await api.get<{ records: WarrantyRecord[] }>(`/api/warranty-lookup?${type}=${encodeURIComponent(value.trim())}`);
      setRecords(result.records);
    } catch (error) {
      setRecords([]); toast(error instanceof Error ? error.message : 'Warranty lookup failed.', 'error');
    } finally { setLoading(false); }
  }

  return <div className="space-y-5">
    <PageHeader title="Warranty Lookup" subtitle="Search saved sale-time warranty and serialized-unit records" />
    <Card><div className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
      <select className="h-11 rounded-lg border border-slate-200 px-3" value={type} onChange={(e) => { setType(e.target.value as typeof type); setRecords([]); setSearched(false); }}><option value="invoice_number">Invoice number</option><option value="serial_number">Manufacturer serial</option><option value="internal_sku">Internal SU- code</option></select>
      <input className="h-11 rounded-lg border border-slate-200 px-3 font-mono" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} placeholder={type === 'invoice_number' ? 'INV-000123' : type === 'internal_sku' ? 'SU-123' : 'Manufacturer serial number'} />
      <Button loading={loading} disabled={!value.trim()} leftIcon={<Search className="h-4 w-4" />} onClick={lookup}>Search</Button>
    </div><p className="mt-3 text-xs text-slate-500">Results always use immutable invoice snapshots. Current product warranty settings are not consulted.</p></Card>
    {records.length > 0 && <div className="space-y-3">{records.map((record, index) => <Card key={`${record.sale_item_id}-${record.internal_sku_snapshot || index}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{record.product_name}{record.variant_name ? ` · ${record.variant_name}` : ''}</p><p className="mt-1 text-sm text-slate-500">{record.invoice_number} · {formatDateTime(record.purchase_date)}</p></div><span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${record.sale_status === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{record.sale_status}</span></div>
      <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm md:grid-cols-2 lg:grid-cols-3"><div><p className="text-xs uppercase text-slate-400">Saved warranty</p><p className="font-bold">{warrantySnapshotLabel({ shopWarrantyEligible: record.shop_warranty_eligible, shopWarrantyMonths: record.shop_warranty_months == null ? null : Number(record.shop_warranty_months), shopWarrantyEndDate: record.shop_warranty_end_date })}</p>{record.shop_warranty_start_date && <p className="text-xs text-slate-500">{record.shop_warranty_start_date} to {record.shop_warranty_end_date}</p>}{record.shop_warranty_eligible == null && record.legacy_warranty_months != null && <p className="text-xs text-slate-500">Legacy invoice warranty: {record.legacy_warranty_months} month(s)</p>}</div><div><p className="text-xs uppercase text-slate-400">Serial identity</p><p className="break-all font-mono font-semibold">{record.manufacturer_serial_number_snapshot || 'Not serialized'}</p><p className="font-mono text-xs text-slate-500">{record.internal_sku_snapshot || 'No SU- snapshot'}</p></div><div><p className="text-xs uppercase text-slate-400">SKU snapshot</p><p className="font-mono font-semibold">{record.variant_sku_snapshot || record.product_sku_snapshot || 'Not recorded'}</p><p className="text-xs text-slate-500">Unit state: {record.stock_unit_state || 'not applicable'}{record.release_reason ? ` · ${record.release_reason}` : ''}</p></div></div>
    </Card>)}</div>}
    {searched && !loading && records.length === 0 && <Card><p className="py-8 text-center text-slate-500">No warranty record found for this search.</p></Card>}
  </div>;
}
