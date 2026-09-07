import type { ReactNode } from 'react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface BadgeOption {
  label: string;
  value: string;
}

interface FilterBarProps {
  children?: ReactNode;
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
  };
  filters?: Array<{
    label: string;
    value: string;
    options: BadgeOption[];
    onChange: (v: string) => void;
  }>;
}

export function FilterBar({ children, search, filters }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {search && (
        <div className="relative flex-1 min-w-[200px]">
          <input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            className="w-full h-10 rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
      )}
      {filters?.map((f) => (
        <FilterSelect key={f.label} label={f.label} value={f.value} options={f.options} onChange={f.onChange} />
      ))}
      {children && <div className="flex items-center gap-2 ml-auto">{children}</div>}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: BadgeOption[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-2 h-10 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span className="text-slate-400">{label}:</span>
        <span className="text-slate-900">{selected?.label ?? 'All'}</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-lg border border-slate-200 bg-white shadow-pop py-1 z-20 animate-fade-in">
          {options.map((opt) => (
            <button
              key={opt.value}
              onMouseDown={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                opt.value === value ? 'text-brand-600 font-semibold bg-brand-50/50' : 'text-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
