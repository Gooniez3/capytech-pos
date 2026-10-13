import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Package,
  Search,
  Barcode,
  Edit,
  Trash2,
  RefreshCw,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  PackagePlus,
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
  serial_tracking_enabled?: boolean;
  effective_serial_tracking_enabled?: boolean;
}

interface ApiCategory {
  id: number | string;
  name: string;
}

interface ProductImageStatus {
  image_url?: string | null;
  image_path?: string | null;
  has_trashed_image?: boolean;
  trashed_image_url?: string | null;
  message?: string;
}

interface ApiDeletedProduct {
  id: number | string;
  sku: string;
  name: string;
  category_name?: string | null;
  deleted_at?: string | null;
  deleted_by_username?: string | null;
  variant_count?: number | string;
  is_legacy_deleted?: boolean;
}

function formatDeletedAt(value?: string | null) {
  if (!value) return 'Unknown date';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface ProductView extends Product {
  categoryName?: string;
  variantCount?: number;
  hasVariants?: boolean;

  imageUrl?: string | null;
  imagePath?: string | null;
  serialTrackingEnabled: boolean;
}

interface ProductForm {
  name: string;
  sku: string;
  categoryId: string;
  price: string;
  cost: string;
  stock: string;
  reorderLevel: string;
  serialTrackingEnabled: boolean;
  serialNumbers: string;
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
  serial_tracking_enabled?: boolean | null;
  effective_serial_tracking_enabled?: boolean;
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
  serialSetting: 'inherit' | 'on' | 'off';
  serialNumbers: string;
}

const emptyForm: ProductForm = {
  name: '',
  sku: '',
  categoryId: '',
  price: '',
  cost: '',
  stock: '',
  reorderLevel: '5',
  serialTrackingEnabled: false,
  serialNumbers: '',
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
    serialTrackingEnabled:
      product.effective_serial_tracking_enabled === true ||
      product.serial_tracking_enabled === true,
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
  const [deletedProducts, setDeletedProducts] = useState<ApiDeletedProduct[]>([]);
  const [listView, setListView] = useState<'catalog' | 'deleted'>('catalog');

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

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

  const [savedImageUrl, setSavedImageUrl] =
    useState<string | null>(null);

  const [hasTrashedImage, setHasTrashedImage] =
    useState(false);

  const [trashedImageUrl, setTrashedImageUrl] =
    useState<string | null>(null);

  const [imageBusy, setImageBusy] = useState(false);

  const [variants, setVariants] =
  useState<VariantForm[]>([]);
  const [removedVariantIds, setRemovedVariantIds] = useState<string[]>([]);
  const [expandedProductId, setExpandedProductId] =
  useState<string | null>(null);

const [productVariants, setProductVariants] =
  useState<Record<string, ApiVariant[]>>({});

const [loadingVariants, setLoadingVariants] =
  useState(false);  

  const [restockProduct, setRestockProduct] = useState<ProductView | null>(null);
  const [restockVariants, setRestockVariants] = useState<ApiVariant[]>([]);
  const [restockVariantId, setRestockVariantId] = useState('');
  const [restockQuantity, setRestockQuantity] = useState('');
  const [restockSerials, setRestockSerials] = useState('');
  const [restockReason, setRestockReason] = useState('');
  const [restockSaving, setRestockSaving] = useState(false);
  const [restockError, setRestockError] = useState<string | null>(null);
  const restockAttempt = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    try {
      const [productData, categoryData, deletedData] = await Promise.all([
        api.get<ApiProduct[]>('/api/products'),
        api.get<ApiCategory[]>('/api/categories'),
        api.get<ApiDeletedProduct[]>('/api/products/deleted').catch(() => []),
      ]);

      setProducts(productData.map(mapProduct));
      setCategories(categoryData.map(mapCategory));
      setDeletedProducts(deletedData);
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

  async function openRestock(product: ProductView) {
    setRestockProduct(product);
    setRestockVariants([]);
    setRestockVariantId('');
    setRestockQuantity('');
    setRestockSerials('');
    setRestockReason('');
    setRestockError(null);
    restockAttempt.current = null;
    if (!product.hasVariants) return;
    try {
      const data = await api.get<ApiVariant[]>(`/api/products/${product.id}/variants`);
      setRestockVariants(data);
      setRestockVariantId(data[0] ? String(data[0].id) : '');
    } catch (error) {
      setRestockError(error instanceof Error ? error.message : 'Failed to load variants.');
    }
  }

  function openCategoryModal() {
    setNewCategoryName('');
    setCategoryError(null);
    setCategoryModalOpen(true);
  }

  function closeCategoryModal() {
    if (categorySaving) return;
    setCategoryModalOpen(false);
    setCategoryError(null);
  }

  async function createCategory() {
    if (categorySaving) return;
    const name = newCategoryName.trim();
    if (!name) {
      setCategoryError('Category name is required.');
      return;
    }
    if (name.length > 100) {
      setCategoryError('Category name must be 100 characters or fewer.');
      return;
    }
    setCategorySaving(true);
    setCategoryError(null);
    try {
      const created = await api.post<ApiCategory>('/api/categories', { name });
      setForm((current) => ({ ...current, categoryId: String(created.id) }));
      setCategories((current) => [
        ...current.filter((category) => category.id !== String(created.id)),
        mapCategory(created),
      ].sort((left, right) => left.name.localeCompare(right.name)));
      setCategoryModalOpen(false);
      toast(`Category “${created.name}” created and selected.`, 'success');
      try {
        const refreshed = await api.get<ApiCategory[]>('/api/categories');
        setCategories(refreshed.map(mapCategory));
      } catch {
        toast('Category was created and selected, but the category list could not be refreshed.', 'error');
      }
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'Failed to create category. Try again.');
    } finally {
      setCategorySaving(false);
    }
  }

  function closeRestock() {
    if (restockSaving) return;
    setRestockProduct(null);
    restockAttempt.current = null;
  }

  async function submitRestock() {
    if (!restockProduct || restockSaving) return;
    const variant = restockVariants.find((item) => String(item.id) === restockVariantId);
    if (restockProduct.hasVariants && !variant) {
      setRestockError('Select a variant to restock.');
      return;
    }
    const tracked = variant
      ? variant.effective_serial_tracking_enabled === true
      : restockProduct.serialTrackingEnabled;
    const serialNumbers = restockSerials.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const normalized = serialNumbers.map((value) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
    if (tracked && (!serialNumbers.length || normalized.some((value) => !value)
      || new Set(normalized).size !== normalized.length)) {
      setRestockError('Enter at least one valid, unique manufacturer serial number.');
      return;
    }
    const quantity = Number(restockQuantity);
    if (!tracked && (!Number.isSafeInteger(quantity) || quantity <= 0)) {
      setRestockError('Quantity received must be a positive whole number.');
      return;
    }
    const request = {
      variant_id: variant ? Number(variant.id) : null,
      quantity: tracked ? null : quantity,
      serial_numbers: tracked ? serialNumbers : [],
      reason: restockReason.trim() || null,
    };
    const signature = JSON.stringify({ productId: restockProduct.id, ...request,
      serial_numbers: [...request.serial_numbers].map((value) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).sort() });
    if (restockAttempt.current?.signature !== signature) {
      restockAttempt.current = { signature, key: crypto.randomUUID() };
    }
    setRestockSaving(true);
    setRestockError(null);
    try {
      const response = await api.post<{ receipt: { quantity_received: number }; replayed: boolean }>(
        `/api/products/${restockProduct.id}/restock`,
        { ...request, idempotency_key: restockAttempt.current.key }
      );
      toast(`${response.receipt.quantity_received} unit${response.receipt.quantity_received === 1 ? '' : 's'} received${response.replayed ? ' (previous submission confirmed)' : ''}.`, 'success');
      setRestockProduct(null);
      restockAttempt.current = null;
      setProductVariants({});
      await loadData();
    } catch (error) {
      setRestockError(error instanceof Error ? error.message : 'Restock failed. Review the entry before retrying.');
    } finally {
      setRestockSaving(false);
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

  const deletedFiltered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return deletedProducts.filter((product) => {
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term)
      );
    });
  }, [deletedProducts, search]);

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
    setProductFormError(null);
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

function applyImageStatus(
  status: ProductImageStatus,
  productId?: string
) {
  const nextUrl = status.image_url ?? null;

  if (
    imagePreview &&
    imagePreview.startsWith('blob:')
  ) {
    URL.revokeObjectURL(imagePreview);
  }

  setSelectedImage(null);
  setImagePreview(nextUrl);
  setSavedImageUrl(nextUrl);
  setHasTrashedImage(Boolean(status.has_trashed_image));
  setTrashedImageUrl(status.trashed_image_url ?? null);

  const id = productId ?? editingProduct?.id;
  if (!id) return;

  setProducts((current) =>
    current.map((product) =>
      product.id === id
        ? {
            ...product,
            imageUrl: nextUrl,
            imagePath: status.image_path ?? null,
          }
        : product
    )
  );

  setEditingProduct((current) =>
    current && current.id === id
      ? {
          ...current,
          imageUrl: nextUrl,
          imagePath: status.image_path ?? null,
        }
      : current
  );
}

function resetImageState() {
  if (
    imagePreview &&
    imagePreview.startsWith('blob:')
  ) {
    URL.revokeObjectURL(imagePreview);
  }

  setSelectedImage(null);
  setImagePreview(null);
  setSavedImageUrl(null);
  setHasTrashedImage(false);
  setTrashedImageUrl(null);
  setImageBusy(false);
}

function removeSelectedImage() {
  if (
    imagePreview &&
    imagePreview.startsWith('blob:')
  ) {
    URL.revokeObjectURL(imagePreview);
  }

  setSelectedImage(null);
  setImagePreview(savedImageUrl);
}

async function trashSavedImage() {
  if (!editingProduct || !savedImageUrl || imageBusy) return;

  const confirmed = window.confirm(
    'Move this product image to trash?\n\nYou can restore it from this page.'
  );
  if (!confirmed) return;

  setImageBusy(true);
  try {
    const status = await api.post<ProductImageStatus>(
      `/api/products/${editingProduct.id}/image/trash`
    );
    applyImageStatus(status, editingProduct.id);
    toast(
      status.message || 'Image moved to trash.',
      'success'
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to move image to trash.',
      'error'
    );
  } finally {
    setImageBusy(false);
  }
}

async function restoreTrashedImage() {
  if (!editingProduct || !hasTrashedImage || imageBusy) return;

  setImageBusy(true);
  try {
    const status = await api.post<ProductImageStatus>(
      `/api/products/${editingProduct.id}/image/restore`
    );
    applyImageStatus(status, editingProduct.id);
    toast(
      status.message || 'Image restored.',
      'success'
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to restore image.',
      'error'
    );
  } finally {
    setImageBusy(false);
  }
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
      serialSetting: 'inherit',
      serialNumbers: '',
    },
  ]);
}

function updateVariant(
  index: number,
  field: keyof VariantForm,
  value: string
) {
  setProductFormError(null);
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
    const confirmed = window.confirm(`Remove variant "${variant.name}" when changes are saved?`);
    if (!confirmed) return;
    setRemovedVariantIds((current) => [...current, variant.id!]);
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
  setRemovedVariantIds([]);
  setProductFormError(null);
  resetImageState();
  setAddOpen(true);
}

async function openEditProduct(
  product: ProductView
) {
  setEditingProduct(product);
  setProductFormError(null);

  setSelectedImage(null);
  setImagePreview(product.imageUrl ?? null);
  setSavedImageUrl(product.imageUrl ?? null);
  setHasTrashedImage(false);
  setTrashedImageUrl(null);

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
    serialTrackingEnabled: product.serialTrackingEnabled,
    serialNumbers: '',
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
        serialSetting: variant.serial_tracking_enabled === null
          ? 'inherit'
          : variant.serial_tracking_enabled ? 'on' : 'off',
        serialNumbers: '',
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

  try {
    const imageStatus = await api.get<ProductImageStatus>(
      `/api/products/${product.id}/image`
    );
    applyImageStatus(imageStatus, product.id);
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to load product image.',
      'error'
    );
  }
}

  function closeProductModal() {
  if (saving || imageBusy) return;

  setAddOpen(false);
  setEditingProduct(null);
  setForm(emptyForm);
  setVariants([]);
  setRemovedVariantIds([]);
  setProductFormError(null);
  resetImageState();
}

  async function saveProduct() {
  setProductFormError(null);
  const rejectForm = (message: string) => {
    setProductFormError(message);
    toast(message, 'error');
  };
  if (!form.name.trim()) {
    rejectForm('Product name is required.');
    return;
  }

  if (!form.sku.trim()) {
    rejectForm('SKU is required.');
    return;
  }

  const price = Number(form.price);
  const cost = Number(form.cost || 0);
  const stock = Number(form.stock || 0);
  const reorderLevel = Number(form.reorderLevel || 5);

  if (Number.isNaN(price) || price <= 0) {
    rejectForm('Please enter a valid selling price.');
    return;
  }

  if (!Number.isFinite(cost) || cost < 0
    || !Number.isSafeInteger(stock) || stock < 0
    || !Number.isSafeInteger(reorderLevel) || reorderLevel < 0) {
    rejectForm('Cost must be valid; opening stock and reorder level must be non-negative whole numbers.');
    return;
  }

  // Validate variants
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];

    if (!variant.name.trim()) {
      rejectForm(`Variant ${i + 1}: name is required.`);
      return;
    }

    if (!variant.sku.trim()) {
      rejectForm(`Variant ${i + 1}: SKU is required.`);
      return;
    }

    const variantStock = Number(variant.stock || 0);
    const variantReorder = Number(
      variant.reorderLevel || 2
    );

    if (
      !Number.isSafeInteger(variantStock) ||
      variantStock < 0 ||
      !Number.isSafeInteger(variantReorder) ||
      variantReorder < 0
    ) {
      rejectForm(`Variant ${i + 1}: opening stock and reorder level must be non-negative whole numbers.`);
      return;
    }

    if (
      !variant.price.trim() ||
      Number.isNaN(Number(variant.price)) ||
      Number(variant.price) <= 0
    ) {
      rejectForm(`Variant ${i + 1}: selling price is required and must be greater than zero.`);
      return;
    }

    if (
      !variant.cost.trim() ||
      Number.isNaN(Number(variant.cost)) ||
      Number(variant.cost) < 0
    ) {
      rejectForm(`Variant ${i + 1}: cost price is required and cannot be negative.`);
      return;
    }
  }

  // Make sure variant SKUs are unique in the form
  const skuList = variants.map((variant) =>
    variant.sku.trim().toUpperCase()
  );

  if (new Set(skuList).size !== skuList.length
    || skuList.includes(form.sku.trim().toUpperCase())) {
    rejectForm('Product and variant SKUs must all be unique.');
    return;
  }

  if (!editingProduct) {
    const normalizeSerial = (value: string) => value.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const serialLinesForValidation = (value: string) => value.split(/\r?\n/)
      .map((line) => line.trim()).filter(Boolean).map(normalizeSerial);
    const validateSerials = (label: string, quantity: number, value: string, tracked: boolean) => {
      const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const normalized = lines.map(normalizeSerial);
      if (!tracked && lines.length) return `${label}: remove serial numbers or enable serial tracking.`;
      if (tracked && lines.length !== quantity) return `${label}: enter exactly ${quantity} serial numbers.`;
      if (normalized.some((serial) => !serial) || new Set(normalized).size !== normalized.length) {
        return `${label}: serial numbers must be valid and unique.`;
      }
      return null;
    };
    const serialError = variants.length
      ? variants.map((variant, index) => validateSerials(
        `Variant ${index + 1}`,
        Number(variant.stock || 0),
        variant.serialNumbers,
        variant.serialSetting === 'on'
          || (variant.serialSetting === 'inherit' && form.serialTrackingEnabled)
      )).find(Boolean)
      : validateSerials('Product', stock, form.serialNumbers, form.serialTrackingEnabled);
    if (serialError) {
      rejectForm(serialError);
      return;
    }
    const allOpeningSerials = variants.length
      ? variants.flatMap((variant) => {
        const tracked = variant.serialSetting === 'on'
          || (variant.serialSetting === 'inherit' && form.serialTrackingEnabled);
        return tracked ? serialLinesForValidation(variant.serialNumbers) : [];
      })
      : form.serialTrackingEnabled ? serialLinesForValidation(form.serialNumbers) : [];
    if (new Set(allOpeningSerials).size !== allOpeningSerials.length) {
      rejectForm('Opening serial numbers must be unique across the entire product and all variants.');
      return;
    }
  }

  setSaving(true);

  try {
    const serialLines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const productFormData = new FormData();
    productFormData.append('workflow', JSON.stringify({
      name: form.name.trim(),
      sku: form.sku.trim().toUpperCase(),
      category_id: form.categoryId || null,
      price,
      cost,
      opening_quantity: editingProduct ? 0 : variants.length ? 0 : stock,
      low_stock_threshold: reorderLevel,
      serial_tracking_enabled: form.serialTrackingEnabled,
      serial_numbers: editingProduct || variants.length ? [] : serialLines(form.serialNumbers ?? ''),
      removed_variant_ids: editingProduct ? removedVariantIds.map(Number) : [],
      variants: variants.map((variant) => ({
        id: variant.id ? Number(variant.id) : null,
        name: variant.name.trim(),
        sku: variant.sku.trim().toUpperCase(),
        price: variant.price.trim() === '' ? price : Number(variant.price),
        cost: variant.cost.trim() === '' ? cost : Number(variant.cost),
        opening_quantity: editingProduct ? 0 : Number(variant.stock || 0),
        low_stock_threshold: Number(variant.reorderLevel || 2),
        serial_tracking_enabled: variant.serialSetting === 'inherit'
          ? 'inherit' : variant.serialSetting === 'on',
        serial_numbers: editingProduct ? [] : serialLines(variant.serialNumbers),
      })),
    }));
    if (selectedImage) productFormData.append('image', selectedImage);
    if (editingProduct) {
      await api.put(`/api/products/${editingProduct.id}/workflow`, productFormData);
    } else {
      await api.post('/api/products/workflow', productFormData);
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
    setRemovedVariantIds([]);
    setProductVariants({});
setExpandedProductId(null);
  
    

    await loadData();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save product.';
    setProductFormError(message);
    toast(message, 'error');
  } finally {
    setSaving(false);
  }
}

  async function deleteProduct(
  product: ProductView
) {
  const confirmed = window.confirm(
    `Move "${product.name}" to Recently deleted?\n\n` +
      'It will disappear from the POS and product list. You can restore it from Recently deleted. Historical sales stay.'
  );

    if (!confirmed) return;

    try {
      await api.delete<{ message: string }>(
        `/api/products/${product.id}`
      );

      toast(
        'Product moved to Recently deleted.',
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

  async function restoreDeletedProduct(product: ApiDeletedProduct) {
    try {
      await api.post<{ message: string }>(
        `/api/products/${product.id}/restore`
      );

      toast(
        `"${product.name}" was restored to the catalog.`,
        'success'
      );

      setListView('catalog');
      await loadData();
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to restore product.',
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

  const selectedRestockVariant = restockVariants.find(
    (variant) => String(variant.id) === restockVariantId
  );
  const restockTracked = selectedRestockVariant
    ? selectedRestockVariant.effective_serial_tracking_enabled === true
    : restockProduct?.serialTrackingEnabled === true;
  const restockCurrentStock = Number(
    selectedRestockVariant?.stock_quantity ?? restockProduct?.stock ?? 0
  );
  const restockSerialCount = restockSerials.split(/\r?\n/).filter((line) => line.trim()).length;
  const restockReceived = restockTracked ? restockSerialCount : Number(restockQuantity || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        subtitle={
          listView === 'deleted'
            ? `${deletedProducts.length} product${deletedProducts.length === 1 ? '' : 's'} in Recently deleted`
            : `${products.length} products in catalog`
        }
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

            {listView === 'catalog' && (
            <Button
              leftIcon={
                <Plus className="h-4 w-4" />
              }
              onClick={openAddProduct}
            >
              Add Product
            </Button>
            )}
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

        <Button
          variant={listView === 'deleted' ? 'secondary' : 'outline'}
          size="sm"
          leftIcon={<Trash2 className="h-4 w-4" />}
          onClick={() =>
            setListView((current) =>
              current === 'deleted' ? 'catalog' : 'deleted'
            )
          }
        >
          Recently deleted
          {deletedProducts.length > 0 ? ` (${deletedProducts.length})` : ''}
        </Button>

        <span className="text-sm text-slate-500 ml-auto">
          {listView === 'deleted'
            ? `${deletedFiltered.length} deleted`
            : `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`}
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
      ) : listView === 'deleted' ? (
        deletedFiltered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Trash2 className="h-8 w-8" />}
              title={
                deletedProducts.length === 0
                  ? 'Recently deleted is empty'
                  : 'No matching deleted products'
              }
              description={
                deletedProducts.length === 0
                  ? 'Deleted products appear here so you can restore them.'
                  : 'Try a different search.'
              }
              action={
                deletedProducts.length === 0 ? (
                  <Button
                    variant="outline"
                    onClick={() => setListView('catalog')}
                  >
                    Back to catalog
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <DataTable
            data={deletedFiltered}
            rowKey={(product) => String(product.id)}
            minWidth="800px"
            columns={[
              {
                key: 'product',
                header: 'Product',
                render: (product) => (
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {product.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {Number(product.variant_count ?? 0) > 0
                        ? `${product.variant_count} variants kept`
                        : 'No variants'}
                    </p>
                  </div>
                ),
              },
              {
                key: 'sku',
                header: 'SKU',
                width: '180px',
                render: (product) => (
                  <span className="font-mono text-sm text-slate-600">
                    {product.sku}
                  </span>
                ),
              },
              {
                key: 'category',
                header: 'Category',
                width: '160px',
                render: (product) => (
                  <span className="text-sm text-slate-600">
                    {product.category_name || 'No category'}
                  </span>
                ),
              },
              {
                key: 'deleted',
                header: 'Deleted',
                width: '200px',
                render: (product) => (
                  <div>
                    <p className="text-sm text-slate-700">
                      {formatDeletedAt(product.deleted_at)}
                    </p>
                    {product.deleted_by_username && (
                      <p className="text-xs text-slate-400">
                        by {product.deleted_by_username}
                      </p>
                    )}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                width: '140px',
                align: 'right',
                render: (product) => (
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={() => restoreDeletedProduct(product)}
                  >
                    Restore
                  </Button>
                ),
              },
            ]}
          />
        )
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
                <tr className="bg-slate-50/80">
                  <td
                    colSpan={7}
                    className="px-4 py-2 pl-14 text-xs text-slate-400"
                  >
                    <span className="inline-flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Loading variants...
                    </span>
                  </td>
                </tr>
              );
            }

            return (
              <>
                {rows.map((variant) => {
                  const stock = Number(variant.stock_quantity ?? 0);
                  const lowStock = Number(
                    variant.low_stock_threshold ?? 2
                  );
                  const status = getStockStatus({
                    stock,
                    reorderLevel: lowStock,
                  });

                  return (
                    <tr
                      key={String(variant.id)}
                      className="bg-slate-50/80"
                    >
                      <td className="px-4 py-2 align-middle text-sm text-slate-700">
                        <div className="flex items-center gap-3 pl-10">
                          <span className="truncate font-medium text-slate-800">
                            {variant.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2 text-center align-middle text-sm text-slate-700">
                        <span className="font-semibold tabular-nums">
                          {stock}
                        </span>
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <StockStatusBadge status={status} />
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <span className="whitespace-nowrap font-mono text-sm font-medium text-slate-600">
                          {variant.sku}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right align-middle">
                        <button
                          type="button"
                          onClick={() =>
                            openVariantBarcode(product, variant)
                          }
                          className="
                            inline-flex h-8 w-8
                            items-center justify-center
                            rounded-lg text-slate-400
                            hover:bg-slate-100 hover:text-slate-700
                          "
                          title={`Barcode for ${variant.name}`}
                        >
                          <Barcode className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </>
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
    width: '165px',
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
        flex w-[165px]
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
          onClick={() => openRestock(product)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
          title="Restock product"
        >
          <PackagePlus className="h-4 w-4" />
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


      <Modal
        open={!!restockProduct}
        onClose={closeRestock}
        title="Restock Product"
        description={restockProduct ? `Receive inventory for ${restockProduct.name}.` : undefined}
        size="sm"
        compactMobile
        footer={
          <>
            <Button variant="outline" onClick={closeRestock} disabled={restockSaving}>Cancel</Button>
            <Button onClick={submitRestock} loading={restockSaving}>Receive Stock</Button>
          </>
        }
      >
        {restockProduct && (
          <div className="space-y-4">
            {restockProduct.hasVariants && (
              <Select
                label="Variant"
                value={restockVariantId}
                onChange={(event) => {
                  setRestockVariantId(event.target.value);
                  setRestockError(null);
                  restockAttempt.current = null;
                }}
              >
                <option value="">Select a variant</option>
                {restockVariants.map((variant) => (
                  <option key={variant.id} value={String(variant.id)}>
                    {variant.name} — {variant.sku}
                  </option>
                ))}
              </Select>
            )}

            <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
              <div><p className="text-xs text-slate-500">Current</p><p className="font-bold text-slate-900">{restockCurrentStock}</p></div>
              <div><p className="text-xs text-slate-500">Receiving</p><p className="font-bold text-brand-700">{Number.isFinite(restockReceived) ? restockReceived : 0}</p></div>
              <div><p className="text-xs text-slate-500">Projected</p><p className="font-bold text-emerald-700">{restockCurrentStock + (Number.isFinite(restockReceived) ? restockReceived : 0)}</p></div>
            </div>

            {restockTracked ? (
              <label className="block text-sm font-medium text-slate-700">
                Manufacturer serial numbers
                <textarea
                  autoFocus
                  value={restockSerials}
                  onChange={(event) => { setRestockSerials(event.target.value); setRestockError(null); }}
                  rows={7}
                  placeholder="Scan or enter one serial number per line"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">Quantity is derived from {restockSerialCount} unique serial entries.</span>
              </label>
            ) : (
              <Input
                autoFocus
                label="Quantity received"
                type="number"
                min="1"
                step="1"
                value={restockQuantity}
                onChange={(event) => { setRestockQuantity(event.target.value); setRestockError(null); }}
                placeholder="1"
              />
            )}

            <Input
              label="Receiving reason (optional)"
              value={restockReason}
              onChange={(event) => { setRestockReason(event.target.value); setRestockError(null); }}
              placeholder="Supplier delivery or purchase order"
            />
            {restockError && (
              <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                {restockError}
              </p>
            )}
          </div>
        )}
      </Modal>


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
        compactMobile
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

          {selectedImage ? (
            <button
              type="button"
              onClick={removeSelectedImage}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-danger-600 hover:bg-danger-50"
            >
              Remove
            </button>
          ) : savedImageUrl ? (
            <button
              type="button"
              onClick={trashSavedImage}
              disabled={imageBusy}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-danger-600 hover:bg-danger-50 disabled:opacity-50"
            >
              Move to trash
            </button>
          ) : null}
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

  {editingProduct && hasTrashedImage && (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
      {trashedImageUrl ? (
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <img
            src={trashedImageUrl}
            alt="Image in trash"
            className="h-full w-full object-contain p-1"
          />
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
          <Trash2 className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-700">
          Image in trash
        </p>
        <p className="text-xs text-slate-400">
          Restore puts this photo back on the product.
        </p>
      </div>

      <button
        type="button"
        onClick={restoreTrashedImage}
        disabled={imageBusy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Restore image
      </button>
    </div>
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
          />

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="category" className="text-sm font-medium text-slate-700">Category</label>
              <button
                type="button"
                onClick={openCategoryModal}
                className="text-xs font-semibold text-brand-700 hover:text-brand-800"
              >
                + New Category
              </button>
            </div>
            <Select
              name="category"
              value={form.categoryId}
              onChange={(e) => updateForm('categoryId', e.target.value)}
            >
              <option value="">No Category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </div>

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
            label={editingProduct ? 'Current Stock (read-only)' : 'Opening Stock'}
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
            disabled={!!editingProduct || variants.length > 0}
            hint={editingProduct
              ? 'Use Restock from the Products list to receive inventory.'
              : 'Starting quantity only. Use Restock for future deliveries.'}
          />

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <input
              type="checkbox"
              checked={form.serialTrackingEnabled}
              onChange={(event) => setForm((current) => ({
                ...current,
                serialTrackingEnabled: event.target.checked,
              }))}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium text-slate-700">Track individual serial numbers</span>
              <span className="block text-xs text-slate-500">Serialized stock becomes sellable only after every physical unit is registered. Opening serials entered below automatically create Stock Units.</span>
            </span>
          </label>

          {!editingProduct && variants.length === 0 && form.serialTrackingEnabled && (
            <label className="sm:col-span-2 text-sm font-medium text-slate-700">
              Opening manufacturer serial numbers
              <textarea
                value={form.serialNumbers}
                onChange={(event) => updateForm('serialNumbers', event.target.value)}
                rows={5}
                placeholder="Scan or enter one serial number per line"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {form.serialNumbers.split(/\r?\n/).filter((line) => line.trim()).length} of {Number(form.stock || 0)} serials entered
              </span>
            </label>
          )}

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
        Product Variants
      </label>

      <p className="text-xs text-slate-400 mt-1">
        Optional — each variant has its own SKU, selling price, cost price, and stock.
      </p>
    </div>

    <button
      type="button"
      onClick={addVariant}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <Plus className="h-4 w-4" />
      Add Variant
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
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_110px_36px]">
            <input
              value={variant.name}
              onChange={(e) =>
                updateVariant(
                  index,
                  'name',
                  e.target.value
                )
              }
              placeholder="Variant name, e.g. White"
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
              placeholder={editingProduct ? 'Current stock' : 'Opening stock'}
              disabled={!!editingProduct}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />

            <button
              type="button"
              onClick={() => removeVariant(index)}
              className="flex h-9 w-9 items-center justify-center justify-self-end rounded-md text-slate-400 hover:bg-danger-50 hover:text-danger-600"
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
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              type="number"
              min="0"
              value={variant.price}
              onChange={(event) => updateVariant(index, 'price', event.target.value)}
              placeholder="Selling price (required)"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500"
            />
            <input
              type="number"
              min="0"
              value={variant.cost}
              onChange={(event) => updateVariant(index, 'cost', event.target.value)}
              placeholder="Cost price (required)"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500"
            />
            <select
              value={variant.serialSetting}
              onChange={(event) => updateVariant(index, 'serialSetting', event.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="inherit">Inherit product tracking</option>
              <option value="on">Serial tracking on</option>
              <option value="off">Serial tracking off</option>
            </select>
          </div>
          {!editingProduct && (
            variant.serialSetting === 'on'
            || (variant.serialSetting === 'inherit' && form.serialTrackingEnabled)
          ) && (
            <label className="mt-2 block text-xs font-medium text-slate-600">
              Manufacturer serials ({variant.serialNumbers.split(/\r?\n/).filter((line) => line.trim()).length} of {Number(variant.stock || 0)})
              <textarea
                value={variant.serialNumbers}
                onChange={(event) => updateVariant(index, 'serialNumbers', event.target.value)}
                rows={3}
                placeholder="Scan or enter one serial number per line"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 font-mono text-xs outline-none focus:border-brand-500"
              />
              <span className="mt-1 block font-normal text-slate-500">Saving registers these physical units as Stock Units automatically.</span>
            </label>
          )}
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
        {productFormError && (
          <p role="alert" className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {productFormError}
          </p>
        )}
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

      <Modal
        open={categoryModalOpen}
        onClose={closeCategoryModal}
        title="New Category"
        description="Create a category without leaving your unsaved product."
        size="sm"
        compactMobile
        footer={
          <>
            <Button variant="outline" onClick={closeCategoryModal} disabled={categorySaving}>Cancel</Button>
            <Button onClick={createCategory} loading={categorySaving}>Create & Select</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            autoFocus
            label="Category name"
            name="new-category-name"
            value={newCategoryName}
            onChange={(event) => {
              setNewCategoryName(event.target.value);
              setCategoryError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                createCategory();
              }
            }}
            maxLength={100}
            placeholder="e.g. Laptops"
            error={categoryError ?? undefined}
          />
          <p className="text-xs text-slate-500">Your current product details, variants, prices, stock, and image remain unchanged.</p>
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
