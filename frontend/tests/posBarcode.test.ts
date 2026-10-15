import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePosBarcode,
  posBarcodeLookupPath,
  stockUnitMatchesCartProduct,
  stockUnitSaleProblem,
} from '../src/lib/posBarcode.ts';
import type { StockUnitSummary } from '../src/lib/serializedInventory.ts';

function unit(overrides: Partial<StockUnitSummary> = {}): StockUnitSummary {
  return {
    id: 3,
    internal_sku: 'SU-3',
    unit_code: 'CT000003',
    manufacturer_serial_number: 'MSS12ProBk260800851',
    product_id: 12,
    variant_id: 44,
    product_name: 'Aula S12 pro 1000hz',
    product_sku: 'AULA-S12',
    variant_name: 'White',
    variant_sku: 'AULA-S12-WHITE',
    state: 'available',
    product_is_active: true,
    variant_is_active: true,
    effective_serial_tracking_enabled: true,
    active_assignment_id: null,
    ...overrides,
  };
}

test('manual CT000003 entry routes to the stock-unit API, never product lookup', () => {
  const parsed = parsePosBarcode('CT000003');
  assert.deepEqual(parsed, { code: 'CT000003', kind: 'stock-unit' });
  assert.equal(posBarcodeLookupPath(parsed!), '/api/stock-units/lookup?code=CT000003');
});

test('keyboard-wedge and camera CT input share trimming and stock-unit routing', () => {
  for (const input of ['CT000003\r\n', ' ct000003 ', '\tCT000003\r']) {
    const parsed = parsePosBarcode(input);
    assert.equal(parsed?.kind, 'stock-unit');
    assert.equal(posBarcodeLookupPath(parsed!), `/api/stock-units/lookup?code=${encodeURIComponent(parsed!.code)}`);
  }
});

test('existing CP product barcode routing is unchanged', () => {
  const parsed = parsePosBarcode('CP000123');
  assert.deepEqual(parsed, { code: 'CP000123', kind: 'catalog' });
  assert.equal(posBarcodeLookupPath(parsed!), '/api/products/lookup/CP000123');
});

test('CT lookup resolves the exact product and variant cart target', () => {
  const white = unit();
  assert.equal(stockUnitMatchesCartProduct(white, {
    id: '12-variant-44', parentProductId: '12', variantId: '44',
  }), true);
  assert.equal(stockUnitMatchesCartProduct(white, {
    id: '12-variant-45', parentProductId: '12', variantId: '45',
  }), false);
  assert.equal(stockUnitMatchesCartProduct(white, { id: '12' }), false);
});

test('only active, available, unassigned serialized units are eligible', () => {
  assert.equal(stockUnitSaleProblem(unit()), null);
  assert.match(stockUnitSaleProblem(unit({ state: 'sold' }))!, /sold/);
  assert.match(stockUnitSaleProblem(unit({ state: 'retired' }))!, /retired/);
  assert.match(stockUnitSaleProblem(unit({ state: 'quarantined' }))!, /quarantined/);
  assert.match(stockUnitSaleProblem(unit({ active_assignment_id: 91 }))!, /assigned/);
  assert.match(stockUnitSaleProblem(unit({ product_is_active: false }))!, /inactive/);
  assert.match(stockUnitSaleProblem(unit({ variant_is_active: false }))!, /inactive/);
  assert.match(stockUnitSaleProblem(unit({ effective_serial_tracking_enabled: false }))!, /serialized inventory/);
});
