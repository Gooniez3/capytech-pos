export const WARRANTY_MONTHS = [1, 3, 6, 12] as const;

export type WarrantyDuration = typeof WARRANTY_MONTHS[number];
export type StockUnitState = 'available' | 'sold' | 'quarantined' | 'retired';

export interface InventoryPolicy {
  serial_tracking_enabled: boolean | null;
  shop_warranty_enabled: boolean | null;
  shop_warranty_months: WarrantyDuration | null;
  effective_serial_tracking_enabled: boolean;
  effective_shop_warranty_enabled: boolean;
  effective_shop_warranty_months: WarrantyDuration | null;
  serial_tracking_source: 'product' | 'variant';
  shop_warranty_source: 'product' | 'variant';
}

export interface StockUnitSummary {
  id: number | string;
  internal_sku: string;
  unit_code: string;
  manufacturer_serial_number: string;
  product_id: number | string;
  variant_id: number | string | null;
  product_name: string;
  product_sku: string;
  product_code?: string;
  variant_name: string | null;
  variant_sku: string | null;
  variant_product_code?: string | null;
  effective_price?: number | string;
  effective_stock_quantity?: number | string;
  effective_serial_tracking_enabled?: boolean;
  effective_shop_warranty_enabled?: boolean;
  effective_shop_warranty_months?: WarrantyDuration | null;
  active_assignment_id?: number | string | null;
  product_is_active?: boolean;
  variant_is_active?: boolean | null;
  state: StockUnitState;
}

export const UNIT_CODE_PATTERN = /^CT\d{6,}$/i;

export function isUnitBarcode(value: string): boolean {
  return UNIT_CODE_PATTERN.test(value.trim());
}

export function serialLines(value: string): string[] {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

export function normalizedSerialKey(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function validateSerialBatch(value: string, expected?: number): string[] {
  const serials = serialLines(value);
  if (expected !== undefined && serials.length !== expected) {
    throw new Error(`Enter exactly ${expected} unique serial number${expected === 1 ? '' : 's'}.`);
  }
  const normalized = serials.map(normalizedSerialKey);
  if (normalized.some((entry) => !entry)) throw new Error('Serial numbers must contain a letter or number.');
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Serial numbers must be unique after normalization.');
  }
  return serials;
}

export function selectedUnitIds(
  selections: Record<string, StockUnitSummary[]>,
  cartKey: string
): string[] {
  return (selections[cartKey] || []).map((unit) => String(unit.id)).sort((left, right) => {
    const a = BigInt(left); const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function assertCheckoutSelections(
  lines: Array<{ cartKey: string; quantity: number; tracked: boolean }>,
  selections: Record<string, StockUnitSummary[]>
): void {
  const all = new Set<string>();
  for (const line of lines) {
    const ids = selectedUnitIds(selections, line.cartKey);
    if (line.tracked && ids.length !== line.quantity) {
      throw new Error(`Select exactly ${line.quantity} physical unit${line.quantity === 1 ? '' : 's'} for every serialized item.`);
    }
    if (!line.tracked && ids.length !== 0) throw new Error('Untracked items cannot contain stock-unit selections.');
    for (const id of ids) {
      if (all.has(id)) throw new Error('The same physical unit cannot be selected twice.');
      all.add(id);
    }
  }
}

export function checkoutAttemptSignature(input: unknown): string {
  return JSON.stringify(input);
}

export function advanceCheckoutAttempt(
  current: {
    signature: string;
    idempotencyKey: string | null;
    conflictMessage: string;
  },
  nextSignature: string
) {
  if (current.signature === nextSignature) return current;
  return {
    signature: nextSignature,
    idempotencyKey: null,
    conflictMessage: current.conflictMessage,
  };
}

export function warrantySnapshotLabel(item: {
  shopWarrantyEligible?: boolean | null;
  shopWarrantyMonths?: number | null;
  shopWarrantyEndDate?: string | null;
}): string {
  if (item.shopWarrantyEligible == null) return 'Warranty not recorded';
  if (!item.shopWarrantyEligible) return 'No shop warranty';
  const duration = `${item.shopWarrantyMonths} month${item.shopWarrantyMonths === 1 ? '' : 's'}`;
  return item.shopWarrantyEndDate ? `${duration} - expires ${item.shopWarrantyEndDate}` : duration;
}
