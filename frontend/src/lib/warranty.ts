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

export interface InvoiceWarrantyDisplay {
  duration: string;
  detail: string;
  state: 'covered' | 'none' | 'historical';
}

export function invoiceWarrantyDisplay(
  months: number | null
): InvoiceWarrantyDisplay {
  if (months === null) {
    return {
      duration: 'NOT RECORDED',
      detail: 'Warranty was not recorded for this historical invoice.',
      state: 'historical',
    };
  }

  if (months === 0) {
    return {
      duration: 'NO WARRANTY',
      detail: 'No shop warranty was selected for this invoice.',
      state: 'none',
    };
  }

  if (months === 1 || months === 3 || months === 6 || months === 12) {
    return {
      duration: `${months} ${months === 1 ? 'MONTH' : 'MONTHS'}`,
      detail: 'Valid from the invoice date. Keep this invoice as proof of purchase.',
      state: 'covered',
    };
  }

  return {
    duration: 'NOT RECORDED',
    detail: 'The stored warranty value could not be displayed.',
    state: 'historical',
  };
}
