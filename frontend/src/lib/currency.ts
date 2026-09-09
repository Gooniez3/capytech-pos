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

const ALLOWED_TAX_RATES = [0, 5, 10] as const;

export function taxOnNet(
  net: number,
  taxRatePercent: number
): number {
  if (
    net <= 0 ||
    !ALLOWED_TAX_RATES.includes(
      taxRatePercent as (typeof ALLOWED_TAX_RATES)[number]
    )
  ) {
    return 0;
  }

  const netMinor = Math.round(net * 100);
  const rateHundredths = taxRatePercent * 100;
  return Math.round((netMinor * rateHundredths) / 10000) / 100;
}
