import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Package,
  Search,
  Barcode,
  Edit,
  Trash2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { StockStatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';

import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/currency';
import { getStockStatus } from '@/lib/format';

import type { Product, Category } from '@/types';

interface ApiProduct {
  id: number | string;
  sku: string;
  name: string;
  category_id: number | string | null;
  category_name?: string | null;
  price: number | string;
  cost: number | string;
  stock_quantity: number | string;
  low_stock_threshold: number | string;

  image_url?: string | null;
  image_path?: string | null;

  variant_count?: number | string;
  has_variants?: boolean;
}

interface ApiCategory {
  id: number | string;
  name: string;
}

interface ProductView extends Product {
  categoryName?: string;
  variantCount?: number;
  hasVariants?: boolean;

  imageUrl?: string | null;
  imagePath?: string | null;
}

interface ProductForm {
  name: string;
  sku: string;
  categoryId: string;
  price: string;
  cost: string;
  stock: string;
  reorderLevel: string;
}
interface ApiVariant {
  id: number | string;
  product_id: number | string;
  name: string;
  sku: string;
  price: number | string | null;
  cost: number | string | null;
  stock_quantity: number | string;
  low_stock_threshold: number | string;
  is_active?: boolean;
}

interface VariantForm {
  id?: string;
  name: string;
  sku: string;
  price: string;
  cost: string;
  stock: string;
  reorderLevel: string;
  isNew?: boolean;
}

const emptyForm: ProductForm = {
  name: '',
  sku: '',
  categoryId: '',
  price: '',
  cost: '',
  stock: '',
  reorderLevel: '5',
};

function mapProduct(product: ApiProduct): ProductView {
  return {
    id: String(product.id),
    name: product.name,
    sku: product.sku,

    categoryId:
      product.category_id !== null &&
      product.category_id !== undefined
        ? String(product.category_id)
        : '',

    price: Number(product.price ?? 0),
    cost: Number(product.cost ?? 0),
    stock: Number(product.stock_quantity ?? 0),

    reorderLevel: Number(
      product.low_stock_threshold ?? 5
    ),

    barcode: product.sku,

    categoryName:
      product.category_name ?? undefined,

    variantCount:
      Number(product.variant_count ?? 0),

    hasVariants:
      Boolean(product.has_variants) ||
      Number(product.variant_count ?? 0) > 0,
     imageUrl: product.image_url ?? null,
     imagePath: product.image_path ?? null, 
  };
}

function mapCategory(category: ApiCategory): Category {
  return {
    id: String(category.id),
    name: category.name,
    icon: '',
  };
}
function makeSkuPart(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function makeProductSku(name: string) {
  const cleaned = makeSkuPart(name);

  if (!cleaned) return '';

  return cleaned
    .split('-')
    .filter(Boolean)
    .slice(0, 3)
    .join('-');
}

function variantSuffix(value: string) {
  const normalized = value.trim().toLowerCase();

  const known: Record<string, string> = {
    black: 'BLK',
    white: 'WHT',
    pink: 'PNK',
    midnight: 'MID',
    blue: 'BLU',
    red: 'RED',
    green: 'GRN',
    gray: 'GRY',
    grey: 'GRY',
    silver: 'SLV',
    gold: 'GLD',
    purple: 'PPL',
    orange: 'ORG',
    yellow: 'YLW',
    brown: 'BRN',
  };

  return known[normalized] ?? makeSkuPart(value);
}

function makeVariantSku(
  productSku: string,
  variantName: string
) {
  const base = makeSkuPart(productSku);
  const variant = variantSuffix(variantName);

  if (!base || !variant) return '';

  return `${base}-${variant}`;
}

export function ProductsPage() {
  const { toast } = useToast();

  const [products, setProducts] = useState<ProductView[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [addOpen, setAddOpen] = useState(false);

const [editingProduct, setEditingProduct] =
  useState<ProductView | null>(null);

const [barcodeProduct, setBarcodeProduct] =
  useState<
    (ProductView & { barcodeImage?: string }) | null
  >(null);

const [variantBarcode, setVariantBarcode] =
  useState<{
    productName: string;
    variantName: string;
    sku: string;
    price: number;
    barcode: string;
  } | null>(null);

const [form, setForm] =
  useState<ProductForm>(emptyForm);

  const [selectedImage, setSelectedImage] =
  useState<File | null>(null);

  const [imagePreview, setImagePreview] =
  useState<string | null>(null);  

  const [variants, setVariants] =
  useState<VariantForm[]>([]);
  const [expandedProductId, setExpandedProductId] =
  useState<string | null>(null);

const [productVariants, setProductVariants] =
  useState<Record<string, ApiVariant[]>>({});

const [loadingVariants, setLoadingVariants] =
  useState(false);  

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    try {
      const [productData, categoryData] = await Promise.all([
        api.get<ApiProduct[]>('/api/products'),
        api.get<ApiCategory[]>('/api/categories'),
      ]);

      setProducts(productData.map(mapProduct));
      setCategories(categoryData.map(mapCategory));
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to load products.',
        'error'
      );
    } finally {
      setLoading(false);
    }
  }

async function toggleProductVariants(
  product: ProductView
) {
  if (expandedProductId === product.id) {
    setExpandedProductId(null);
    return;
  }

  setExpandedProductId(product.id);

  // Already loaded before
  if (productVariants[product.id]) {
    return;
  }

  try {
    const data = await api.get<ApiVariant[]>(
      `/api/products/${product.id}/variants`
    );

    setProductVariants((current) => ({
      ...current,
      [product.id]: data,
    }));
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to load variants.',
      'error'
    );

    setExpandedProductId(null);
  }
}

  const filtered = useMemo(() => {
    return products.filter((product) => {
      const term = search.trim().toLowerCase();

      const matchSearch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term);

      const matchCategory =
        categoryFilter === 'all' ||
        product.categoryId === categoryFilter;

      const matchStatus =
        statusFilter === 'all' ||
        getStockStatus(product) === statusFilter;

      return (
        matchSearch &&
        matchCategory &&
        matchStatus
      );
    });
  }, [
    products,
    search,
    categoryFilter,
    statusFilter,
  ]);

  function categoryName(product: ProductView) {
    if (product.categoryName) {
      return product.categoryName;
    }

    return (
      categories.find(
        (category) =>
          category.id === product.categoryId
      )?.name ?? '—'
    );
  }

  function updateForm(
    field: keyof ProductForm,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleImageChange(
  event: React.ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

  if (!file) return;

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
  ];

  if (!allowedTypes.includes(file.type)) {
    toast(
      'Only JPG, PNG and WebP images are allowed.',
      'error'
    );
    event.target.value = '';
    return;
  }

  if (file.size > 3 * 1024 * 1024) {
    toast(
      'Product image must be 3 MB or smaller.',
      'error'
    );
    event.target.value = '';
    return;
  }

  if (
    imagePreview &&
    imagePreview.startsWith('blob:')
  ) {
    URL.revokeObjectURL(imagePreview);
  }

  setSelectedImage(file);
  setImagePreview(URL.createObjectURL(file));
}

function removeSelectedImage() {
  if (
    imagePreview &&
    imagePreview.startsWith('blob:')
  ) {
    URL.revokeObjectURL(imagePreview);
  }

  setSelectedImage(null);

  setImagePreview(
    editingProduct?.imageUrl ?? null
  );
}

  function addVariant() {
  setVariants((current) => [
    ...current,
    {
      name: '',
      sku: '',
      price: '',
      cost: '',
      stock: '0',
      reorderLevel: '2',
      isNew: true,
    },
  ]);
}

function updateVariant(
  index: number,
  field: keyof VariantForm,
  value: string
) {
  setVariants((current) =>
    current.map((variant, i) => {
      if (i !== index) return variant;

      const updated = {
        ...variant,
        [field]: value,
      };

      if (field === 'name' && variant.isNew) {
        updated.sku = makeVariantSku(
          form.sku,
          value
        );
      }

      return updated;
    })
  );
}

async function removeVariant(index: number) {
  const variant = variants[index];

  if (!variant) return;

  if (variant.id && editingProduct) {
    const confirmed = window.confirm(
      `Remove variant "${variant.name}"?`
    );

    if (!confirmed) return;

    try {
      await api.delete<{ message: string }>(
        `/api/products/${editingProduct.id}/variants/${variant.id}`
      );

      setVariants((current) =>
        current.filter((_, i) => i !== index)
      );

      toast(
        'Variant removed successfully.',
        'success'
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to remove variant.',
        'error'
      );
    }

    return;
  }

  setVariants((current) =>
    current.filter((_, i) => i !== index)
  );
}


  function openAddProduct() {
  setEditingProduct(null);

  setForm({
    ...emptyForm,
    categoryId: categories[0]?.id ?? '',
  });

  setVariants([]);

  setSelectedImage(null);
  setImagePreview(null);

  setAddOpen(true);
}

async function openEditProduct(
  product: ProductView
) {
  setEditingProduct(product);

  setSelectedImage(null);
  setImagePreview(product.imageUrl ?? null);

  setForm({
    name: product.name,
    sku: product.sku,
    categoryId: product.categoryId,
    price: String(product.price),
    cost: String(product.cost),
    stock: String(product.stock),
    reorderLevel: String(
      product.reorderLevel
    ),
  });

  setVariants([]);
  setAddOpen(true);
  setLoadingVariants(true);

  try {
    const data = await api.get<ApiVariant[]>(
      `/api/products/${product.id}/variants`
    );

    setVariants(
      data.map((variant) => ({
        id: String(variant.id),
        name: variant.name,
        sku: variant.sku,

        price:
          variant.price === null
            ? ''
            : String(variant.price),

        cost:
          variant.cost === null
            ? ''
            : String(variant.cost),

        stock: String(
          variant.stock_quantity ?? 0
        ),

        reorderLevel: String(
          variant.low_stock_threshold ?? 2
        ),

        isNew: false,
      }))
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to load variants.',
      'error'
    );
  } finally {
    setLoadingVariants(false);
  }
}

  function closeProductModal() {
  if (saving) return;

  setAddOpen(false);
  setEditingProduct(null);
  setForm(emptyForm);
  setVariants([]);
  setSelectedImage(null);
setImagePreview(null);
}

  async function saveProduct() {
  if (!form.name.trim()) {
    toast('Product name is required.', 'error');
    return;
  }

  if (!form.sku.trim()) {
    toast('SKU is required.', 'error');
    return;
  }

  const price = Number(form.price);
  const cost = Number(form.cost || 0);
  const stock = Number(form.stock || 0);
  const reorderLevel = Number(form.reorderLevel || 5);

  if (Number.isNaN(price) || price <= 0) {
    toast(
      'Please enter a valid selling price.',
      'error'
    );
    return;
  }

  if (cost < 0 || stock < 0 || reorderLevel < 0) {
    toast(
      'Cost, stock and reorder level cannot be negative.',
      'error'
    );
    return;
  }

  // Validate variants
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];

    if (!variant.name.trim()) {
      toast(
        `Variant ${i + 1}: name is required.`,
        'error'
      );
      return;
    }

    if (!variant.sku.trim()) {
      toast(
        `Variant ${i + 1}: SKU is required.`,
        'error'
      );
      return;
    }

    const variantStock = Number(variant.stock || 0);
    const variantReorder = Number(
      variant.reorderLevel || 2
    );

    if (
      Number.isNaN(variantStock) ||
      variantStock < 0 ||
      Number.isNaN(variantReorder) ||
      variantReorder < 0
    ) {
      toast(
        `Variant ${i + 1}: stock values are invalid.`,
        'error'
      );
      return;
    }

    if (
      variant.price &&
      (Number.isNaN(Number(variant.price)) ||
        Number(variant.price) < 0)
    ) {
      toast(
        `Variant ${i + 1}: price is invalid.`,
        'error'
      );
      return;
    }

    if (
      variant.cost &&
      (Number.isNaN(Number(variant.cost)) ||
        Number(variant.cost) < 0)
    ) {
      toast(
        `Variant ${i + 1}: cost is invalid.`,
        'error'
      );
      return;
    }
  }

  // Make sure variant SKUs are unique in the form
  const skuList = variants.map((variant) =>
    variant.sku.trim().toUpperCase()
  );

  if (new Set(skuList).size !== skuList.length) {
    toast(
      'Each variant must have a unique SKU.',
      'error'
    );
    return;
  }

  setSaving(true);

  try {
    let productId: string;

    if (editingProduct) {
  const productFormData =
    new FormData();

  productFormData.append(
  'sku',
  form.sku
    .trim()
    .toUpperCase()
);    
      

  productFormData.append(
    'name',
    form.name.trim()
  );

  productFormData.append(
    'category_id',
    form.categoryId
  );

  productFormData.append(
    'price',
    String(price)
  );

  productFormData.append(
    'cost',
    String(cost)
  );

  productFormData.append(
    'stock_quantity',
    String(
      variants.length > 0
        ? 0
        : stock
    )
  );

  productFormData.append(
    'low_stock_threshold',
    String(reorderLevel)
  );

  if (selectedImage) {
    productFormData.append(
      'image',
      selectedImage
    );
  }

  await api.put<ApiProduct>(
    `/api/products/${editingProduct.id}`,
    productFormData
  );

  productId = editingProduct.id;
}else {
  const productFormData =
    new FormData();

  productFormData.append(
    'sku',
    form.sku
      .trim()
      .toUpperCase()
  );

  productFormData.append(
    'name',
    form.name.trim()
  );

  productFormData.append(
    'category_id',
    form.categoryId
  );

  productFormData.append(
    'price',
    String(price)
  );

  productFormData.append(
    'cost',
    String(cost)
  );

  productFormData.append(
    'stock_quantity',
    String(
      variants.length > 0
        ? 0
        : stock
    )
  );

  productFormData.append(
    'low_stock_threshold',
    String(reorderLevel)
  );

  if (selectedImage) {
    productFormData.append(
      'image',
      selectedImage
    );
  }

  productFormData.append(
  'variants',
  JSON.stringify(
    variants.map((variant) => ({
      name: variant.name.trim(),
      sku: variant.sku.trim().toUpperCase(),
      price:
        variant.price.trim() === ''
          ? null
          : Number(variant.price),
      cost:
        variant.cost.trim() === ''
          ? null
          : Number(variant.cost),
      stock_quantity: Number(
        variant.stock || 0
      ),
      low_stock_threshold: Number(
        variant.reorderLevel || 2
      ),
    }))
  )
);

  const createdProduct =
    await api.post<ApiProduct>(
      '/api/products',
      productFormData
    );

  productId =
    String(createdProduct.id);
}

    // Save variants
    if (editingProduct) {
  for (const variant of variants) {
      const payload = {
        name: variant.name.trim(),

        sku: variant.sku
          .trim()
          .toUpperCase(),

        price:
          variant.price.trim() === ''
            ? null
            : Number(variant.price),

        cost:
          variant.cost.trim() === ''
            ? null
            : Number(variant.cost),

        stock_quantity: Number(
          variant.stock || 0
        ),

        low_stock_threshold: Number(
          variant.reorderLevel || 2
        ),
      };

      if (variant.id) {
        await api.put<ApiVariant>(
          `/api/products/${productId}/variants/${variant.id}`,
          payload
        );
      } else {
        await api.post<ApiVariant>(
          `/api/products/${productId}/variants`,
          payload
        );
      }
    }
  }

    toast(
      editingProduct
        ? 'Product updated successfully.'
        : 'Product added successfully.',
      'success'
    );

    setAddOpen(false);
    setEditingProduct(null);
    setForm(emptyForm);
    setVariants([]);
    setProductVariants({});
setExpandedProductId(null);
  
    

    await loadData();
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to save product.',
      'error'
    );
  } finally {
    setSaving(false);
  }
}

  async function deleteProduct(
  product: ProductView
) {
  const confirmed = window.confirm(
    `Deactivate "${product.name}"?\n\n` +
      'It will disappear from the POS and product list, but historical sales will remain.'
  );

    if (!confirmed) return;

    try {
      await api.delete<{ message: string }>(
        `/api/products/${product.id}`
      );

      toast(
        'Product removed successfully.',
        'success'
      );

      await loadData();
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to remove product.',
        'error'
      );
    }
  }

async function openVariantBarcode(
  product: ProductView,
  variant: ApiVariant
) {
  try {
    const data = await api.get<{
      id: number | string;
      product_id: number | string;
      product_name: string;
      variant_name: string;
      sku: string;
      price: number | string;
      barcode: string;
    }>(
      `/api/products/${product.id}/variants/${variant.id}/barcode`
    );

    setVariantBarcode({
      productName: data.product_name,
      variantName: data.variant_name,
      sku: data.sku,
      price: Number(data.price ?? product.price),
      barcode: data.barcode,
    });
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to generate variant barcode.',
      'error'
    );
  }
}

  async function openBarcode(product: ProductView) {
  try {
    const data = await api.get<{
      id: number | string;
      sku: string;
      name: string;
      price: number | string;
      barcode: string;
    }>(`/api/products/${product.id}/barcode`);

    setBarcodeProduct({
      ...product,
      barcodeImage: data.barcode,
    });
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to generate barcode.',
      'error'
    );
  }
}

function printBarcodeLabel({
  name,
  sku,
  price,
  barcode,
}: {
  name: string;
  sku: string;
  price: number;
  barcode: string;
}) {
  const printWindow = window.open(
    '',
    '_blank',
    'width=500,height=600'
  );

  if (!printWindow) {
    toast(
      'Unable to open the print window. Please allow pop-ups.',
      'error'
    );
    return;
  }

  const safeName = name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const safeSku = sku
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />

        <title>Barcode - ${safeSku}</title>

        <style>
          @page {
            size: 50mm 30mm;
            margin: 0;
          }

          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            width: 50mm;
            height: 30mm;
            font-family: Arial, sans-serif;
            background: white;
          }

          .label {
            width: 50mm;
            height: 30mm;

            padding: 2mm 3mm;

            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;

            overflow: hidden;
          }

          .barcode {
            display: block;

            width: 40mm;
            height: 12mm;

            object-fit: contain;
          }

          .name {
            width: 100%;

            margin-top: 1mm;

            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;

            text-align: center;
            font-size: 7pt;
            font-weight: 700;
          }

          .details {
            width: 100%;

            margin-top: 0.7mm;

            display: flex;
            align-items: center;
            justify-content: space-between;

            gap: 2mm;

            font-size: 7pt;
          }

          .sku {
            font-family: monospace;
          }

          .price {
            font-weight: 700;
          }
        </style>
      </head>

      <body>
        <div class="label">

          <img
            id="barcode-image"
            class="barcode"
            src="${barcode}"
            alt="${safeSku}"
          />

          <div class="name">
            ${safeName}
          </div>

          <div class="details">
            <span class="sku">${safeSku}</span>

            <span class="price">
              ${formatCurrency(price)}
            </span>
          </div>

        </div>

        <script>
          const image = document.getElementById('barcode-image');

          function startPrint() {
            setTimeout(function () {
              window.focus();
              window.print();
            }, 150);
          }

          if (image.complete) {
            startPrint();
          } else {
            image.onload = startPrint;
          }
        </script>
      </body>
    </html>
  `);

  printWindow.document.close();
}

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        subtitle={`${products.length} products in catalog`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              leftIcon={
                <RefreshCw
                  className={`h-4 w-4 ${
                    loading ? 'animate-spin' : ''
                  }`}
                />
              }
              onClick={loadData}
            >
              Refresh
            </Button>

            <Button
              leftIcon={
                <Plus className="h-4 w-4" />
              }
              onClick={openAddProduct}
            >
              Add Product
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />

          <input
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Search by name or SKU..."
            className="w-full h-10 rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition-colors"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value)
          }
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
        >
          <option value="all">
            All Categories
          </option>

          {categories.map((category) => (
            <option
              key={category.id}
              value={category.id}
            >
              {category.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value)
          }
          className="h-10 rounded-lg border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
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

        <span className="text-sm text-slate-500 ml-auto">
          {filtered.length} result
          {filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Loading */}
      {loading ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 text-slate-500">
            <RefreshCw className="h-6 w-6 animate-spin mb-3" />

            <p className="text-sm font-medium">
              Loading products...
            </p>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <Package className="h-8 w-8" />
            }
            title={
              products.length === 0
                ? 'No products yet'
                : 'No products found'
            }
            description={
              products.length === 0
                ? 'Add your first product to start using the POS.'
                : 'Try adjusting your search or filters.'
            }
            action={
              products.length === 0 ? (
                <Button
                  onClick={openAddProduct}
                  leftIcon={
                    <Plus className="h-4 w-4" />
                  }
                >
                  Add Product
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    setCategoryFilter('all');
                    setStatusFilter('all');
                  }}
                >
                  Clear Filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="relative">
  <div className="mb-2 text-right text-xs font-medium text-slate-400 md:hidden">
    Swipe table to see more →
  </div> 

        <DataTable
          data={filtered}
          rowKey={(product) => product.id}
          minWidth="1000px"
          isRowExpanded={(product) =>
  expandedProductId === product.id
}

renderExpandedRow={(product) => {
  const rows = productVariants[product.id];

  if (!rows) {
    return (
      <div className="flex items-center justify-center py-4 text-sm text-slate-400">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Loading variants...
      </div>
    );
  }

  return (
  <div className="bg-slate-50/70 px-4 py-3">
  <div className="w-full space-y-2">
      {rows.map((variant) => {
        const stock = Number(
          variant.stock_quantity ?? 0
        );

        const lowStock = Number(
          variant.low_stock_threshold ?? 2
        );

        return (
          <div
            key={String(variant.id)}
            className="flex items-center rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            {/* Variant */}
            <div className="flex w-[220px] shrink-0 items-center gap-3 lg:w-auto lg:min-w-[260px] lg:flex-1">
              <div className="h-6 w-6 border-b border-l border-slate-300" />

              <div>
                <p className="text-sm font-semibold capitalize text-slate-800">
                  {variant.name}
                </p>

                <p className="text-xs text-slate-400">
                  Variant
                </p>
              </div>
            </div>

            {/* Stock */}
            <div className="w-[120px] shrink-0 text-center">
              <p className="mb-1 text-[11px] text-slate-400">
                Stock
              </p>

              <span
                className={`inline-flex min-w-9 justify-center rounded-md px-2 py-1 text-xs font-semibold ${
                  stock === 0
                    ? 'bg-danger-50 text-danger-700'
                    : stock <= lowStock
                    ? 'bg-warning-50 text-warning-700'
                    : 'bg-success-50 text-success-700'
                }`}
              >
                {stock}
              </span>
            </div>

            {/* SKU */}
            <div className="w-[220px] shrink-0">
              <p className="mb-1 text-[11px] text-slate-400">
                SKU
              </p>

              <p className="font-mono text-xs font-medium text-slate-700">
                {variant.sku}
              </p>
            </div>

            {/* Barcode */}
            <div className="w-[60px] shrink-0 text-right">
              <button
                type="button"
                onClick={() =>
                  openVariantBarcode(
                    product,
                    variant
                  )
                }
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                title={`Barcode for ${variant.name}`}
              >
                <Barcode className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
}}
         columns={[
  {
    key: 'product',
    header: 'Product',
    width: '260px',
    render: (product) => (
      <div className="flex w-[220px] items-center gap-3">
        {product.hasVariants ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleProductVariants(product);
            }}
            className="
              inline-flex h-7 w-7 shrink-0
              items-center justify-center
              rounded-md
              text-slate-400
              hover:bg-slate-100
              hover:text-slate-700
            "
            title={
              expandedProductId === product.id
                ? 'Hide variants'
                : 'Show variants'
            }
          >
            {expandedProductId === product.id ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <div className="w-7 shrink-0" />
        )}

        {product.imageUrl ? (
          <div className="
            h-11 w-11 shrink-0 overflow-hidden
            rounded-lg border border-slate-200 bg-white
          ">
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-contain p-1"
            />
          </div>
        ) : (
          <div className="
            flex h-11 w-11 shrink-0
            items-center justify-center
            rounded-lg bg-slate-100
            text-slate-400
          ">
            <Package className="h-5 w-5" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p
            className="
              overflow-hidden text-ellipsis whitespace-nowrap
              font-semibold text-slate-900
            "
            title={product.name}
          >
            {product.name}
          </p>

          {product.hasVariants ? (
            <p className="text-xs font-medium text-brand-600">
              {product.variantCount} variant
              {product.variantCount === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="font-mono text-xs text-slate-400">
              {product.sku}
            </p>
          )}
        </div>
      </div>
    ),
  },

  {
    key: 'category',
    header: 'Category',
    width: '180px',
    render: (product) => (
      <div className="w-[180px]">
        <span className="text-sm text-slate-600">
          {categoryName(product)}
        </span>
      </div>
    ),
  },

  {
    key: 'price',
    header: 'Price',
    width: '140px',
    align: 'right',
    render: (product) => (
      <div className="w-[140px] text-right">
        <span className="
          whitespace-nowrap
          font-semibold
          tabular-nums
          text-slate-900
        ">
          {formatCurrency(product.price)}
        </span>
      </div>
    ),
  },

  {
    key: 'stock',
    header: 'Stock',
    width: '90px',
    align: 'center',
    render: (product) => (
      <div className="w-[90px] text-center">
        <span className="
          font-semibold
          tabular-nums
          text-slate-700
        ">
          {product.stock}
        </span>
      </div>
    ),
  },

  {
    key: 'status',
    header: 'Status',
    width: '130px',
    render: (product) => (
      <div className="w-[130px]">
        <StockStatusBadge
          status={getStockStatus(product)}
        />
      </div>
    ),
  },

  {
    key: 'sku',
    header: 'SKU Code',
    width: '150px',
    render: (product) => (
      <div className="w-[150px]">
        <span className="
          whitespace-nowrap
          font-mono
          text-sm
          font-medium
          text-slate-600
        ">
          {product.sku}
        </span>
      </div>
    ),
  },

  {
    key: 'actions',
    header: 'Actions',
    width: '130px',
    align: 'right',
    render: (product) => (
      <div className="
        flex w-[130px]
        items-center justify-end gap-1
      ">
        <button
          type="button"
          onClick={() => openEditProduct(product)}
          className="
            inline-flex h-8 w-8
            items-center justify-center
            rounded-lg
            text-slate-400
            transition-colors
            hover:bg-brand-50
            hover:text-brand-600
          "
          title="Edit product"
        >
          <Edit className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => openBarcode(product)}
          className="
            inline-flex h-8 w-8
            items-center justify-center
            rounded-lg
            text-slate-400
            transition-colors
            hover:bg-slate-100
            hover:text-slate-700
          "
          title="View barcode"
        >
          <Barcode className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => deleteProduct(product)}
          className="
            inline-flex h-8 w-8
            items-center justify-center
            rounded-lg
            text-slate-400
            transition-colors
            hover:bg-danger-50
            hover:text-danger-600
          "
          title="Delete product"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ),
  },
]}
/>
</div>
      )}


      {/* Add / Edit Product */}
      <Modal
        open={addOpen}
        onClose={closeProductModal}
        title={
          editingProduct
            ? 'Edit Product'
            : 'Add New Product'
        }
        description={
          editingProduct
            ? 'Update the product information below.'
            : 'Fill in the product details below.'
        }
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={closeProductModal}
            >
              Cancel
            </Button>

            <Button
              onClick={saveProduct}
              loading={saving}
            >
              {editingProduct
                ? 'Save Changes'
                : 'Save Product'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="mb-5">
  <div className="mb-2">
    <label className="block text-sm font-medium text-slate-700">
      Product Image
    </label>

    <p className="mt-1 text-xs text-slate-400">
      Optional · JPG, PNG or WebP · Max 3 MB
    </p>
  </div>

  {imagePreview ? (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">

      <div className="flex h-52 items-center justify-center bg-white p-4">
        <img
          src={imagePreview}
          alt="Product preview"
          className="h-full w-full object-contain"
        />
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">

        <p className="truncate text-sm font-medium text-slate-700">
          {selectedImage
            ? selectedImage.name
            : 'Current product image'}
        </p>

        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            Change Image

            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageChange}
              className="hidden"
            />
          </label>

          {selectedImage && (
            <button
              type="button"
              onClick={removeSelectedImage}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-danger-600 hover:bg-danger-50"
            >
              Remove
            </button>
          )}
        </div>

      </div>

    </div>
  ) : (
    <label className="flex h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 hover:border-brand-400 hover:bg-brand-50/30">

      <Package className="h-7 w-7 text-slate-400" />

      <p className="mt-3 text-sm font-semibold text-slate-700">
        Upload product image
      </p>

      <p className="mt-1 text-xs text-slate-400">
        Click to browse from your device
      </p>

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleImageChange}
        className="hidden"
      />
    </label>
  )}
</div>
          <Input
            label="Product Name"
            name="name"
            value={form.name}
            onChange={(e) =>
  updateForm('name', e.target.value)
}
            placeholder="e.g. Logitech MX Keys"
          />

          <Input
            label="SKU / Scan Code"
            name="sku"
            value={form.sku}
            onChange={(e) =>
  updateForm('sku', e.target.value)
}
            placeholder="e.g. KB-LGX-001"
            disabled={!!editingProduct}
          />

          <Select
            label="Category"
            name="category"
            value={form.categoryId}
            onChange={(e) =>
              updateForm(
                'categoryId',
                e.target.value
              )
            }
          >
            <option value="">
              No Category
            </option>

            {categories.map(
              (category) => (
                <option
                  key={category.id}
                  value={category.id}
                >
                  {category.name}
                </option>
              )
            )}
          </Select>

          <Input
            label="Selling Price (Ks)"
            name="price"
            type="number"
            min="0"
            value={form.price}
            onChange={(e) =>
              updateForm(
                'price',
                e.target.value
              )
            }
            placeholder="165000"
          />

          <Input
            label="Cost Price (Ks)"
            name="cost"
            type="number"
            min="0"
            value={form.cost}
            onChange={(e) =>
              updateForm(
                'cost',
                e.target.value
              )
            }
            placeholder="121000"
          />

          <Input
            label="Stock Quantity"
            name="stock"
            type="number"
            min="0"
            value={form.stock}
            onChange={(e) =>
              updateForm(
                'stock',
                e.target.value
              )
            }
            placeholder="24"
          />

          {/* Low Stock */}
<Input
  label="Low Stock / Reorder Level"
  name="reorder"
  type="number"
  min="0"
  value={form.reorderLevel}
  onChange={(e) =>
    updateForm('reorderLevel', e.target.value)
  }
  placeholder="5"
/>

{/* Variants */}
<div>
  <div className="flex items-end justify-between mb-2">
    <div>
      <label className="block text-sm font-medium text-slate-700">
        Variants
      </label>

      <p className="text-xs text-slate-400 mt-1">
        Optional
      </p>
    </div>

    <button
      type="button"
      onClick={addVariant}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <Plus className="h-4 w-4" />
      Add
    </button>
  </div>

  {loadingVariants ? (
    <div className="flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
      <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
    </div>
  ) : variants.length === 0 ? (
    <div className="flex h-10 items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3">
      <span className="text-xs text-slate-400">
        No variants
      </span>
    </div>
  ) : (
    <div className="space-y-2">
      {variants.map((variant, index) => (
        <div
          key={variant.id ?? `new-${index}`}
          className="rounded-lg border border-slate-200 bg-slate-50 p-2"
        >
          <div className="grid grid-cols-[1fr_80px_36px] gap-2 items-center">
            <input
              value={variant.name}
              onChange={(e) =>
                updateVariant(
                  index,
                  'name',
                  e.target.value
                )
              }
              placeholder="White"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />

            <input
              type="number"
              min="0"
              value={variant.stock}
              onChange={(e) =>
                updateVariant(
                  index,
                  'stock',
                  e.target.value
                )
              }
              placeholder="Stock"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />

            <button
              type="button"
              onClick={() => removeVariant(index)}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-danger-50 hover:text-danger-600"
              title="Remove variant"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <input
            value={variant.sku}
            onChange={(e) =>
              updateVariant(
                index,
                'sku',
                e.target.value
              )
            }
            placeholder="Variant SKU"
            className="mt-2 h-8 w-full rounded-md border border-slate-300 bg-white px-2 font-mono text-xs text-slate-600 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          </div>
      ))}

      <div className="flex justify-between px-1 text-xs text-slate-500">
        <span>Total stock</span>

        <span className="font-semibold text-slate-700">
          {variants.reduce(
            (sum, variant) =>
              sum + (Number(variant.stock) || 0),
            0
          )}
        </span>
      </div>
    </div>
  )}
</div>
</div>
        <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50/50 px-4 py-3">
          <p className="text-sm font-medium text-brand-800">
            Barcode scanning
          </p>

          <p className="mt-1 text-xs text-brand-700">
            The product SKU is used as its barcode value.
             A Code 128 barcode can be generated and printed
            for scanning at the POS.
          
          </p>
        </div>
      </Modal>

      {/* Barcode Modal */}
{/* Product Barcode Modal */}
<Modal
  open={!!barcodeProduct}
  onClose={() => setBarcodeProduct(null)}
  title="Product Barcode"
  size="sm"
>
  {barcodeProduct && (
    <div className="flex flex-col items-center text-center py-0 sm:py-2">

      {/* Barcode */}
      <div
        className="
          mb-3 w-full
          rounded-xl border border-slate-200 bg-white
          px-3 py-3
          sm:mb-4 sm:p-5
        "
      >
        {barcodeProduct.barcodeImage ? (
          <img
            src={barcodeProduct.barcodeImage}
            alt={`Barcode for ${barcodeProduct.name}`}
            className="
              mx-auto
              h-auto
              max-h-20
              w-full
              max-w-[240px]
              object-contain
              sm:max-h-32
              sm:max-w-none
            "
          />
        ) : (
          <div className="flex h-20 sm:h-24 items-center justify-center text-slate-300">
            <Barcode className="h-12 w-12 sm:h-16 sm:w-16" />
          </div>
        )}
      </div>

      {/* Product Name */}
      <p className="max-w-full text-sm sm:text-base font-bold text-slate-900">
        {barcodeProduct.name}
      </p>

      {/* SKU */}
      <p className="mt-1 font-mono text-xs sm:text-sm text-slate-500">
        {barcodeProduct.sku}
      </p>

      {/* Barcode value - hide on small mobile */}
      <p className="mt-1 hidden text-xs text-slate-400 sm:block">
        Barcode value: {barcodeProduct.sku}
      </p>

      {/* Price */}
      <p className="mt-2 text-base sm:text-lg font-bold text-brand-600 tabular-nums">
        {formatCurrency(barcodeProduct.price)}
      </p>

      {/* Print */}
      <Button
        className="mt-3 sm:mt-5"
        variant="outline"
        disabled={!barcodeProduct.barcodeImage}
        onClick={() => {
          if (!barcodeProduct.barcodeImage) return;

          printBarcodeLabel({
            name: barcodeProduct.name,
            sku: barcodeProduct.sku,
            price: barcodeProduct.price,
            barcode: barcodeProduct.barcodeImage,
          });
        }}
      >
        Print Barcode Label
      </Button>
    </div>
  )}
</Modal>

{/* Variant Barcode Modal */}
<Modal
  open={!!variantBarcode}
  onClose={() => setVariantBarcode(null)}
  title="Variant Barcode"
  size="sm"
>
  {variantBarcode && (
    <div className="flex flex-col items-center text-center py-0 sm:py-2">

      {/* Barcode */}
      <div
        className="
          mb-3 w-full
          rounded-xl border border-slate-200 bg-white
          px-3 py-3
          sm:mb-4 sm:p-5
        "
      >
        <img
          src={variantBarcode.barcode}
          alt={`Barcode for ${variantBarcode.variantName}`}
          className="
            mx-auto
            h-auto
            max-h-20
            w-full
            max-w-[240px]
            object-contain
            sm:max-h-32
            sm:max-w-none
          "
        />
      </div>

      {/* Variant */}
      <p className="text-[11px] sm:text-xs font-medium uppercase tracking-wide text-brand-600">
        {variantBarcode.variantName}
      </p>

      {/* Product */}
      <p className="mt-1 max-w-full text-sm sm:text-base font-bold text-slate-900">
        {variantBarcode.productName}
      </p>

      {/* SKU */}
      <p className="mt-1 sm:mt-2 font-mono text-xs sm:text-sm text-slate-500">
        {variantBarcode.sku}
      </p>

      {/* Price */}
      <p className="mt-2 text-base sm:text-lg font-bold text-brand-600">
        {formatCurrency(variantBarcode.price)}
      </p>

      {/* Print */}
      <Button
        className="mt-3 sm:mt-5"
        variant="outline"
        onClick={() =>
          printBarcodeLabel({
            name: `${variantBarcode.productName} — ${variantBarcode.variantName}`,
            sku: variantBarcode.sku,
            price: variantBarcode.price,
            barcode: variantBarcode.barcode,
          })
        }
      >
        Print Barcode Label
      </Button>

    </div>
  )}
</Modal>
    </div>
  );
}