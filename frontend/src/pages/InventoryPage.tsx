import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Boxes,
  AlertTriangle,
  PackageX,
  DollarSign,
  Search,
  ArrowUpDown,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { DataTable } from '@/components/ui/DataTable';
import { StockStatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';

import { api } from '@/lib/api';
import type { Product } from '@/types';

import { formatCurrency } from '@/lib/currency';
import {
  getStockStatus,
  inventoryValue,
} from '@/lib/format';

/* =========================================================
   API TYPES
   ========================================================= */

interface ApiProduct {
  id: number | string;

  sku: string;
  product_code: string;
  name: string;

  category_id:
    | number
    | string
    | null;

  category_name:
    | string
    | null;

  price:
    | number
    | string;

  cost:
    | number
    | string;

  stock_quantity:
    | number
    | string;

  low_stock_threshold:
    | number
    | string;

  has_variants?: boolean;

  variant_count?:
    | number
    | string;
}

/* =========================================================
   INVENTORY PRODUCT TYPE
   ========================================================= */

type InventoryProduct =
  Product & {
    categoryName?: string;

    hasVariants?: boolean;

    variantCount?: number;
  };

/* =========================================================
   INVENTORY PAGE
   ========================================================= */

export function InventoryPage() {
  /* =========================================================
     DATA
     ========================================================= */

  const [
    products,
    setProducts,
  ] = useState<
    InventoryProduct[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  /* =========================================================
     FILTERS
     ========================================================= */

  const [
    search,
    setSearch,
  ] = useState('');

  const [
    categoryFilter,
    setCategoryFilter,
  ] = useState('all');

  const [
    statusFilter,
    setStatusFilter,
  ] = useState('all');

  /* =========================================================
     SORT
     ========================================================= */

  const [
    sortKey,
    setSortKey,
  ] = useState<
    | 'name'
    | 'stock'
    | 'cost'
    | 'price'
    | 'profit'
    | 'value'
  >('name');

  const [
    sortDir,
    setSortDir,
  ] = useState<
    'asc' | 'desc'
  >('asc');

  /* =========================================================
     LOAD INVENTORY
     ========================================================= */

  useEffect(() => {
    loadInventory();
  }, []);

  async function loadInventory() {
    setLoading(true);

    try {
      const data =
        await api.get<
          ApiProduct[]
        >(
          '/api/products'
        );

      const mappedProducts:
        InventoryProduct[] =
        data.map(
          (item) => ({
            id:
              String(
                item.id
              ),

            name:
              item.name,

            sku:
              item.product_code || item.sku,

            categoryId:
              item.category_id !==
                null &&
              item.category_id !==
                undefined
                ? String(
                    item.category_id
                  )
                : '',

            categoryName:
              item.category_name ??
              '—',

            price:
              Number(
                item.price ?? 0
              ),

            cost:
              Number(
                item.cost ?? 0
              ),

            stock:
              Number(
                item.stock_quantity ??
                  0
              ),

            reorderLevel:
              Number(
                item.low_stock_threshold ??
                  5
              ),

            barcode:
              item.product_code || item.sku,

            image: '',

            hasVariants:
              Boolean(
                item.has_variants
              ),

            variantCount:
              Number(
                item.variant_count ??
                  0
              ),
          })
        );

      setProducts(
        mappedProducts
      );
    } catch (error) {
      console.error(
        'Failed to load inventory:',
        error
      );
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     CATEGORY OPTIONS
     ========================================================= */

  const categoryOptions =
    useMemo(() => {
      return Array.from(
        new Set(
          products
            .map(
              (product) =>
                product.categoryName
            )
            .filter(
              (
                name
              ): name is string =>
                Boolean(
                  name &&
                    name !== '—'
                )
            )
        )
      ).sort();
    }, [products]);

  /* =========================================================
     INVENTORY STATS
     ========================================================= */

  const stats =
    useMemo(() => {
      const total =
        products.length;

      const lowStock =
        products.filter(
          (product) =>
            getStockStatus(
              product
            ) ===
            'low_stock'
        ).length;

      const outOfStock =
        products.filter(
          (product) =>
            getStockStatus(
              product
            ) ===
            'out_of_stock'
        ).length;

      const value =
        inventoryValue(
          products
        );

      return {
        total,
        lowStock,
        outOfStock,
        value,
      };
    }, [products]);

  /* =========================================================
     FILTER + SORT
     ========================================================= */

  const filtered =
    useMemo(() => {
      const term =
        search
          .trim()
          .toLowerCase();

      const result =
        products.filter(
          (product) => {
            const matchesSearch =
              !term ||
              product.name
                .toLowerCase()
                .includes(
                  term
                ) ||
              product.sku
                .toLowerCase()
                .includes(
                  term
                );

            const matchesCategory =
              categoryFilter ===
                'all' ||
              product.categoryName ===
                categoryFilter;

            const matchesStatus =
              statusFilter ===
                'all' ||
              getStockStatus(
                product
              ) ===
                statusFilter;

            return (
              matchesSearch &&
              matchesCategory &&
              matchesStatus
            );
          }
        );

      result.sort(
        (a, b) => {
          let cmp = 0;

          if (
            sortKey ===
            'name'
          ) {
            cmp =
              a.name.localeCompare(
                b.name
              );
          }

          else if (
            sortKey ===
            'stock'
          ) {
            cmp =
              a.stock -
              b.stock;
          }

          else if (
            sortKey ===
            'cost'
          ) {
            cmp =
              a.cost -
              b.cost;
          }

          else if (
            sortKey ===
            'price'
          ) {
            cmp =
              a.price -
              b.price;
          }

          else if (
            sortKey ===
            'profit'
          ) {
            cmp =
              (a.price -
                a.cost) -
              (b.price -
                b.cost);
          }

          else {
            cmp =
              a.cost *
                a.stock -
              b.cost *
                b.stock;
          }

          return sortDir ===
            'asc'
            ? cmp
            : -cmp;
        }
      );

      return result;
    }, [
      products,
      search,
      categoryFilter,
      statusFilter,
      sortKey,
      sortDir,
    ]);

  /* =========================================================
     SORT HANDLER
     ========================================================= */

  function toggleSort(
    key:
      | 'name'
      | 'stock'
      | 'cost'
      | 'price'
      | 'profit'
      | 'value'
  ) {
    if (sortKey === key) {
      setSortDir(
        (current) =>
          current ===
          'asc'
            ? 'desc'
            : 'asc'
      );

      return;
    }

    setSortKey(key);
    setSortDir('asc');
  }

  /* =========================================================
     UI
     ========================================================= */

  return (
    <div className="space-y-6">

      <PageHeader
        title="Inventory"
        subtitle="Track real stock levels, costs, pricing, and inventory value."
      />

      {/* =====================================================
          SUMMARY CARDS
          ===================================================== */}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">

        <StatCard
          label="Total Products"
          value={String(
            stats.total
          )}
          icon={
            <Boxes className="h-5 w-5" />
          }
          accent="brand"
        />

        <StatCard
          label="Low Stock"
          value={String(
            stats.lowStock
          )}
          icon={
            <AlertTriangle className="h-5 w-5" />
          }
          accent="warning"
        />

        <StatCard
          label="Out of Stock"
          value={String(
            stats.outOfStock
          )}
          icon={
            <PackageX className="h-5 w-5" />
          }
          accent="danger"
        />

        <StatCard
          label="Inventory Value"
          value={formatCurrency(
            stats.value
          )}
          icon={
            <DollarSign className="h-5 w-5" />
          }
          accent="success"
        />

      </div>

      {/* =====================================================
          SEARCH + FILTERS
          ===================================================== */}

      <div className="flex flex-wrap items-center gap-3">

        <div className="relative min-w-[260px] flex-1">

          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

          <input
            value={search}
            onChange={(
              event
            ) =>
              setSearch(
                event.target
                  .value
              )
            }
            placeholder="Search by name or SKU..."
            className="
              h-10 w-full
              rounded-lg
              border border-slate-300
              bg-white
              pl-10 pr-3
              text-sm text-slate-900
              placeholder:text-slate-400
              transition-colors
              focus:border-brand-500
              focus:outline-none
              focus:ring-2
              focus:ring-brand-500/30
            "
          />

        </div>

        <select
          value={
            categoryFilter
          }
          onChange={(
            event
          ) =>
            setCategoryFilter(
              event.target
                .value
            )
          }
          className="
            h-10
            min-w-[180px]
            rounded-lg
            border border-slate-300
            bg-white
            px-3 pr-8
            text-sm text-slate-700
            focus:border-brand-500
            focus:outline-none
            focus:ring-2
            focus:ring-brand-500/30
          "
        >
          <option value="all">
            All Categories
          </option>

          {categoryOptions.map(
            (
              category
            ) => (
              <option
                key={
                  category
                }
                value={
                  category
                }
              >
                {
                  category
                }
              </option>
            )
          )}

        </select>

        <select
          value={
            statusFilter
          }
          onChange={(
            event
          ) =>
            setStatusFilter(
              event.target
                .value
            )
          }
          className="
            h-10
            min-w-[160px]
            rounded-lg
            border border-slate-300
            bg-white
            px-3 pr-8
            text-sm text-slate-700
            focus:border-brand-500
            focus:outline-none
            focus:ring-2
            focus:ring-brand-500/30
          "
        >
          <option value="all">
            All Status
          </option>

          <option value="in_stock">
            In Stock
          </option>

          <option value="low_stock">
            Low Stock
          </option>

          <option value="out_of_stock">
            Out of Stock
          </option>

        </select>

        <span className="whitespace-nowrap text-sm text-slate-500">
          {filtered.length}{' '}
          {filtered.length ===
          1
            ? 'result'
            : 'results'}
        </span>

      </div>

      {/* =====================================================
          TABLE
          ===================================================== */}

      {loading ? (

        <Card>
          <div className="flex items-center justify-center py-16 text-slate-400">
            <p className="text-sm font-medium">
              Loading inventory...
            </p>
          </div>
        </Card>

      ) : filtered.length ===
        0 ? (

        <Card>
          <EmptyState
            icon={
              <Boxes className="h-8 w-8" />
            }
            title="No inventory items found"
            description="Try a different search or filter."
          />
        </Card>

      ) : (

        <DataTable
          data={filtered}
          rowKey={(
            product
          ) =>
            product.id
          }
          minWidth="1250px"
          columns={[
            /* =================================================
               PRODUCT
               ================================================= */

            {
              key:
                'product',

              header:
                'Product',

              render:
                (
                  product
                ) => (
                  <div className="min-w-0">

                    <div className="flex items-center gap-2">

                      <p className="truncate font-semibold text-slate-900">
                        {
                          product.name
                        }
                      </p>

                      {product.hasVariants && (
                        <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-600">
                          {
                            product.variantCount
                          }{' '}
                          variant
                          {product.variantCount ===
                          1
                            ? ''
                            : 's'}
                        </span>
                      )}

                    </div>

                    <p className="mt-0.5 font-mono text-xs text-slate-400">
                      {
                        product.sku
                      }
                    </p>

                  </div>
                ),
            },

            /* =================================================
               CATEGORY
               ================================================= */

            {
              key:
                'category',

              header:
                'Category',

              render:
                (
                  product
                ) => (
                  <span className="text-sm text-slate-600">
                    {
                      product.categoryName ??
                      '—'
                    }
                  </span>
                ),
            },

            /* =================================================
               STOCK
               ================================================= */

            {
              key:
                'stock',

              header:
                'In Stock',

              align:
                'center',

              render:
                (
                  product
                ) => (
                  <button
                    type="button"
                    onClick={() =>
                      toggleSort(
                        'stock'
                      )
                    }
                    className="inline-flex items-center gap-1 font-semibold text-slate-700 tabular-nums transition-colors hover:text-brand-600"
                  >
                    {
                      product.stock
                    }

                    <ArrowUpDown className="h-3 w-3 text-slate-400" />
                  </button>
                ),
            },

            /* =================================================
               REORDER
               ================================================= */

            {
              key:
                'reorder',

              header:
                'Reorder At',

              align:
                'center',

              render:
                (
                  product
                ) => (
                  <span className="text-sm text-slate-500 tabular-nums">
                    {
                      product.reorderLevel
                    }
                  </span>
                ),
            },

            /* =================================================
               STATUS
               ================================================= */

            {
              key:
                'status',

              header:
                'Status',

              render:
                (
                  product
                ) => (
                  <StockStatusBadge
                    status={getStockStatus(
                      product
                    )}
                  />
                ),
            },

            /* =================================================
               UNIT COST
               ================================================= */

            {
              key:
                'unitcost',

              header:
                'Unit Cost',

              align:
                'right',

              render:
                (
                  product
                ) => (
                  <button
                    type="button"
                    onClick={() =>
                      toggleSort(
                        'cost'
                      )
                    }
                    className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 tabular-nums transition-colors hover:text-brand-600"
                  >
                    {formatCurrency(
                      product.cost
                    )}

                    <ArrowUpDown className="h-3 w-3 text-slate-400" />
                  </button>
                ),
            },

            /* =================================================
               SELLING PRICE
               ================================================= */

            {
              key:
                'sellingprice',

              header:
                'Selling Price',

              align:
                'right',

              render:
                (
                  product
                ) => (
                  <button
                    type="button"
                    onClick={() =>
                      toggleSort(
                        'price'
                      )
                    }
                    className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 tabular-nums transition-colors hover:text-brand-600"
                  >
                    {formatCurrency(
                      product.price
                    )}

                    <ArrowUpDown className="h-3 w-3 text-slate-400" />
                  </button>
                ),
            },

            /* =================================================
               PROFIT PER UNIT
               ================================================= */

            {
              key:
                'profit',

              header:
                'Profit / Unit',

              align:
                'right',

              render:
                (
                  product
                ) => {
                  const profit =
                    product.price -
                    product.cost;

                  return (
                    <button
                      type="button"
                      onClick={() =>
                        toggleSort(
                          'profit'
                        )
                      }
                      className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums transition-colors hover:text-brand-600 ${
                        profit > 0
                          ? 'text-success-600'
                          : profit < 0
                          ? 'text-danger-600'
                          : 'text-slate-500'
                      }`}
                    >
                      {formatCurrency(
                        profit
                      )}

                      <ArrowUpDown className="h-3 w-3 text-slate-400" />
                    </button>
                  );
                },
            },

            /* =================================================
               STOCK VALUE
               ================================================= */

            {
              key:
                'value',

              header:
                'Stock Value',

              align:
                'right',

              render:
                (
                  product
                ) => (
                  <button
                    type="button"
                    onClick={() =>
                      toggleSort(
                        'value'
                      )
                    }
                    className="inline-flex items-center gap-1 font-bold text-slate-900 tabular-nums transition-colors hover:text-brand-600"
                  >
                    {formatCurrency(
                      product.cost *
                        product.stock
                    )}

                    <ArrowUpDown className="h-3 w-3 text-slate-400" />
                  </button>
                ),
            },
          ]}
        />
      )}

    </div>
  );
}
