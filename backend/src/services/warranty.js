const WARRANTY_OPTIONS = Object.freeze([0, 1, 3, 6, 12]);

function suggestWarrantyMonths(totalMinorUnits) {
  if (!Number.isSafeInteger(totalMinorUnits) || totalMinorUnits < 0) {
    throw new TypeError('Invoice total must be a nonnegative integer');
  }

  if (totalMinorUnits >= 1_000_000 && totalMinorUnits <= 5_000_000) {
    return 1;
  }
  if (totalMinorUnits > 5_000_000 && totalMinorUnits <= 10_000_000) {
    return 3;
  }
  if (totalMinorUnits > 10_000_000 && totalMinorUnits <= 20_000_000) {
    return 6;
  }
  if (totalMinorUnits > 20_000_000 && totalMinorUnits <= 40_000_000) {
    return 12;
  }

  return 0;
}

function normalizeWarrantySelection(value, { allowAutomatic = false } = {}) {
  if ((value === undefined || value === null) && allowAutomatic) {
    return null;
  }

  const normalized =
    typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : value;

  if (!Number.isInteger(normalized) || !WARRANTY_OPTIONS.includes(normalized)) {
    const error = new Error('Warranty must be none, 1, 3, 6, or 12 months');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

module.exports = {
  WARRANTY_OPTIONS,
  normalizeWarrantySelection,
  suggestWarrantyMonths,
};
