type StockUnitBarcodeView = {
  unit_code: string;
  state: string;
  product_id: number | string;
  variant_id: number | string | null;
  active_assignment_id?: number | string | null;
  product_is_active?: boolean;
  variant_is_active?: boolean | null;
  effective_serial_tracking_enabled?: boolean;
};

// Keep this in sync with the persisted CT code format. This module deliberately
// has no runtime imports so the lightweight Node tests can execute it directly.
const STOCK_UNIT_CODE_PATTERN = /^CT\d{6,}$/i;

export interface ParsedPosBarcode {
  code: string;
  kind: 'stock-unit' | 'catalog';
}

export function parsePosBarcode(rawValue: string): ParsedPosBarcode | null {
  const code = rawValue.trim();
  if (!code) return null;
  return {
    code,
    kind: STOCK_UNIT_CODE_PATTERN.test(code) ? 'stock-unit' : 'catalog',
  };
}

export function posBarcodeLookupPath(parsed: ParsedPosBarcode): string {
  return parsed.kind === 'stock-unit'
    ? `/api/stock-units/lookup?code=${encodeURIComponent(parsed.code)}`
    : `/api/products/lookup/${encodeURIComponent(parsed.code)}`;
}

export function stockUnitSaleProblem(unit: StockUnitBarcodeView): string | null {
  if (unit.state !== 'available') {
    return `Physical unit ${unit.unit_code} is ${unit.state} and cannot be sold.`;
  }
  if (unit.active_assignment_id != null) {
    return `Physical unit ${unit.unit_code} is already assigned to a sale.`;
  }
  if (unit.product_is_active === false || (
    unit.variant_id != null && unit.variant_is_active === false
  )) {
    return `The product for physical unit ${unit.unit_code} is inactive.`;
  }
  if (unit.effective_serial_tracking_enabled === false) {
    return `Physical unit ${unit.unit_code} no longer belongs to serialized inventory.`;
  }
  return null;
}

export function stockUnitMatchesCartProduct(
  unit: Pick<StockUnitBarcodeView, 'product_id' | 'variant_id'>,
  product: { id: string; parentProductId?: string; variantId?: string }
): boolean {
  return String(unit.product_id) === String(product.parentProductId ?? product.id)
    && String(unit.variant_id ?? '') === String(product.variantId ?? '');
}
