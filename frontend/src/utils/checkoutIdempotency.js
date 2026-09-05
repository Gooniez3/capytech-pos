export function getOrCreateCheckoutKey(
  checkoutKeyRef,
  createUuid = () => crypto.randomUUID()
) {
  if (!checkoutKeyRef.current) {
    checkoutKeyRef.current = createUuid();
  }

  return checkoutKeyRef.current;
}

export function clearCheckoutKey(checkoutKeyRef) {
  checkoutKeyRef.current = null;
}
