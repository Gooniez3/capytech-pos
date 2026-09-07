import {
  useEffect,
  useState,
} from 'react';

import type { Product } from '@/types';
import { getStockStatus } from '@/lib/format';
import { formatCurrency } from '@/lib/currency';

import {
  Package,
  Plus,
} from 'lucide-react';

import { StockStatusBadge } from './StatusBadge';

interface ProductCardProps {
  product: Product;
  onAdd: (product: Product) => void;
  disabled?: boolean;
}

export function ProductCard({
  product,
  onAdd,
  disabled,
}: ProductCardProps) {
  const status = getStockStatus(product);
  const outOfStock =
    status === 'out_of_stock';

  const [
    imageFailed,
    setImageFailed,
  ] = useState(false);

  /*
   * If the product image changes later,
   * allow the new image to load again.
   */
  useEffect(() => {
    setImageFailed(false);
  }, [product.image]);

  const hasUsableImage =
    Boolean(product.image) &&
    !imageFailed;

  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      disabled={
        disabled || outOfStock
      }
      className="
        group relative flex h-[270px] w-full flex-col
        rounded-xl border border-slate-200 bg-white p-3 text-left
        shadow-card transition-all duration-150
        hover:border-brand-300 hover:shadow-card-hover
        disabled:cursor-not-allowed disabled:opacity-50
        disabled:hover:border-slate-200 disabled:hover:shadow-card
      "
    >
      {/* Image area */}
      <div
        className="
          relative flex h-[105px] w-full shrink-0
          items-center justify-center overflow-hidden
          rounded-lg bg-slate-100
        "
      >
        {hasUsableImage ? (
          <img
            src={product.image}
            alt=""
            onError={() => {
              setImageFailed(true);
            }}
            className="
              h-full w-full
              object-contain
              scale-[1.12]
              transition-transform duration-200
              group-hover:scale-[1.17]
            "
          />
        ) : (
          <Package
            className="
              h-10 w-10
              text-slate-400
            "
          />
        )}

        <span className="absolute right-1.5 top-1.5">
          <StockStatusBadge
            status={status}
          />
        </span>
      </div>

      {/* Product details */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <h3
          className="
            min-h-[40px] overflow-hidden
            text-sm font-semibold leading-5 text-slate-900
            line-clamp-2
          "
          title={product.name}
        >
          {product.name}
        </h3>

        <p className="mt-1 truncate font-mono text-xs text-slate-400">
          {product.sku}
        </p>

        {/* Bottom */}
        <div className="mt-auto flex items-end justify-between gap-1 pt-3">
          <div className="min-w-0">
            <p className="whitespace-nowrap text-[15px] font-bold text-slate-900 tabular-nums">
              {formatCurrency(
                product.price
              )}
            </p>

            <p className="mt-0.5 text-xs text-slate-500">
              {product.stock} in stock
            </p>
          </div>

          <span
            className="
              flex h-9 w-9 shrink-0 items-center justify-center
              rounded-lg bg-slate-100 text-slate-500
              transition-colors
              group-hover:bg-brand-600 group-hover:text-white
            "
          >
            <Plus className="h-4 w-4" />
          </span>
        </div>
      </div>
    </button>
  );
}