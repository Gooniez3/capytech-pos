export const WARRANTY_OPTIONS = [0, 1, 3, 6, 12] as const;

export type WarrantyMonths = (typeof WARRANTY_OPTIONS)[number];

export function suggestWarrantyMonths(total: number): WarrantyMonths {
  if (total >= 10_000 && total <= 50_000) return 1;
  if (total > 50_000 && total <= 100_000) return 3;
  if (total > 100_000 && total <= 200_000) return 6;
  if (total > 200_000 && total <= 400_000) return 12;
  return 0;
}

export function warrantyLabel(months: number | null): string {
  if (months === null) return 'Warranty not recorded';
  if (months === 0) return 'No warranty';
  return `${months} month${months === 1 ? '' : 's'}`;
}
