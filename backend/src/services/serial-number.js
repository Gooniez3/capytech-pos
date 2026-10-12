class SerialNumberError extends Error {
  constructor(message, code = 'INVALID_SERIAL_NUMBER') {
    super(message);
    this.name = 'SerialNumberError';
    this.code = code;
    this.statusCode = 400;
  }
}

// Must stay byte-for-byte equivalent in behavior to the Phase 2B generated
// column: upper(regexp_replace(btrim(value), '[^A-Za-z0-9]', '', 'g')).
function normalizeManufacturerSerial(value) {
  if (typeof value !== 'string') {
    throw new SerialNumberError('Manufacturer serial number must be a string');
  }
  const normalized = value.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!normalized) {
    throw new SerialNumberError(
      'Manufacturer serial number must contain an ASCII letter or digit'
    );
  }
  return normalized;
}

function prepareManufacturerSerial(value) {
  const normalized = normalizeManufacturerSerial(value);
  return Object.freeze({
    original: value,
    normalized,
  });
}

function prepareUniqueSerialBatch(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new SerialNumberError('At least one manufacturer serial number is required');
  }
  const seen = new Set();
  return values.map((value) => {
    const serial = prepareManufacturerSerial(value);
    if (seen.has(serial.normalized)) {
      throw new SerialNumberError(
        `Duplicate normalized manufacturer serial number: ${serial.normalized}`,
        'DUPLICATE_SERIAL_NUMBER'
      );
    }
    seen.add(serial.normalized);
    return serial;
  });
}

module.exports = {
  SerialNumberError,
  normalizeManufacturerSerial,
  prepareManufacturerSerial,
  prepareUniqueSerialBatch,
};
