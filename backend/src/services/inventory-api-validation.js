class InventoryApiError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_REQUEST') {
    super(message);
    this.name = 'InventoryApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requirePlainObject(value, field = 'request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InventoryApiError(`${field} must be an object`);
  }
  return value;
}

function rejectUnknownFields(value, allowed, field = 'request body') {
  const object = requirePlainObject(value, field);
  const unexpected = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new InventoryApiError(`Unknown ${field} field: ${unexpected[0]}`);
  }
  return object;
}

function positiveInteger(value, field) {
  const text = String(value ?? '');
  if (!/^[1-9]\d*$/.test(text)) {
    throw new InventoryApiError(`${field} must be a positive integer`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new InventoryApiError(`${field} is too large`);
  }
  return parsed;
}

function optionalPositiveInteger(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, field);
}

function boundedInteger(value, field, { minimum, maximum, defaultValue }) {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InventoryApiError(`${field} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function nonemptyText(value, field, maximum = 500) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InventoryApiError(`${field} is required`);
  }
  if (value.length > maximum) {
    throw new InventoryApiError(`${field} is too long`);
  }
  return value;
}

function optionalText(value, field, maximum = 500) {
  if (value === null || value === undefined || value === '') return null;
  return nonemptyText(value, field, maximum).trim();
}

module.exports = {
  InventoryApiError,
  boundedInteger,
  nonemptyText,
  optionalPositiveInteger,
  optionalText,
  positiveInteger,
  rejectUnknownFields,
  requirePlainObject,
};
