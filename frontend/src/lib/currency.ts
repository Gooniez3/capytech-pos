const Ks = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return `${Ks.format(Math.round(value))} Ks`;
}

export function formatNumber(value: number): string {
  return Ks.format(Math.round(value));
}

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Ks.format(Math.round(value));
}

export function parseCurrencyInput(text: string): number {
  const cleaned = text.replace(/[^\d]/g, '');
  return cleaned ? parseInt(cleaned, 10) : 0;
}
