export function inventoryTarget(product) {
  return {
    product_id: Number(product.product_id ?? product.id),
    variant_id: product.variant_id == null ? null : Number(product.variant_id),
  };
}

export function inventoryTargetKey(product) {
  const target = inventoryTarget(product);
  return `${target.product_id}:${target.variant_id ?? 'base'}`;
}

export function addProductToCart(cart, product) {
  const targetKey = inventoryTargetKey(product);
  const existing = cart.find(item => inventoryTargetKey(item.product) === targetKey);
  if (!existing) return [...cart, { product, quantity: 1 }];

  return cart.map(item =>
    inventoryTargetKey(item.product) === targetKey
      ? { ...item, quantity: item.quantity + 1 }
      : item
  );
}

export function changeCartQuantity(cart, product, delta) {
  const targetKey = inventoryTargetKey(product);
  return cart
    .map(item =>
      inventoryTargetKey(item.product) === targetKey
        ? { ...item, quantity: item.quantity + delta }
        : item
    )
    .filter(item => item.quantity > 0);
}

export function removeCartTarget(cart, product) {
  const targetKey = inventoryTargetKey(product);
  return cart.filter(item => inventoryTargetKey(item.product) !== targetKey);
}

export function cartCheckoutItems(cart) {
  return cart.map(item => {
    const target = inventoryTarget(item.product);
    return {
      product_id: target.product_id,
      ...(target.variant_id === null ? {} : { variant_id: target.variant_id }),
      quantity: item.quantity,
    };
  });
}
