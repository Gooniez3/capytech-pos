import type { StockStatus, SaleStatus, Role } from '@/types';
import { stockStatusLabel } from '@/lib/format';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple';

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-success-50 text-success-700 border-success-200',
  warning: 'bg-warning-50 text-warning-700 border-warning-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
  info: 'bg-brand-50 text-brand-700 border-brand-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
};

const dotClasses: Record<BadgeVariant, string> = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-brand-500',
  neutral: 'bg-slate-400',
  purple: 'bg-purple-500',
};

interface StatusBadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ variant, children, dot = false, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${variantClasses[variant]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[variant]}`} />}
      {children}
    </span>
  );
}

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const variant: BadgeVariant = status === 'in_stock' ? 'success' : status === 'low_stock' ? 'warning' : 'danger';
  return (
    <StatusBadge variant={variant} dot>
      {stockStatusLabel(status)}
    </StatusBadge>
  );
}

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  const variant: BadgeVariant = status === 'completed' ? 'success' : status === 'refunded' ? 'warning' : 'danger';
  return (
    <StatusBadge variant={variant} dot>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </StatusBadge>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  const variant: BadgeVariant = role === 'admin' ? 'purple' : role === 'manager' ? 'info' : 'neutral';
  return <StatusBadge variant={variant}>{role.charAt(0).toUpperCase() + role.slice(1)}</StatusBadge>;
}
