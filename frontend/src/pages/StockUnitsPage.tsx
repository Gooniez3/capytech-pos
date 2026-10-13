import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Barcode, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  WARRANTY_MONTHS,
  type InventoryPolicy,
  type StockUnitState,
  type StockUnitSummary,
  validateSerialBatch,
} from '@/lib/serializedInventory';

interface ProductPolicy extends InventoryPolicy {
  id: number | string; name: string; sku: string;
  stock_quantity: number | string; variant_count?: number | string;
}
interface VariantPolicy extends InventoryPolicy {
  id: number | string; product_id: number | string; name: string; sku: string;
  stock_quantity: number | string;
}
interface StockUnitDetails extends StockUnitSummary {
  sale_id?: number | string | null; invoice_number?: string | null; sale_status?: string | null;
  history: Array<{ id: number | string; event_type: string; from_state: string | null; to_state: string; actor_username: string | null; reason: string | null; occurred_at: string }>;
}
interface StockPage { items: StockUnitSummary[]; pagination: { page: number; limit: number; total: number; pages: number } }

const stateStyles: Record<StockUnitState, string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  sold: 'bg-blue-50 text-blue-700 border-blue-200',
  quarantined: 'bg-amber-50 text-amber-800 border-amber-200',
  retired: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function StockUnitsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const admin = user?.role === 'admin';
  const [units, setUnits] = useState<StockPage>({ items: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } });
  const [products, setProducts] = useState<ProductPolicy[]>([]);
  const [policyVariants, setPolicyVariants] = useState<VariantPolicy[]>([]);
  const [batchVariants, setBatchVariants] = useState<VariantPolicy[]>([]);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StockUnitDetails | null>(null);
  const [batchOpen, setBatchOpen] = useState<'receive' | 'adopt' | null>(null);
  const [targetProduct, setTargetProduct] = useState('');
  const [targetVariant, setTargetVariant] = useState('');
  const [serialText, setSerialText] = useState('');
  const [reason, setReason] = useState('');
  const [correctedSerial, setCorrectedSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [policyProduct, setPolicyProduct] = useState('');
  const [policyVariant, setPolicyVariant] = useState('');
  const [serialSetting, setSerialSetting] = useState<'inherit' | 'on' | 'off'>('off');
  const [warrantySetting, setWarrantySetting] = useState<'inherit' | 'on' | 'off'>('off');
  const [warrantyMonths, setWarrantyMonths] = useState('3');
  const [adoptionInputs, setAdoptionInputs] = useState<Record<string, string>>({});

  const loadUnits = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (query.trim()) params.set('q', query.trim());
      if (state) params.set('state', state);
      setUnits(await api.get<StockPage>(`/api/stock-units?${params}`));
    } catch (error) { toast(error instanceof Error ? error.message : 'Failed to load stock units.', 'error'); }
    finally { setLoading(false); }
  }, [page, query, state, toast]);

  const loadProducts = useCallback(async () => {
    try { setProducts(await api.get<ProductPolicy[]>('/api/products')); }
    catch (error) { toast(error instanceof Error ? error.message : 'Failed to load products.', 'error'); }
  }, [toast]);

  useEffect(() => { loadUnits(); }, [loadUnits]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  async function loadPolicyVariants(productId: string) {
    setPolicyVariants(productId ? await api.get<VariantPolicy[]>(`/api/products/${productId}/variants`) : []);
  }

  async function loadBatchVariants(productId: string) {
    setBatchVariants(productId ? await api.get<VariantPolicy[]>(`/api/products/${productId}/variants`) : []);
  }

  const chosenProduct = products.find((product) => String(product.id) === policyProduct);
  const chosenVariant = policyVariants.find((variant) => String(variant.id) === policyVariant);
  const effective = chosenVariant || chosenProduct;
  const adoptionTargets = useMemo(() => {
    const enablesTracking = chosenVariant
      ? serialSetting === 'on'
        || (serialSetting === 'inherit' && chosenProduct?.effective_serial_tracking_enabled === true)
      : serialSetting === 'on';
    if (!enablesTracking || !chosenProduct) return [];
    if (chosenVariant) return !chosenVariant.effective_serial_tracking_enabled && Number(chosenVariant.stock_quantity) > 0
      ? [{ id: String(chosenVariant.id), label: chosenVariant.name, quantity: Number(chosenVariant.stock_quantity), variantId: Number(chosenVariant.id) }] : [];
    if (policyVariants.length > 0) return policyVariants.filter((variant) =>
      variant.serial_tracking_enabled === null && !variant.effective_serial_tracking_enabled && Number(variant.stock_quantity) > 0
    ).map((variant) => ({ id: String(variant.id), label: variant.name, quantity: Number(variant.stock_quantity), variantId: Number(variant.id) }));
    return !chosenProduct.effective_serial_tracking_enabled && Number(chosenProduct.stock_quantity) > 0
      ? [{ id: 'product', label: chosenProduct.name, quantity: Number(chosenProduct.stock_quantity), variantId: null }] : [];
  }, [chosenProduct, chosenVariant, serialSetting, policyVariants]);

  function syncPolicyForm(product: ProductPolicy | undefined, variant?: VariantPolicy) {
    const policy = variant || product;
    if (!policy) return;
    setSerialSetting(variant ? policy.serial_tracking_enabled == null ? 'inherit' : policy.serial_tracking_enabled ? 'on' : 'off' : policy.serial_tracking_enabled ? 'on' : 'off');
    setWarrantySetting(variant ? policy.shop_warranty_enabled == null ? 'inherit' : policy.shop_warranty_enabled ? 'on' : 'off' : policy.shop_warranty_enabled ? 'on' : 'off');
    setWarrantyMonths(String(policy.shop_warranty_months || policy.effective_shop_warranty_months || 3));
    setAdoptionInputs({});
  }

  async function savePolicy() {
    if (!chosenProduct || !admin) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        serial_tracking_enabled: chosenVariant && serialSetting === 'inherit' ? null : serialSetting === 'on',
        shop_warranty_enabled: chosenVariant && warrantySetting === 'inherit' ? null : warrantySetting === 'on',
        shop_warranty_months: warrantySetting === 'on' ? Number(warrantyMonths) : null,
      };
      if (
        adoptionTargets.length === 1
        && (Boolean(chosenVariant) || adoptionTargets[0].variantId === null)
      ) {
        payload.serial_numbers = validateSerialBatch(
          adoptionInputs[adoptionTargets[0].id] || '',
          adoptionTargets[0].quantity
        );
      } else if (adoptionTargets.length > 0) {
        payload.adoption_batches = adoptionTargets.map((target) => ({
          variant_id: target.variantId,
          serial_numbers: validateSerialBatch(adoptionInputs[target.id] || '', target.quantity),
        }));
      }
      const endpoint = chosenVariant
        ? `/api/products/${chosenProduct.id}/variants/${chosenVariant.id}/inventory-policy`
        : `/api/products/${chosenProduct.id}/inventory-policy`;
      await api.patch(endpoint, payload);
      toast('Inventory policy saved.', 'success');
      await loadProducts(); await loadPolicyVariants(String(chosenProduct.id)); await loadUnits();
    } catch (error) { toast(error instanceof Error ? error.message : 'Failed to save policy.', 'error'); }
    finally { setBusy(false); }
  }

  async function submitBatch() {
    if (!batchOpen || !targetProduct || !admin) return;
    setBusy(true);
    try {
      const product = products.find((entry) => String(entry.id) === targetProduct);
      const variant = batchVariants.find((entry) => String(entry.id) === targetVariant);
      const expected = batchOpen === 'adopt' ? Number(variant?.stock_quantity ?? product?.stock_quantity ?? 0) : undefined;
      const serials = validateSerialBatch(serialText, expected);
      await api.post(`/api/stock-units/${batchOpen}`, { batches: [{
        product_id: Number(targetProduct), variant_id: targetVariant ? Number(targetVariant) : null,
        serial_numbers: serials,
      }] });
      toast(`${serials.length} stock unit${serials.length === 1 ? '' : 's'} ${batchOpen === 'receive' ? 'received' : 'adopted'}.`, 'success');
      setBatchOpen(null); setSerialText(''); await loadUnits(); await loadProducts();
    } catch (error) { toast(error instanceof Error ? error.message : `Failed to ${batchOpen} units.`, 'error'); }
    finally { setBusy(false); }
  }

  async function loadDetails(id: string | number) {
    try { setSelected(await api.get<StockUnitDetails>(`/api/stock-units/${id}`)); }
    catch (error) { toast(error instanceof Error ? error.message : 'Failed to load unit.', 'error'); }
  }

  async function printUnitBarcode(unit: StockUnitSummary) {
    try {
      const label = await api.get<{
        unit_code: string; product_name: string; variant_name: string | null;
        manufacturer_serial_number: string; barcode: string;
      }>(`/api/stock-units/${unit.id}/barcode`);
      const popup = window.open('', '_blank', 'width=480,height=420');
      if (!popup) throw new Error('Allow pop-ups to print the stock-unit label.');
      const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
      }[character] || character));
      popup.document.write(`<!doctype html><html><head><title>${escape(label.unit_code)}</title><style>
        @page{size:50mm 30mm;margin:0}html,body{margin:0;width:50mm;height:30mm;font-family:Arial,sans-serif}
        .label{box-sizing:border-box;width:50mm;height:30mm;padding:2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
        img{width:42mm;height:12mm;object-fit:contain}.code{font:700 8pt monospace}.name,.serial{max-width:46mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7pt}.name{font-weight:700}
      </style></head><body><div class="label"><img id="barcode" src="${label.barcode}" alt="${escape(label.unit_code)}"><div class="code">${escape(label.unit_code)}</div><div class="name">${escape(label.product_name)}${label.variant_name ? ` - ${escape(label.variant_name)}` : ''}</div><div class="serial">SN: ${escape(label.manufacturer_serial_number)}</div></div><script>const image=document.getElementById('barcode');const print=()=>setTimeout(()=>window.print(),100);image.complete?print():image.onload=print;</script></body></html>`);
      popup.document.close();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to print unit barcode.', 'error');
    }
  }

  async function lifecycle(action: 'release' | 'retire') {
    if (!selected || !admin || !window.confirm(`${action === 'retire' ? 'Retire' : 'Release'} ${selected.unit_code}?`)) return;
    setBusy(true);
    try {
      await api.post(`/api/stock-units/${action}`, { unit_ids: [selected.id], reason: reason.trim() || null });
      toast(`Stock unit ${action === 'retire' ? 'retired' : 'released'}.`, 'success'); setSelected(null); setReason(''); await loadUnits();
    } catch (error) { toast(error instanceof Error ? error.message : `Failed to ${action} unit.`, 'error'); }
    finally { setBusy(false); }
  }

  async function correctSerial() {
    if (!selected || !admin || !correctedSerial.trim()) return;
    if (!window.confirm(`Retire ${selected.unit_code} and create a replacement with a new permanent CT identity and serial “${correctedSerial.trim()}”? The old serial and CT code remain reserved.`)) return;
    setBusy(true);
    try {
      await api.patch(`/api/stock-units/${selected.id}/serial`, { serial_number: correctedSerial.trim(), reason: reason.trim() || 'serial correction' });
      toast('Original unit retired; replacement created with a new SU- identity.', 'success'); setSelected(null); setCorrectedSerial(''); setReason(''); await loadUnits();
    } catch (error) { toast(error instanceof Error ? error.message : 'Failed to correct serial.', 'error'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <PageHeader title="Stock Units" subtitle="Serialized inventory, lifecycle history, and shop warranty policies" />
    {admin && <Card>
      <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Inventory policy</h2><p className="text-sm text-slate-500">Product defaults and optional variant overrides</p></div><ShieldCheck className="h-5 w-5 text-brand-600" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <select className="h-11 rounded-lg border border-slate-200 px-3" value={policyProduct} onChange={async (event) => { const id = event.target.value; setPolicyProduct(id); setPolicyVariant(''); const product = products.find((entry) => String(entry.id) === id); syncPolicyForm(product); await loadPolicyVariants(id); }}><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select>
        <select className="h-11 rounded-lg border border-slate-200 px-3" value={policyVariant} disabled={!policyProduct} onChange={(event) => { setPolicyVariant(event.target.value); syncPolicyForm(chosenProduct, policyVariants.find((entry) => String(entry.id) === event.target.value)); }}><option value="">Product default</option>{policyVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.sku}</option>)}</select>
      </div>
      {effective && <div className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">Serial tracking<select className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3" value={serialSetting} onChange={(e) => setSerialSetting(e.target.value as typeof serialSetting)}>{chosenVariant && <option value="inherit">Inherit product</option>}<option value="off">Disabled</option><option value="on">Enabled</option></select></label>
          <label className="text-sm font-semibold text-slate-700">Shop warranty<select className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3" value={warrantySetting} onChange={(e) => setWarrantySetting(e.target.value as typeof warrantySetting)}>{chosenVariant && <option value="inherit">Inherit product</option>}<option value="off">Disabled</option><option value="on">Enabled</option></select></label>
          <label className="text-sm font-semibold text-slate-700">Duration<select className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3" disabled={warrantySetting !== 'on'} value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)}>{WARRANTY_MONTHS.map((months) => <option key={months} value={months}>{months} month{months === 1 ? '' : 's'}</option>)}</select></label>
        </div>
        <p className="text-xs text-slate-600">Effective now: <strong>{effective.effective_serial_tracking_enabled ? 'serialized' : 'quantity-based'}</strong>; <strong>{effective.effective_shop_warranty_enabled ? `${effective.effective_shop_warranty_months} month shop warranty` : 'no shop warranty'}</strong>. {chosenVariant && `Sources: tracking ${effective.serial_tracking_source}, warranty ${effective.shop_warranty_source}.`}</p>
        {adoptionTargets.map((target) => <label key={target.id} className="block text-sm font-semibold text-amber-900">Adopt exactly {target.quantity} existing unit{target.quantity === 1 ? '' : 's'} for {target.label}<textarea className="mt-1 min-h-28 w-full rounded-lg border border-amber-300 bg-white p-3 font-mono text-sm" value={adoptionInputs[target.id] || ''} onChange={(e) => setAdoptionInputs((current) => ({ ...current, [target.id]: e.target.value }))} placeholder="One manufacturer serial per line" /></label>)}
        <Button onClick={savePolicy} disabled={busy}>Save policy</Button>
      </div>}
    </Card>}

    <Card><div className="flex flex-col gap-3 md:flex-row md:items-center">
      <div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search CT code, serial, product, or variant" /></div>
      <select className="h-10 rounded-lg border border-slate-200 px-3" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}><option value="">All states</option>{Object.keys(stateStyles).map((value) => <option key={value}>{value}</option>)}</select>
      <Button variant="outline" onClick={loadUnits} leftIcon={<RefreshCw className="h-4 w-4" />}>Refresh</Button>
      {admin && <><Button variant="outline" onClick={() => setBatchOpen('adopt')}>Adopt stock</Button><Button onClick={() => setBatchOpen('receive')}>Receive units</Button></>}
    </div></Card>

    <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">CT barcode</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Manufacturer SN</th><th className="px-4 py-3">State</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-slate-100">{units.items.map((unit) => <tr key={unit.id}><td className="px-4 py-3 font-mono font-bold">{unit.unit_code}</td><td className="px-4 py-3"><p className="font-semibold">{unit.product_name}</p><p className="text-xs text-slate-500">{unit.variant_name || unit.product_code}</p></td><td className="max-w-xs break-all px-4 py-3 font-mono">{unit.manufacturer_serial_number}</td><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${stateStyles[unit.state]}`}>{unit.state}</span></td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button variant="outline" leftIcon={<Barcode className="h-4 w-4" />} onClick={() => printUnitBarcode(unit)}>Print</Button><Button variant="outline" onClick={() => loadDetails(unit.id)}>Details</Button></div></td></tr>)}</tbody></table></div>{!loading && units.items.length === 0 && <p className="p-10 text-center text-slate-500">No stock units match these filters.</p>}<div className="flex items-center justify-between border-t p-3 text-sm"><span>{units.pagination.total} units</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="px-2 py-2">{page} / {Math.max(1, units.pagination.pages)}</span><Button variant="outline" disabled={page >= units.pagination.pages} onClick={() => setPage(page + 1)}>Next</Button></div></div></Card>

    <Modal open={Boolean(batchOpen)} onClose={() => setBatchOpen(null)} title={batchOpen === 'receive' ? 'Receive serialized units' : 'Adopt existing stock'} description={batchOpen === 'adopt' ? 'The serial count must exactly match the current aggregate quantity.' : 'Receiving creates available units and increases sellable quantity.'}>
      <div className="space-y-3"><select className="h-11 w-full rounded-lg border border-slate-200 px-3" value={targetProduct} onChange={async (e) => { setTargetProduct(e.target.value); setTargetVariant(''); await loadBatchVariants(e.target.value); }}><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><select className="h-11 w-full rounded-lg border border-slate-200 px-3" value={targetVariant} onChange={(e) => setTargetVariant(e.target.value)}><option value="">Product inventory</option>{batchVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</select><textarea className="min-h-44 w-full rounded-lg border border-slate-200 p-3 font-mono text-sm" value={serialText} onChange={(e) => setSerialText(e.target.value)} placeholder="One manufacturer serial per line" /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBatchOpen(null)}>Cancel</Button><Button disabled={busy || !targetProduct} onClick={submitBatch}>{batchOpen === 'receive' ? 'Receive units' : 'Adopt stock'}</Button></div></div>
    </Modal>

    <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.unit_code || 'Stock unit'} description={selected ? `${selected.product_name}${selected.variant_name ? ` · ${selected.variant_name}` : ''}` : undefined}>
      {selected && <div className="space-y-4"><div className="rounded-xl bg-slate-50 p-4 text-sm"><p><strong>Manufacturer SN:</strong> <span className="break-all font-mono">{selected.manufacturer_serial_number}</span></p><p><strong>State:</strong> {selected.state}</p>{selected.invoice_number && <p><strong>Sale:</strong> {selected.invoice_number} ({selected.sale_status})</p>}</div><div><h3 className="mb-2 font-bold">Immutable history</h3><div className="max-h-52 space-y-2 overflow-y-auto">{selected.history.map((event) => <div key={event.id} className="border-l-2 border-slate-300 pl-3 text-sm"><p className="font-semibold">{event.event_type}: {event.from_state || 'new'} → {event.to_state}</p><p className="text-xs text-slate-500">{new Date(event.occurred_at).toLocaleString()} · {event.actor_username || 'system'}{event.reason ? ` · ${event.reason}` : ''}</p></div>)}</div></div>{admin && <><input className="h-10 w-full rounded-lg border border-slate-200 px-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason / audit note" />{selected.state === 'available' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="mb-2 text-sm font-semibold text-amber-900">Serial correction retires this unit and creates a replacement with a new internal SU- identity. It never edits historical identity, and the old serial remains reserved.</p><div className="flex gap-2"><input className="h-10 flex-1 rounded-lg border border-amber-300 px-3 font-mono" value={correctedSerial} onChange={(e) => setCorrectedSerial(e.target.value)} placeholder="Correct manufacturer serial" /><Button disabled={busy || !correctedSerial.trim()} onClick={correctSerial}>Retire & replace</Button></div></div>}<div className="flex justify-end gap-2">{selected.state === 'quarantined' && <Button onClick={() => lifecycle('release')}>Release to available</Button>}{(selected.state === 'available' || selected.state === 'quarantined') && <Button variant="danger" leftIcon={<Archive className="h-4 w-4" />} onClick={() => lifecycle('retire')}>Retire unit</Button>}</div></>}</div>}
    </Modal>
  </div>;
}
