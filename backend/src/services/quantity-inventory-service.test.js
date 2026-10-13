const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MOVEMENT_TYPES,
  QuantityInventoryError,
  normalizeMovements,
  receiveQuantityInventory,
} = require('./quantity-inventory-service');

test('quantity movement validation accepts signed adjustments and rejects invalid batches', () => {
  assert.deepEqual(MOVEMENT_TYPES, [
    'opening', 'received', 'adjusted', 'sold', 'refunded', 'voided',
  ]);
  assert.deepEqual(normalizeMovements([{
    productId: '7', variantId: null, movementType: 'adjusted', quantityChange: -2,
    reason: '  cycle count  ', sourceReference: ' count-1 ',
  }]), [{
    productId: 7, variantId: null, movementType: 'adjusted', quantityChange: -2,
    reason: 'cycle count', sourceReference: 'count-1', key: '7:0',
  }]);
  assert.throws(() => normalizeMovements([]), QuantityInventoryError);
  assert.throws(() => normalizeMovements([
    { productId: 1, movementType: 'received', quantityChange: 1 },
    { productId: 1, movementType: 'received', quantityChange: 1 },
  ]), /Duplicate inventory target/);
  assert.throws(() => normalizeMovements([
    { productId: 1, movementType: 'received', quantityChange: -1 },
  ]), /must be positive/);
  assert.throws(() => normalizeMovements([
    { productId: 1, movementType: 'sold', quantityChange: 1 },
  ]), /must be negative/);
});

test('receiving validates its public input before touching a transaction', () => {
  assert.throws(
    () => receiveQuantityInventory({}, {}),
    /At least one receiving movement is required/
  );
});
