const { ALLOWED_SHOP_WARRANTY_MONTHS } = require('./stock-unit-policy');
const { normalizeManufacturerSerial } = require('./serial-number');

class ShopWarrantyPeriodError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShopWarrantyPeriodError';
    this.statusCode = 400;
  }
}

function parseDateOnly(value, field = 'date') {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ShopWarrantyPeriodError(`${field} is invalid`);
    return new Date(Date.UTC(
      value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()
    ));
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ShopWarrantyPeriodError(`${field} must use YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new ShopWarrantyPeriodError(`${field} is invalid`);
  }
  return parsed;
}

function formatDateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function warrantyCoverageDates(purchaseDate, months) {
  const duration = Number(months);
  if (!Number.isInteger(duration) || !ALLOWED_SHOP_WARRANTY_MONTHS.includes(duration)) {
    throw new ShopWarrantyPeriodError('Shop warranty duration must be 1, 3, 6, or 12 months');
  }
  const start = parseDateOnly(purchaseDate, 'purchase date');
  const sourceDay = start.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth() + duration, 1
  ));
  const daysInTargetMonth = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0
  )).getUTCDate();

  // When the same day does not exist (for example Jan 31 or Feb 29), the
  // anniversary boundary is the first day after the target month. Coverage
  // therefore includes the target month's final calendar day.
  const anniversaryBoundary = sourceDay <= daysInTargetMonth
    ? new Date(Date.UTC(
      targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), sourceDay
    ))
    : new Date(Date.UTC(
      targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 1
    ));
  const end = new Date(anniversaryBoundary.getTime() - 86_400_000);

  return Object.freeze({
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    months: duration,
  });
}

function buildShopWarrantySnapshot(policy, purchaseDate) {
  if (!policy || policy.shopWarrantyEligible !== true) {
    return Object.freeze({
      shopWarrantyEligible: false,
      shopWarrantyMonths: null,
      shopWarrantyStartDate: null,
      shopWarrantyEndDate: null,
    });
  }
  const coverage = warrantyCoverageDates(purchaseDate, policy.shopWarrantyMonths);
  return Object.freeze({
    shopWarrantyEligible: true,
    shopWarrantyMonths: coverage.months,
    shopWarrantyStartDate: coverage.startDate,
    shopWarrantyEndDate: coverage.endDate,
  });
}

function evaluateStoredWarrantySnapshot(snapshot, asOfDate) {
  if (!snapshot || snapshot.shop_warranty_eligible == null) {
    return Object.freeze({ status: 'not_recorded', active: null });
  }
  if (snapshot.shop_warranty_eligible !== true) {
    return Object.freeze({ status: 'no_warranty', active: false });
  }
  const start = formatDateOnly(parseDateOnly(snapshot.shop_warranty_start_date, 'warranty start date'));
  const end = formatDateOnly(parseDateOnly(snapshot.shop_warranty_end_date, 'warranty end date'));
  const current = formatDateOnly(parseDateOnly(asOfDate, 'lookup date'));
  const active = current >= start && current <= end;
  return Object.freeze({
    status: active ? 'active' : current < start ? 'not_started' : 'expired',
    active,
    months: Number(snapshot.shop_warranty_months),
    startDate: start,
    endDate: end,
  });
}

async function lookupStoredWarrantyBySerial(queryable, serialNumber, { asOfDate } = {}) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new TypeError('A PostgreSQL client or pool is required');
  }
  const normalized = normalizeManufacturerSerial(serialNumber);
  const result = await queryable.query(
    `
      SELECT
        su.id AS stock_unit_id,
        su.internal_sku,
        su.manufacturer_serial_number,
        su.normalized_serial_number,
        su.state AS stock_unit_state,
        sis.internal_sku_snapshot,
        sis.manufacturer_serial_number_snapshot,
        sis.assigned_at,
        sis.released_at,
        si.id AS sale_item_id,
        si.product_name,
        si.variant_name,
        si.shop_warranty_eligible,
        si.shop_warranty_months,
        si.shop_warranty_start_date::text AS shop_warranty_start_date,
        si.shop_warranty_end_date::text AS shop_warranty_end_date,
        si.product_sku_snapshot,
        si.variant_sku_snapshot,
        s.id AS sale_id,
        s.invoice_number,
        s.created_at AS purchase_timestamp
      FROM stock_units su
      LEFT JOIN sale_item_stock_units sis ON sis.stock_unit_id = su.id
      LEFT JOIN sale_items si ON si.id = sis.sale_item_id
      LEFT JOIN sales s ON s.id = si.sale_id
      WHERE su.normalized_serial_number = $1
      ORDER BY sis.assigned_at DESC NULLS LAST, sis.id DESC NULLS LAST
    `,
    [normalized]
  );

  return result.rows.map((row) => ({
    ...row,
    warranty: evaluateStoredWarrantySnapshot(
      row,
      asOfDate || new Date().toISOString().slice(0, 10)
    ),
  }));
}

module.exports = {
  ShopWarrantyPeriodError,
  buildShopWarrantySnapshot,
  evaluateStoredWarrantySnapshot,
  lookupStoredWarrantyBySerial,
  parseDateOnly,
  warrantyCoverageDates,
};
