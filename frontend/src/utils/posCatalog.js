export function catalogItemKey(product) {
  if (product?.variant_id != null) return `v:${product.variant_id}`;
  return `p:${product?.product_id ?? product?.id}`;
}

export function cartProductFromVariant(parent, variant) {
  const productId = Number(parent.product_id ?? parent.id);
  const variantName = variant.name || variant.variant_name;
  return {
    id: productId,
    product_id: productId,
    variant_id: Number(variant.id ?? variant.variant_id),
    name: variantName ? `${parent.name || parent.product_name} — ${variantName}` : (parent.name || parent.product_name),
    price: variant.effective_price ?? variant.price ?? parent.price,
    stock_quantity: Number(variant.stock_quantity),
    sku: variant.sku || variant.variant_sku,
  };
}

export function cartProductFromLookup(data) {
  if (data?.variant_id != null) {
    return {
      id: Number(data.product_id ?? data.id),
      product_id: Number(data.product_id ?? data.id),
      variant_id: Number(data.variant_id),
      name: data.variant_name ? `${data.name} — ${data.variant_name}` : data.name,
      price: data.price,
      stock_quantity: Number(data.stock_quantity),
      sku: data.variant_sku || data.sku,
    };
  }
  return data;
}

export function productFromSearchRow(row) {
  const productId = Number(row.product_id ?? row.id);
  const variantId = row.variant_id == null || row.variant_id === '' ? null : Number(row.variant_id);
  return {
    id: productId,
    product_id: productId,
    variant_id: variantId,
    name: row.variant_name ? `${row.product_name} — ${row.variant_name}` : (row.product_name || row.name),
    price: row.price,
    stock_quantity: Number(row.stock_quantity),
    sku: row.sku,
    has_variants: row.has_variants,
  };
}

export function filterProducts(products, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return products;
  return products.filter((product) =>
    [product.name, product.sku, product.category_name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle))
  );
}

export function needsVariantSelection(product, knownProducts = []) {
  if (product?.variant_id != null) return false;
  if (product?.has_variants) return true;
  const id = Number(product?.product_id ?? product?.id);
  const known = knownProducts.find((item) => Number(item.id) === id);
  return Boolean(known?.has_variants);
}
