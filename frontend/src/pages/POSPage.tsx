import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';

import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from '@zxing/browser';

import {
  useWirelessScanner,
} from '@/context/WirelessScannerContext';

import QRCode from 'qrcode';

import {
  Search,
  ScanLine,
  Smartphone,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  X,
  Banknote,
  Landmark,
  QrCode,
  CheckCircle2,
  Package,
  RefreshCw,
} from 'lucide-react';

import * as Icons from 'lucide-react';

import type {
  Product,
  CartLine,
  Sale,
} from '@/types';

import { ProductCard } from '@/components/ui/ProductCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';

import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

import {
  formatCurrency,
} from '@/lib/currency';

import { api } from '@/lib/api';

/* =========================================================
   API TYPES
   ========================================================= */

interface ApiCategory {
  id: number | string;
  name: string;
}

interface Customer {
  id: number | string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

interface ApiProduct {
  id: number | string;
  sku: string;
  name: string;

  category_id:
    | number
    | string
    | null;

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

interface ApiVariant {
  id: number | string;

  product_id:
    | number
    | string;

  name: string;
  sku: string;

  price:
    | number
    | string
    | null;

  cost:
    | number
    | string
    | null;

  stock_quantity:
    | number
    | string;

  low_stock_threshold:
    | number
    | string;

  is_active?: boolean;
}

interface ApiSearchResult {
  type: 'product' | 'variant';

  product_id: number | string;
  variant_id: number | string | null;

  product_name: string;
  variant_name: string | null;

  sku: string;

  price: number | string;
  cost: number | string;

  stock_quantity: number | string;
  low_stock_threshold: number | string;

  category_name?: string | null;

  image_url?: string | null;
  image_path?: string | null;
}

/* =========================================================
   POS PRODUCT TYPE
   ========================================================= */

interface POSProduct extends Product {
  categoryName?: string;

  hasVariants?: boolean;
  variantCount?: number;

  parentProductId?: string;
  variantId?: string;
  variantName?: string;
}

/* =========================================================
   HELPERS
   ========================================================= */

function categoryIcon(
  categoryName: string
) {
  const name =
    categoryName.toLowerCase();

  if (name.includes('keyboard')) {
    return 'Keyboard';
  }

  if (name.includes('mouse')) {
    return 'Mouse';
  }

  if (name.includes('audio')) {
    return 'Headphones';
  }

  if (name.includes('storage')) {
    return 'HardDrive';
  }

  if (name.includes('cable')) {
    return 'Cable';
  }

  if (name.includes('monitor')) {
    return 'Monitor';
  }

  if (name.includes('webcam')) {
    return 'Webcam';
  }

  return 'Package';
}

function mapProduct(
  product: ApiProduct
): POSProduct {
  return {
    id: String(product.id),

    name: product.name,
    sku: product.sku,

    categoryId:
      product.category_id !== null &&
      product.category_id !== undefined
        ? String(product.category_id)
        : '',

    price: Number(
      product.price ?? 0
    ),

    cost: Number(
      product.cost ?? 0
    ),

    stock: Number(
      product.stock_quantity ?? 0
    ),

    reorderLevel: Number(
      product.low_stock_threshold ?? 5
    ),

    barcode: product.sku,

    image: product.image_url ?? '',

    categoryName:
      product.category_name ??
      undefined,

    hasVariants:
      Boolean(
        product.has_variants
      ) ||
      Number(
        product.variant_count ?? 0
      ) > 0,

    variantCount:
      Number(
        product.variant_count ?? 0
      ),
  };
}

interface POSDraft {
  cart: CartLine[];
  discount: number;
  discountPercent: number;
  selectedCustomer: Customer | null;

  invoiceCustomer: {
    name: string;
    phone: string;
    email: string;
    address: string;
  };

  saveCustomer: boolean;
  paymentMethod: Sale['paymentMethod'];

  // UI state
  activeCategory: string;
  desktopCartOpen: boolean;
  checkoutOpen: boolean;
}
/* =========================================================
   POS PAGE
   ========================================================= */

export function POSPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
  sessionId: wirelessSessionId,
  connected: wirelessScannerConnected,
  lastScan,
  error: wirelessScannerError,
  createSession,
  disconnectScanner,
} = useWirelessScanner();

    const posDraftStorageKey = user?.id
    ? `capytech-pos-draft-${user.id}`
    : 'capytech-pos-draft';

  const savedDraftRef = useRef<POSDraft | null>(null);

  if (savedDraftRef.current === null) {
    try {
      const savedDraft = localStorage.getItem(
        posDraftStorageKey
      );

      if (savedDraft) {
        const parsed = JSON.parse(
          savedDraft
        ) as POSDraft;

        if (Array.isArray(parsed.cart)) {
          savedDraftRef.current = parsed;
        }
      }
    } catch (error) {
      console.error(
        'Failed to restore POS draft:',
        error
      );
    }
  }

  /* -------------------------
     REAL PRODUCTS
     ------------------------- */

  const [
    products,
    setProducts,
  ] = useState<POSProduct[]>([]);

  const [
    categories,
    setCategories,
  ] = useState<
    {
      id: string;
      name: string;
      icon: string;
    }[]
  >([]);

  const [
    loadingProducts,
    setLoadingProducts,
  ] = useState(true);

  /* -------------------------
     VARIANTS
     ------------------------- */

  const [
    productVariants,
    setProductVariants,
  ] = useState<
    Record<string, ApiVariant[]>
  >({});

  const [
    variantProduct,
    setVariantProduct,
  ] =
    useState<POSProduct | null>(
      null
    );

  const [
    variantPickerOpen,
    setVariantPickerOpen,
  ] = useState(false);

  const [
    loadingVariants,
    setLoadingVariants,
  ] = useState(false);

 const [
  customers,
  setCustomers,
] = useState<Customer[]>([]);

const [
  selectedCustomer,
  setSelectedCustomer,
] = useState<Customer | null>(
  () =>
    savedDraftRef.current
      ?.selectedCustomer ?? null
);

const [
  invoiceCustomer,
  setInvoiceCustomer,
] = useState(() =>
  savedDraftRef.current
    ?.invoiceCustomer ?? {
    name: '',
    phone: '',
    email: '',
    address: '',
  }
);

const [
  saveCustomer,
  setSaveCustomer,
] = useState(
  () =>
    savedDraftRef.current
      ?.saveCustomer ?? false
);

const [
  customerSearch,
  setCustomerSearch,
] = useState('');

const [
  customerPickerOpen,
  setCustomerPickerOpen,
] = useState(false);

const [
  newCustomerOpen,
  setNewCustomerOpen,
] = useState(false);

const [
  newCustomer,
  setNewCustomer,
] = useState({
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
});

const [
  creatingCustomer,
  setCreatingCustomer,
] = useState(false);

  /* -------------------------
     POS STATE
     ------------------------- */

  const [
  activeCategory,
  setActiveCategory,
] = useState(
  () =>
    savedDraftRef.current
      ?.activeCategory ?? 'all'
);

  const [search, setSearch] =
    useState('');

  const [cart, setCart] =
  useState<CartLine[]>(
    () =>
      savedDraftRef.current
        ?.cart ?? []
  );

const [
  discount,
  setDiscount,
] = useState(
  () =>
    savedDraftRef.current
      ?.discount ?? 0
);

const [
  discountPercent,
  setDiscountPercent,
] = useState(
  () =>
    savedDraftRef.current
      ?.discountPercent ?? 0
);

const [
  paymentMethod,
  setPaymentMethod,
] = useState<
  Sale['paymentMethod']
>(
  () =>
    savedDraftRef.current
      ?.paymentMethod ?? 'cash'
);

  const [
  checkoutOpen,
  setCheckoutOpen,
] = useState(
  () =>
    savedDraftRef.current
      ?.checkoutOpen ?? false
);

  const [
  paymentVerified,
  setPaymentVerified,
] = useState(false);

  const [
    receiptOpen,
    setReceiptOpen,
  ] = useState(false);

  const [
    lastSale,
    setLastSale,
  ] =
    useState<Sale | null>(null);

  const [
    mobileCartOpen,
    setMobileCartOpen,
  ] = useState(false);

  const [
  searchResults,
  setSearchResults,
] = useState<ApiSearchResult[]>([]);

const [
  searching,
  setSearching,
] = useState(false);

const [
  scannerOpen,
  setScannerOpen,
] = useState(false);

const [
  scannerError,
  setScannerError,
] = useState('');

const [
  scannerStarting,
  setScannerStarting,
] = useState(false);

const scannerVideoRef =
  useRef<HTMLVideoElement | null>(null);

const scannerControlsRef =
  useRef<IScannerControls | null>(null);

const scannerProcessingRef =
  useRef(false);
  /*
 * One idempotency key per checkout attempt.
 * The same key is reused if the request is retried.
 */
const checkoutKeyRef =
  useRef<string | null>(null);



const [
  phoneScannerModalOpen,
  setPhoneScannerModalOpen,
] = useState(false);

const [
  phoneScannerQr,
  setPhoneScannerQr,
] = useState('');

const [
  phoneScannerUrl,
  setPhoneScannerUrl,
] = useState('');

const [
  scannedProduct,
  setScannedProduct,
] = useState<{
  product: POSProduct;
  parent?: POSProduct;
  variant?: ApiVariant;
} | null>(null);  

  const [
  desktopCartOpen,
  setDesktopCartOpen,
] = useState(
  () =>
    savedDraftRef.current
      ?.desktopCartOpen ??
    (
      savedDraftRef.current
        ?.cart?.length ?? 0
    ) > 0
);

  const searchRef =
    useRef<HTMLInputElement>(
      null
    );

      /* =========================================================
     POS DRAFT PERSISTENCE
     ========================================================= */

  useEffect(() => {
    try {
      if (cart.length === 0) {
        localStorage.removeItem(
          posDraftStorageKey
        );

        return;
      }

      const draft: POSDraft = {
  cart,
  discount,
  discountPercent,
  selectedCustomer,
  invoiceCustomer,
  saveCustomer,
  paymentMethod,

  activeCategory,
  desktopCartOpen,
  checkoutOpen,
};

      localStorage.setItem(
        posDraftStorageKey,
        JSON.stringify(draft)
      );
    } catch (error) {
      console.error(
        'Failed to save POS draft:',
        error
      );
    }
  }, [
  cart,
  discount,
  discountPercent,
  selectedCustomer,
  invoiceCustomer,
  saveCustomer,
  paymentMethod,
  activeCategory,
  desktopCartOpen,
  checkoutOpen,
  posDraftStorageKey,
]);

  /* =========================================================
     LOAD REAL DATABASE DATA
     ========================================================= */

  useEffect(() => {
    loadPOSData();
  }, []);

  async function loadPOSData() {
    setLoadingProducts(true);

    try {
      const [
  productData,
  categoryData,
  customerData,
] = await Promise.all([
  api.get<ApiProduct[]>(
    '/api/products'
  ),

  api.get<ApiCategory[]>(
    '/api/categories'
  ),

  api.get<Customer[]>(
    '/api/customers'
  ),
]);

      setProducts(
        productData.map(
          mapProduct
        )
      );
      setCustomers(customerData);

      setCategories([
        {
          id: 'all',
          name: 'All Products',
          icon: 'LayoutGrid',
        },

        ...categoryData.map(
          (category) => ({
            id: String(
              category.id
            ),

            name:
              category.name,

            icon:
              categoryIcon(
                category.name
              ),
          })
        ),
      ]);
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to load POS products.',
        'error'
      );
    } finally {
      setLoadingProducts(
        false
      );
    }
  }

  /* =========================================================
     FILTER PRODUCTS
     ========================================================= */

  const filteredProducts =
    useMemo(() => {
      return products.filter(
        (product) => {
          const term =
            search
              .trim()
              .toLowerCase();

          const matchCategory =
            activeCategory ===
              'all' ||
            product.categoryId ===
              activeCategory;

          const matchSearch =
            !term ||
            product.name
              .toLowerCase()
              .includes(term) ||
            product.sku
              .toLowerCase()
              .includes(term) ||
            product.barcode
              .toLowerCase()
              .includes(term);

          return (
            matchCategory &&
            matchSearch
          );
        }
      );
    }, [
      products,
      activeCategory,
      search,
    ]);

  /* =========================================================
     CART TOTALS
     ========================================================= */

  const subtotal = cart.reduce(
    (sum, line) =>
      sum +
      line.product.price *
        line.quantity,
    0
  );

  const total = Math.max(
    0,
    subtotal - discount
  );

  const totalItems =
    cart.reduce(
      (sum, line) =>
        sum + line.quantity,
      0
    );

   function applyDiscountPercent(
  percent: number
) {
  setDiscountPercent(percent);

  const amount = Math.round(
    subtotal * (percent / 100)
  );

  setDiscount(amount);
} 

  /* =========================================================
     CART
     ========================================================= */

  function addToCart(
  product: POSProduct
) {
  if (product.stock <= 0) {
    toast(
      `${product.name} is out of stock.`,
      'warning'
    );

    return;
  }

  setCart((previous) => {
    const existing =
      previous.find(
        (line) =>
          line.product.id ===
          product.id
      );

    if (existing) {
      if (
        existing.quantity >=
        product.stock
      ) {
        toast(
          `Only ${product.stock} units of ${product.name} are in stock.`,
          'warning'
        );

        return previous;
      }

      return previous.map(
        (line) =>
          line.product.id ===
          product.id
            ? {
                ...line,
                quantity:
                  line.quantity + 1,
              }
            : line
      );
    }

    return [
      ...previous,
      {
        product,
        quantity: 1,
      },
    ];
  });

  // Automatically open cart after adding product
  setDesktopCartOpen(true);
  toast(
  `${product.name} added to cart.`,
  'success'
);
}

  function updateQty(
  productId: string,
  delta: number
) {
  setCart((previous) => {
    const updatedCart = previous
      .map((line) => {
        if (
          line.product.id !==
          productId
        ) {
          return line;
        }

        const newQuantity =
          line.quantity + delta;

        if (
          newQuantity >
          line.product.stock
        ) {
          toast(
            `Only ${line.product.stock} units in stock.`,
            'warning'
          );

          return line;
        }

        return {
          ...line,
          quantity: newQuantity,
        };
      })
      .filter(
        (line) =>
          line.quantity > 0
      );

    if (updatedCart.length === 0) {
      setDesktopCartOpen(false);
      setDiscount(0);
      setDiscountPercent(0);
    }

    return updatedCart;
  });
}

  function removeLine(
  productId: string
) {
  const removedItem =
    cart.find(
      (line) =>
        line.product.id === productId
    );

  setCart((previous) => {
    const updatedCart =
      previous.filter(
        (line) =>
          line.product.id !==
          productId
      );

    if (updatedCart.length === 0) {
      setDesktopCartOpen(false);
      setDiscount(0);
      setDiscountPercent(0);
    }

    return updatedCart;
  });

  if (removedItem) {
    toast(
      `${removedItem.product.name} removed from cart.`,
      'info'
    );
  }
}

  function clearCart() {
  setCart([]);
  setDiscount(0);
  setDiscountPercent(0);
  setDesktopCartOpen(false);

  localStorage.removeItem(
    posDraftStorageKey
  );
}

  /* =========================================================
     PRODUCT CLICK
     ========================================================= */

  async function handleProductClick(
    product: POSProduct
  ) {
    if (!product.hasVariants) {
      addToCart(product);
      return;
    }

    setVariantProduct(product);
    setVariantPickerOpen(true);

    const cached =
      productVariants[
        product.id
      ];

    if (cached) {
      return;
    }

    setLoadingVariants(true);

    try {
      const data =
        await api.get<
          ApiVariant[]
        >(
          `/api/products/${product.id}/variants`
        );

      setProductVariants(
        (current) => ({
          ...current,

          [product.id]:
            data,
        })
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to load product variants.',
        'error'
      );

      setVariantPickerOpen(
        false
      );

      setVariantProduct(null);
    } finally {
      setLoadingVariants(
        false
      );
    }
  }

  /* =========================================================
     ADD VARIANT TO CART
     ========================================================= */

  function addVariantToCart(
    parent: POSProduct,
    variant: ApiVariant
  ) {
    const stock = Number(
      variant.stock_quantity ??
        0
    );

    if (stock <= 0) {
      toast(
        `${variant.name} is out of stock.`,
        'warning'
      );

      return;
    }

    const price =
      variant.price === null ||
      variant.price ===
        undefined
        ? parent.price
        : Number(
            variant.price
          );

    const cost =
      variant.cost === null ||
      variant.cost ===
        undefined
        ? parent.cost
        : Number(
            variant.cost
          );

    const variantProduct: POSProduct =
      {
        ...parent,

        /*
         * Unique cart ID so
         * Black and White are
         * separate cart lines.
         */
        id: `${parent.id}-variant-${variant.id}`,

        name:
          `${parent.name} — ${variant.name}`,

        sku:
          variant.sku,

        barcode:
          variant.sku,

        price,
        cost,
        stock,

        reorderLevel:
          Number(
            variant.low_stock_threshold ??
              parent.reorderLevel
          ),

        hasVariants:
          false,

        variantCount: 0,

        parentProductId:
          parent.id,

        variantId:
          String(
            variant.id
          ),

        variantName:
          variant.name,
      };

    addToCart(
      variantProduct
    );

    setVariantPickerOpen(
      false
    );

    setVariantProduct(null);

  
  }
  
const lookupBarcode = useCallback(
  async (rawCode: string) => {
    const code = rawCode.trim();

    if (!code) {
      return false;
    }

    try {
      const result =
        await api.get<any>(
          `/api/products/lookup/${encodeURIComponent(
            code
          )}`
        );

      setSearch('');

      if (result.type === 'variant') {
        const parentProduct =
          products.find(
            (product) =>
              product.id ===
              String(
                result.product_id
              )
          );

        if (!parentProduct) {
          toast(
            'Parent product could not be loaded.',
            'error'
          );

          return false;
        }

        const variant: ApiVariant = {
          id:
            String(
              result.variant_id
            ),

          product_id:
            String(
              result.product_id
            ),

          name:
            result.variant_name,

          sku:
            result.variant_sku,

          price:
            result.price,

          cost:
            result.cost,

          stock_quantity:
            result.stock_quantity,

          low_stock_threshold:
            result.low_stock_threshold,

          is_active: true,
        };

        const stock = Number(
  variant.stock_quantity ?? 0
);

const scannedProductProduct: POSProduct = {
  ...parentProduct,

  id: `${parentProduct.id}-variant-${variant.id}`,

  name: `${parentProduct.name} — ${variant.name}`,

  sku: variant.sku,
  barcode: variant.sku,

  price:
    variant.price === null ||
    variant.price === undefined
      ? parentProduct.price
      : Number(variant.price),

  cost:
    variant.cost === null ||
    variant.cost === undefined
      ? parentProduct.cost
      : Number(variant.cost),

  stock,

  reorderLevel: Number(
    variant.low_stock_threshold ??
      parentProduct.reorderLevel
  ),

  hasVariants: false,
  variantCount: 0,

  parentProductId:
    parentProduct.id,

  variantId:
    String(variant.id),

  variantName:
    variant.name,
};

setScannedProduct({
  product: scannedProductProduct,
  parent: parentProduct,
  variant,
});

return true;
      }

      if (result.type === 'product') {
        const product =
          products.find(
            (item) =>
              item.id ===
              String(result.id)
          );

        if (!product) {
          toast(
            'Product could not be loaded.',
            'error'
          );

          return false;
        }

        if (result.has_variants) {
          await handleProductClick(
            product
          );

          return true;
        }

        setScannedProduct({
  product,
});

return true;
      }

      toast(
        `No product found for "${code}".`,
        'warning'
      );

      return false;
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : `No product found for "${code}".`,
        'warning'
      );

      return false;
    }
  },
  [products]
);

useEffect(() => {
  if (!lastScan) {
    return;
  }

  lookupBarcode(
    lastScan.code
  );
}, [
  lastScan?.id,
  lookupBarcode,
]);

/* =========================================================
   PHONE SCANNER PAIRING QR
   ========================================================= */

useEffect(() => {
  if (
    !phoneScannerModalOpen ||
    !wirelessSessionId
  ) {
    return;
  }

  const sessionId =
    wirelessSessionId;

  let cancelled = false;

  async function generatePhoneScannerQr() {
    try {
      /*
       * IMPORTANT FOR LOCAL DEVELOPMENT:
       *
       * A phone cannot use localhost because localhost
       * would point to the phone itself.
       *
       * If the POS is already opened through the PC's
       * LAN IP, use that automatically.
       *
       * Otherwise use the current development LAN IP.
       */

      const scannerUrl =
  `${window.location.origin}/scanner?session=${encodeURIComponent(
    sessionId
  )}`;

      const qrDataUrl =
        await QRCode.toDataURL(
          scannerUrl,
          {
            width: 320,
            margin: 2,
            errorCorrectionLevel: 'M',
          }
        );

      if (cancelled) {
        return;
      }

      setPhoneScannerUrl(
        scannerUrl
      );

      setPhoneScannerQr(
        qrDataUrl
      );
    } catch (error) {
      console.error(
        'Failed to generate phone scanner QR:',
        error
      );

      if (!cancelled) {
        toast(
  'Could not generate scanner QR code.',
  'error'
);
      }
    }
  }

  generatePhoneScannerQr();

  return () => {
    cancelled = true;
  };
}, [
  phoneScannerModalOpen,
  wirelessSessionId,
]);

  async function handleBarcodeSearch(
  event: React.KeyboardEvent<HTMLInputElement>
) {
  if (
    event.key !== 'Enter' ||
    !search.trim()
  ) {
    return;
  }

  event.preventDefault();

  await lookupBarcode(search);
}
function stopScanner() {
  scannerControlsRef.current?.stop();

  scannerControlsRef.current =
    null;

  scannerProcessingRef.current =
    false;
}

function closeScanner() {
  stopScanner();

  setScannerOpen(false);
  setScannerError('');
  setScannerStarting(false);
}

async function startScanner() {
  if (!scannerVideoRef.current) {
    return;
  }

  stopScanner();

  setScannerError('');
  setScannerStarting(true);

  try {
    const reader =
      new BrowserMultiFormatReader();

    const controls =
      await reader.decodeFromConstraints(
        {
          audio: false,

          video: {
            facingMode: {
              ideal: 'environment',
            },
          },
        },

        scannerVideoRef.current,

        async (
          result,
          error,
          controls
        ) => {
          if (
            !result ||
            scannerProcessingRef.current
          ) {
            return;
          }

          const code =
            result.getText().trim();

          if (!code) {
            return;
          }

          scannerProcessingRef.current =
            true;

          const found =
            await lookupBarcode(code);

          if (found) {
            controls.stop();

            scannerControlsRef.current =
              null;

            setScannerOpen(false);

            

            scannerProcessingRef.current =
              false;

            return;
          }

          /*
           * Allow another scan if the
           * barcode was not found.
           */
          scannerProcessingRef.current =
            false;
        }
      );

    scannerControlsRef.current =
      controls;
  } catch (error) {
    console.error(
      'Camera scanner error:',
      error
    );

    setScannerError(
      'Unable to access the camera. Check camera permission and try again.'
    );
  } finally {
    setScannerStarting(false);
  }
}
useEffect(() => {
  if (!scannerOpen) {
    stopScanner();
    return;
  }

  const timer =
    window.setTimeout(
      () => {
        startScanner();
      },
      100
    );

  return () => {
    window.clearTimeout(timer);
    stopScanner();
  };
}, [scannerOpen]);
  /* =========================================================
   COMPLETE SALE
   ========================================================= */

async function completeSale() {
  if (cart.length === 0) {
    return;
  }

  /*
   * Create the key only once for this checkout.
   * A retry keeps the same key.
   */
  if (!checkoutKeyRef.current) {
    checkoutKeyRef.current =
      crypto.randomUUID();
  }

  const idempotencyKey =
    checkoutKeyRef.current;

  try {
    let customerId =
      selectedCustomer
        ? Number(selectedCustomer.id)
        : null;

    if (
      saveCustomer &&
      !selectedCustomer &&
      invoiceCustomer.name.trim()
    ) {
      const created =
        await api.post<Customer>(
          '/api/customers',
          {
            name:
              invoiceCustomer.name.trim(),

            phone:
              invoiceCustomer.phone.trim(),

            email:
              invoiceCustomer.email.trim(),

            address:
              invoiceCustomer.address.trim(),

            notes: '',
          }
        );

      customerId =
        Number(created.id);

      setCustomers(
        (current) => [
          ...current,
          created,
        ]
      );

      setSelectedCustomer(
        created
      );
    }

    const payload = {
      items: cart.map((line) => {
        const product =
          line.product as POSProduct;

        return {
          product_id:
            product.parentProductId ??
            product.id,

          variant_id:
            product.variantId ??
            null,

          quantity:
            line.quantity,
        };
      }),

      payment_method:
        paymentMethod,

      discount,

      customer_id:
        customerId,

      customer_name:
        invoiceCustomer.name.trim(),

      customer_phone:
        invoiceCustomer.phone.trim(),

      customer_email:
        invoiceCustomer.email.trim(),

      customer_address:
  invoiceCustomer.address.trim(),

idempotency_key:
  idempotencyKey,
};
    const result =
      await api.post<{
        sale: {
          id: number | string;
          invoice_number: string;
          user_id: number | string;
          subtotal: number | string;
          discount: number | string;
          total: number | string;
          payment_method:
            Sale['paymentMethod'];
          status: string;
          created_at: string;
        };

        items: {
          product_id:
            number | string | null;

          variant_id:
            number | string | null;

          product_name: string;

          variant_name:
            string | null;

          variant_sku:
            string | null;

          quantity: number;

          unit_price:
            number | string;

          line_total:
            number | string;
        }[];
      }>(
        '/api/sales',
        payload
      );

    const sale: Sale = {
      id:
        String(result.sale.id),

      invoice:
        result.sale.invoice_number,

      date:
        result.sale.created_at,

      cashierId:
        String(
          result.sale.user_id
        ),

      cashierName:
        user?.name ??
        'Owner',

      items:
        result.items.map(
          (item) => ({
            productId:
              item.product_id !== null
                ? String(
                    item.product_id
                  )
                : '',

            name:
              item.variant_name
                ? `${item.product_name} — ${item.variant_name}`
                : item.product_name,

            sku:
              item.variant_sku ??
              '',

            price:
              Number(
                item.unit_price
              ),

            quantity:
              Number(
                item.quantity
              ),

            subtotal:
              Number(
                item.line_total
              ),
          })
        ),

      subtotal:
        Number(
          result.sale.subtotal
        ),

      discount:
        Number(
          result.sale.discount
        ),

      total:
        Number(
          result.sale.total
        ),

      status:
        result.sale.status as Sale['status'],

      paymentMethod:
        result.sale.payment_method,
    };

    setLastSale(sale);

    /*
 * Sale succeeded.
 * The next checkout must get a new key.
 */
checkoutKeyRef.current = null;

    setCheckoutOpen(false);
    setReceiptOpen(true);


    setPaymentVerified(false);

    // Reset customer state for the next sale
    setSelectedCustomer(null);

    setInvoiceCustomer({
      name: '',
      phone: '',
      email: '',
      address: '',
    });

    setSaveCustomer(false);

    setCustomerSearch('');

    clearCart();

    setMobileCartOpen(false);

    /*
     * Reload products so stock on screen
     * updates immediately after sale.
     */
    await loadPOSData();

    toast(
      `Sale completed: ${sale.invoice}`,
      'success'
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Checkout failed.',
      'error'
    );
  }
}
  
  /* =========================================================
     KEEP SEARCH FOCUSED
     ========================================================= */

  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  useEffect(() => {
  const term = search.trim();

  if (!term) {
    setSearchResults([]);
    return;
  }

  const timer = setTimeout(async () => {
    try {
      setSearching(true);

      const results =
        await api.get<ApiSearchResult[]>(
          `/api/products/search?q=${encodeURIComponent(term)}`
        );

      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, 250);

  return () => clearTimeout(timer);
}, [search]);


const scannedProductInCart =
  scannedProduct
    ? cart.find(
        (line) =>
          line.product.id ===
          scannedProduct.product.id
      )?.quantity ?? 0
    : 0;

const scannedProductAvailable =
  scannedProduct
    ? Math.max(
        0,
        scannedProduct.product.stock -
          scannedProductInCart
      )
    : 0;
  /* =========================================================
     UI
     ========================================================= */

  return (
    <div className="flex gap-4 h-[calc(100vh-7rem)] lg:h-[calc(100vh-5rem)] -m-4 lg:-m-6">

      {/* =====================================================
          CATEGORIES
          ===================================================== */}

      <div className="hidden md:flex flex-col w-44 shrink-0 bg-white border-r border-slate-200 p-3 overflow-y-auto scrollbar-thin">

        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 px-2 mb-2">
          Categories
        </p>

        <div className="space-y-1">
          {categories.map(
            (category) => {
              const Icon =
  (Icons as any)[category.icon] ??
  Icons.Package;

              const active =
                activeCategory ===
                category.id;

              return (
                <button
                  key={
                    category.id
                  }
                  onClick={() =>
                    setActiveCategory(
                      category.id
                    )
                  }
                  className={`flex items-center gap-2.5 w-full rounded-lg px-3 h-10 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />

                  <span className="truncate">
                    {
                      category.name
                    }
                  </span>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* =====================================================
          CENTER
          ===================================================== */}

      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile Categories */}

        <div className="md:hidden flex gap-2 overflow-x-auto no-scrollbar px-4 pt-4 pb-2 bg-white border-b border-slate-200">
          {categories.map(
            (category) => {
              const active =
                activeCategory ===
                category.id;

              return (
                <button
                  key={
                    category.id
                  }
                  onClick={() =>
                    setActiveCategory(
                      category.id
                    )
                  }
                  className={`shrink-0 rounded-lg px-3 h-9 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {
                    category.name
                  }
                </button>
              );
            }
          )}
        </div>

        {/* Search */}

        <div className="p-4 bg-white border-b border-slate-200">
          <div className="relative">

            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />

            <input
              ref={searchRef}
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target
                    .value
                )
              }
              onKeyDown={
                handleBarcodeSearch
              }
              placeholder="Search products or scan barcode, then press Enter..."
              className="w-full h-12 rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-24 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 focus:bg-white transition-colors"
            />

            <button
  type="button"
  onClick={() =>
    setScannerOpen(true)
  }
  className="
    absolute
    right-12
    top-1/2
    flex
    h-9
    w-9
    -translate-y-1/2
    items-center
    justify-center
    rounded-lg
    text-slate-400
    transition-colors
    hover:bg-slate-100
    hover:text-brand-600
  "
  title="Scan barcode with camera"
  aria-label="Scan barcode with camera"
>
  <ScanLine className="h-5 w-5" />
</button>

<button
  type="button"
  onClick={() => {
  if (!wirelessSessionId) {
    createSession();
  }

  setPhoneScannerModalOpen(true);
}}
  className={`
    absolute
    right-2
    top-1/2
    flex
    h-9
    w-9
    -translate-y-1/2
    items-center
    justify-center
    rounded-lg
    transition-colors

    ${
      wirelessScannerConnected
        ? 'bg-emerald-50 text-emerald-600'
        : 'text-slate-400 hover:bg-slate-100 hover:text-brand-600'
    }
  `}
  title={
    wirelessScannerConnected
      ? 'Phone scanner connected'
      : 'Connect phone scanner'
  }
  aria-label="Connect phone scanner"
>
  <Smartphone className="h-5 w-5" />

  {wirelessScannerConnected && (
    <span
      className="
        absolute
        right-1
        top-1
        h-2
        w-2
        rounded-full
        bg-emerald-500
        ring-2
        ring-white
      "
    />
  )}
</button>

          </div>
        </div>

        {/* Products */}

<div className="flex-1 overflow-y-auto p-4 scrollbar-thin bg-slate-50">

  {loadingProducts ? (
    <div className="flex h-full flex-col items-center justify-center text-slate-400">
      <RefreshCw className="mb-3 h-7 w-7 animate-spin" />

      <p className="text-sm font-medium">
        Loading products...
      </p>
    </div>

  ) : search.trim() && searching ? (

    <div className="flex h-40 items-center justify-center text-slate-400">
      <RefreshCw className="mr-2 h-5 w-5 animate-spin" />

      <span className="text-sm">
        Searching...
      </span>
    </div>

  ) : search.trim() ? (

    searchResults.length === 0 ? (

      <EmptyState
        icon={<Search className="h-8 w-8" />}
        title="No products found"
        description="Try another product name, SKU, or variant."
      />

    ) : (

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">

        {searchResults.map((result) => {

          /*
           * SEARCH RESULT → POS PRODUCT
           */
          const searchProduct: POSProduct = {
            id:
              result.type === 'variant'
                ? `${result.product_id}-variant-${result.variant_id}`
                : String(result.product_id),

            name:
              result.type === 'variant'
                ? `${result.product_name} — ${result.variant_name}`
                : result.product_name,

            sku: result.sku,

            barcode: result.sku,

            categoryId: '',

            categoryName:
              result.category_name ??
              undefined,

            price:
              Number(result.price ?? 0),

            cost:
              Number(result.cost ?? 0),

            stock:
              Number(
                result.stock_quantity ?? 0
              ),

            reorderLevel:
              Number(
                result.low_stock_threshold ?? 5
              ),

            image: result.image_url ?? '',

            hasVariants: false,
            variantCount: 0,

            parentProductId:
              result.type === 'variant'
                ? String(result.product_id)
                : undefined,

            variantId:
              result.type === 'variant'
                ? String(result.variant_id)
                : undefined,

            variantName:
              result.type === 'variant'
                ? result.variant_name ?? undefined
                : undefined,
          };

          return (
            <div
              key={
                result.type === 'variant'
                  ? `variant-${result.variant_id}`
                  : `product-${result.product_id}`
              }
              className="relative"
            >

              <ProductCard
                product={searchProduct}
                onAdd={() => {

                  /*
                   * Exact variant result
                   */
                  if (
                    result.type ===
                    'variant'
                  ) {
                    addToCart(
                      searchProduct
                    );

                    setSearch('');

                    return;
                  }

                  /*
                   * Normal product result
                   */
                  const originalProduct =
                    products.find(
                      (product) =>
                        product.id ===
                        String(
                          result.product_id
                        )
                    );

                  if (originalProduct) {
                    handleProductClick(
                      originalProduct
                    );
                  }

                  setSearch('');
                }}
              />

              {result.type === 'variant' && (
                <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-brand-600 px-2 py-1 text-[10px] font-semibold text-white shadow-sm">
                  {result.variant_name}
                </span>
              )}

            </div>
          );
        })}

      </div>
    )

  ) : filteredProducts.length === 0 ? (

    <EmptyState
      icon={<Package className="h-8 w-8" />}
      title="No products found"
      description="Try a different category."
    />

  ) : (

    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">

      {filteredProducts.map(
        (product) => (
          <div
            key={product.id}
            className="relative"
          >

            <ProductCard
              product={product}
              onAdd={() =>
                handleProductClick(
                  product
                )
              }
            />

            {product.hasVariants && (
              <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-brand-600 px-2 py-1 text-[10px] font-semibold text-white shadow-sm">
                {product.variantCount}{' '}
                variant
                {product.variantCount === 1
                  ? ''
                  : 's'}
              </div>
            )}

          </div>
        )
      )}

    </div>
  )}
</div>
</div>
      {/* =====================================================
    DESKTOP CART
    ===================================================== */}

{desktopCartOpen && cart.length > 0 && (
  <div className="
    hidden lg:flex
    flex-col
    w-80 xl:w-96
    shrink-0
    bg-white
    border-l border-slate-200
    animate-slide-in-right
  ">
    <CartPanel
  cart={cart}
  subtotal={subtotal}
  discount={discount}
  discountPercent={discountPercent}
  total={total}
  totalItems={totalItems}
      onUpdateQty={updateQty}
      onRemoveLine={removeLine}
      onClear={clearCart}
      onCheckout={() =>
        setCheckoutOpen(true)
      }
      onCollapse={() =>
    setDesktopCartOpen(false)
      }
    />
  </div>
)}
{/* Desktop collapsed cart button */}

{!desktopCartOpen && (
  <button
    type="button"
    onClick={() => {
  if (cart.length > 0) {
    setDesktopCartOpen(true);
  } else {
    toast(
      'Your cart is empty.',
      'info'
    );
  }
}}
    className="
      hidden lg:flex
      fixed
      right-6
      bottom-6
      z-30
      h-14 w-14
      items-center
      justify-center
      rounded-full
      bg-brand-600
      text-white
      shadow-lg
      transition-all
      hover:bg-brand-700
      hover:scale-105
    "
    title="Cart"
  >
    <ShoppingCart className="h-6 w-6" />

    {totalItems > 0 && (
      <span className="
        absolute
        -right-1
        -top-1
        flex
        h-6 min-w-6
        items-center
        justify-center
        rounded-full
        bg-danger-500
        px-1.5
        text-[11px]
        font-bold
        text-white
      ">
        {totalItems}
      </span>
    )}
  </button>
)}

      {/* =====================================================
          MOBILE CART BUTTON
          ===================================================== */}

      {cart.length > 0 && (
        <button
          onClick={() =>
            setMobileCartOpen(
              true
            )
          }
          className="lg:hidden fixed bottom-20 sm:bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-brand-600 text-white px-5 h-14 shadow-pop hover:bg-brand-700 transition-colors"
        >
          <ShoppingCart className="h-5 w-5" />

          <span className="font-semibold">
            {totalItems}
          </span>

          <span className="text-sm font-bold tabular-nums">
            {formatCurrency(
              total
            )}
          </span>
        </button>
      )}

      {/* =====================================================
          MOBILE CART DRAWER
          ===================================================== */}

      {mobileCartOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">

          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() =>
              setMobileCartOpen(
                false
              )
            }
          />

          <div className="relative ml-auto w-full max-w-sm bg-white flex flex-col animate-slide-in-right pb-20 sm:pb-0">

            <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200">

              <h3 className="font-bold text-slate-900">
                Cart
              </h3>

              <button
                onClick={() =>
                  setMobileCartOpen(
                    false
                  )
                }
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>

            </div>

            <CartPanel
              cart={cart}
              subtotal={subtotal}
              discount={
                discount
              }
              discountPercent={discountPercent}
              total={total}
              totalItems={
                totalItems
              }
              onUpdateQty={
                updateQty
              }
              onRemoveLine={
                removeLine
              }
              onClear={
                clearCart
              }
              onCheckout={() => {
                setMobileCartOpen(
                  false
                );

                setCheckoutOpen(
                  true
                );
              }}
              noHeader
            />

          </div>
        </div>
      )}


      {/* =====================================================
    WIRELESS PHONE SCANNER
    ===================================================== */}

<Modal
  open={phoneScannerModalOpen}
  onClose={() =>
    setPhoneScannerModalOpen(false)
  }
  title="Connect Phone Scanner"
  description="Use your phone as a wireless barcode scanner."
  size="sm"
>
  <div className="space-y-5">

    {/* QR CODE */}

    <div className="flex justify-center">
      <div
        className="
          flex
          min-h-[250px]
          w-full
          max-w-[280px]
          items-center
          justify-center
          rounded-2xl
          border
          border-slate-200
          bg-white
          p-4
        "
      >
        {phoneScannerQr ? (
          <img
            src={phoneScannerQr}
            alt="Phone scanner pairing QR code"
            className="
              h-auto
              w-full
              max-w-[240px]
            "
          />
        ) : (
          <div
            className="
              flex
              flex-col
              items-center
              gap-3
              text-slate-400
            "
          >
            <RefreshCw className="h-6 w-6 animate-spin" />

            <p className="text-sm">
              Generating QR code...
            </p>
          </div>
        )}
      </div>
    </div>

    {/* STATUS */}

    <div
      className={`
        flex
        items-center
        justify-center
        gap-2
        rounded-xl
        border
        px-4
        py-3

        ${
          wirelessScannerConnected
            ? `
                border-emerald-200
                bg-emerald-50
                text-emerald-700
              `
            : `
                border-slate-200
                bg-slate-50
                text-slate-600
              `
        }
      `}
    >
      <span
        className={`
          h-2.5
          w-2.5
          rounded-full

          ${
            wirelessScannerConnected
              ? 'bg-emerald-500'
              : 'bg-amber-400 animate-pulse'
          }
        `}
      />

      <span className="text-sm font-semibold">
        {wirelessScannerConnected
          ? 'Phone scanner connected'
          : 'Waiting for phone...'}
      </span>
    </div>

    {/* INSTRUCTIONS */}

    <div className="text-center">
      <p
        className="
          text-sm
          font-medium
          text-slate-700
        "
      >
        Scan this QR code with your phone
      </p>

      <p
        className="
          mt-1
          text-xs
          leading-5
          text-slate-500
        "
      >
        Your phone will open the CapyTech
        wireless barcode scanner.
      </p>
    </div>

    {/* ERROR */}

    {wirelessScannerError && (
      <div
        className="
          rounded-lg
          border
          border-red-200
          bg-red-50
          px-3
          py-2
          text-sm
          text-red-700
        "
      >
        {wirelessScannerError}
      </div>
    )}

    {/* DEVELOPMENT URL */}

    {phoneScannerUrl && (
      <div
        className="
          rounded-lg
          bg-slate-50
          px-3
          py-2
        "
      >
        <p
          className="
            mb-1
            text-[10px]
            font-semibold
            uppercase
            tracking-wide
            text-slate-400
          "
        >
          Scanner URL
        </p>

        <p
          className="
            break-all
            font-mono
            text-[11px]
            text-slate-500
          "
        >
          {phoneScannerUrl}
        </p>
      </div>
    )}

    {/* CLOSE */}

    <div className="flex justify-end">
      <Button
        variant="outline"
        onClick={() =>
          setPhoneScannerModalOpen(false)
        }
      >
        Close
      </Button>
    </div>

  </div>
</Modal>

      <Modal
  open={scannerOpen}
  onClose={closeScanner}
  title="Scan Barcode"
  description="Point the camera at a product barcode."
  size="sm"
>
  <div className="space-y-4">
    <div
      className="
        relative
        overflow-hidden
        rounded-xl
        bg-black
        aspect-[4/3]
      "
    >
      <video
        ref={scannerVideoRef}
        className="
          h-full
          w-full
          object-cover
        "
        muted
        playsInline
      />

      <div
        className="
          pointer-events-none
          absolute
          inset-6
          rounded-xl
          border-2
          border-white/80
        "
      />

      <div
        className="
          pointer-events-none
          absolute
          left-10
          right-10
          top-1/2
          h-0.5
          -translate-y-1/2
          bg-red-500
        "
      />
    </div>

    {scannerStarting && (
      <p className="text-center text-sm text-slate-500">
        Starting camera...
      </p>
    )}

    {scannerError && (
      <div
        className="
          rounded-lg
          border
          border-red-200
          bg-red-50
          px-3
          py-2
          text-sm
          text-red-700
        "
      >
        {scannerError}
      </div>
    )}

    <p className="text-center text-xs text-slate-500">
      Supports your generated product and variant barcodes.
    </p>

    <div className="flex justify-end">
      <Button
        variant="outline"
        onClick={closeScanner}
      >
        Cancel
      </Button>
    </div>
  </div>
</Modal>

<Modal
  open={Boolean(scannedProduct)}
  onClose={() =>
    setScannedProduct(null)
  }
  title="Scanned Product"
  description="Confirm the scanned item before adding it to the cart."
  size="sm"
>
  {scannedProduct && (
    <div className="space-y-3 sm:space-y-5">

      <div
        className="
          rounded-xl
          border
          border-slate-200
          bg-slate-50
          p-4
        "
      >
        <div className="flex gap-4">

          {scannedProduct.product.image && (
            <img
              src={
                scannedProduct.product.image
              }
              alt={
                scannedProduct.product.name
              }
              className="
                h-20
                w-20
                shrink-0
                rounded-lg
                border
                border-slate-200
                bg-white
                object-contain
                p-1
              "
            />
          )}

          <div className="min-w-0 flex-1">

            <p
              className="
                font-bold
                text-slate-900
              "
            >
              {
                scannedProduct.product.name
              }
            </p>

            <div className="mt-2 space-y-1 text-sm">

              {scannedProduct.product.variantName && (
                <p className="text-slate-600">
                  Variant:{' '}
                  <span className="font-semibold capitalize text-slate-900">
                    {
                      scannedProduct.product.variantName
                    }
                  </span>
                </p>
              )}

              <p className="text-slate-600">
                SKU:{' '}
                <span className="font-mono font-semibold text-slate-900">
                  {
                    scannedProduct.product.sku
                  }
                </span>
              </p>

              <p className="text-slate-600">
                Stock:{' '}
                <span className="font-semibold text-slate-900">
                  {
                    scannedProduct.product.stock
                  }
                </span>
              </p>

              {scannedProductInCart > 0 && (
                <p className="text-slate-600">
                  In Cart:{' '}
                  <span className="font-semibold text-brand-600">
                    {
                      scannedProductInCart
                    }
                  </span>
                </p>
              )}

              <p className="text-slate-600">
                Available:{' '}
                <span
                  className={
                    scannedProductAvailable > 0
                      ? 'font-semibold text-emerald-600'
                      : 'font-semibold text-red-600'
                  }
                >
                  {
                    scannedProductAvailable
                  }
                </span>
              </p>

            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">

        <Button
          variant="outline"
          onClick={() => {
            setScannedProduct(null);

            /*
             * Re-open the desktop camera only
             * when this scan came from it.
             *
             * For wireless / USB scans,
             * simply close the confirmation.
             */
            if (scannerOpen) {
              setScannerOpen(true);
            }
          }}
        >
          Scan Again
        </Button>

        <Button
          disabled={
            scannedProductAvailable <= 0
          }
          onClick={() => {
            if (
              scannedProductAvailable <= 0
            ) {
              return;
            }

            addToCart(
              scannedProduct.product
            );

            setScannedProduct(null);
          }}
        >
          {scannedProductAvailable <= 0
            ? 'Out of Stock'
            : 'Add to Cart'}
        </Button>

      </div>
    </div>
  )}
</Modal>

      {/* =====================================================
          VARIANT PICKER
          ===================================================== */}

      <Modal
        open={
          variantPickerOpen
        }
        onClose={() => {
          setVariantPickerOpen(
            false
          );

          setVariantProduct(
            null
          );
        }}
        title="Choose Variant"
        description={
          variantProduct
            ? variantProduct.name
            : undefined
        }
        size="sm"
      >
        {loadingVariants ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />

            Loading variants...
          </div>
        ) : variantProduct ? (
          <div className="space-y-2">

            {(
              productVariants[
                variantProduct.id
              ] ?? []
            ).map(
              (variant) => {
                const stock =
                  Number(
                    variant.stock_quantity ??
                      0
                  );

                const price =
                  variant.price ===
                    null ||
                  variant.price ===
                    undefined
                    ? variantProduct.price
                    : Number(
                        variant.price
                      );

                return (
                  <button
                    type="button"
                    key={
                      variant.id
                    }
                    disabled={
                      stock <= 0
                    }
                    onClick={() =>
                      addVariantToCart(
                        variantProduct,
                        variant
                      )
                    }
                    className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                      stock <= 0
                        ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed'
                        : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40'
                    }`}
                  >
                    <div>
                      <p className="font-semibold capitalize text-slate-900">
                        {
                          variant.name
                        }
                      </p>

                      <p className="mt-1 font-mono text-xs text-slate-400">
                        {
                          variant.sku
                        }
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-bold text-slate-900">
                        {formatCurrency(
                          price
                        )}
                      </p>

                      <p
                        className={`mt-1 text-xs font-medium ${
                          stock <=
                          0
                            ? 'text-danger-500'
                            : 'text-slate-500'
                        }`}
                      >
                        {stock}{' '}
                        in stock
                      </p>
                    </div>
                  </button>
                );
              }
            )}

          </div>
        ) : null}
      </Modal>

      {/* =====================================================
    CHECKOUT
    ===================================================== */}

<Modal
  open={checkoutOpen}
  compactMobile
  onClose={() => {
    setCheckoutOpen(false);
    setPaymentVerified(false);
  }}
  title="Complete Sale"
  description={`${totalItems} ${
    totalItems === 1 ? 'item' : 'items'
  } • ${formatCurrency(subtotal)}`}
  footer={
    <>
      <Button
        variant="outline"
        onClick={() => {
          setCheckoutOpen(false);
          setPaymentVerified(false);
        }}
      >
        Cancel
      </Button>

      <Button
  variant="success"
  onClick={completeSale}
  disabled={
    paymentMethod !== 'cash' &&
    !paymentVerified
  }
  leftIcon={
    <CheckCircle2 className="h-4 w-4" />
  }
>
  Confirm {formatCurrency(total)}
</Button>
    </>
  }
>
  <div className="space-y-3 sm:space-y-5">

   {/* =====================================================
    CUSTOMER
    ===================================================== */}

<div>
  <div className="mb-2 flex items-center justify-between">
    <p className="text-sm font-semibold text-slate-700">
      Customer
    </p>

    <button
      type="button"
      onClick={() => {
  setCustomerPickerOpen(false);
  setNewCustomerOpen(true);
}}
      className="
        text-xs font-semibold
        text-brand-600
        hover:text-brand-700
      "
    >
      + Customer Details
    </button>
  </div>

  <div className="relative">
    <button
      type="button"
      onClick={() =>
        setCustomerPickerOpen(
          !customerPickerOpen
        )
      }
      className="
        flex h-11 sm:h-12 w-full
        items-center justify-between
        rounded-xl border
        border-slate-200 bg-white
        px-4 text-left
        transition-colors
        hover:border-slate-300
      "
    >
      <div className="min-w-0 flex-1">
  {invoiceCustomer.name.trim() ? (
    <>
      <p className="truncate text-sm font-medium text-slate-900">
        {invoiceCustomer.name}
      </p>

      {invoiceCustomer.phone.trim() && (
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {invoiceCustomer.phone}
        </p>
      )}
    </>
  ) : (
    <>
      <p className="truncate text-sm font-medium text-slate-900">
        Walk-in Customer
      </p>

      <p className="mt-0.5 truncate text-xs text-slate-400">
        No customer information
      </p>
    </>
  )}
</div>

      <Icons.ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
    </button>

    {customerPickerOpen && (
      <div
        className="
          absolute left-0 right-0 top-full
          z-50 mt-2
          overflow-hidden
          rounded-xl border
          border-slate-200
          bg-white shadow-xl
        "
      >
        <div className="border-b border-slate-100 p-2">
          <div className="relative">
            <Search
              className="
                absolute left-3 top-1/2
                h-4 w-4
                -translate-y-1/2
                text-slate-400
              "
            />

            <input
              value={customerSearch}
              onChange={(event) =>
                setCustomerSearch(
                  event.target.value
                )
              }
              placeholder="Search name or phone..."
              className="
                h-10 w-full
                rounded-lg border
                border-slate-200
                bg-slate-50
                pl-9 pr-3
                text-sm
                outline-none
                focus:border-brand-500
                focus:bg-white
                focus:ring-2
                focus:ring-brand-500/20
              "
            />
          </div>
        </div>

        <div className="max-h-56 overflow-y-auto p-1">

          {/* Walk-in */}
          <button
            type="button"
            onClick={() => {
  setSelectedCustomer(null);

  setInvoiceCustomer({
    name: '',
    phone: '',
    email: '',
    address: '',
  });

  setSaveCustomer(false);

  setCustomerPickerOpen(false);
  setCustomerSearch('');
}}
            className="
              flex w-full items-center
              rounded-lg px-3 py-2.5
              text-left
              hover:bg-slate-50
            "
          >
            <div>
              <p className="text-sm font-medium text-slate-900">
                Walk-in Customer
              </p>

              <p className="mt-0.5 text-xs text-slate-400">
                No customer information
              </p>
            </div>
          </button>

          {customers
            .filter((customer) => {
              const term =
                customerSearch
                  .trim()
                  .toLowerCase();

              if (!term) {
                return true;
              }

              return (
                customer.name
                  .toLowerCase()
                  .includes(term) ||
                (customer.phone ?? '')
                  .toLowerCase()
                  .includes(term) ||
                (customer.email ?? '')
                  .toLowerCase()
                  .includes(term)
              );
            })
            .map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => {
  setSelectedCustomer(
    customer
  );

  setInvoiceCustomer({
    name:
      customer.name ?? '',

    phone:
      customer.phone ?? '',

    email:
      customer.email ?? '',

    address:
      customer.address ?? '',
  });

  setCustomerPickerOpen(
    false
  );

  setCustomerSearch('');
}}
                className="
                  flex w-full items-center
                  justify-between
                  rounded-lg px-3 py-2.5
                  text-left
                  hover:bg-slate-50
                "
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {customer.name}
                  </p>

                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {customer.phone ||
                      customer.email ||
                      'No contact details'}
                  </p>
                </div>

                {selectedCustomer &&
                  String(
                    selectedCustomer.id
                  ) ===
                    String(
                      customer.id
                    ) && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" />
                  )}
              </button>
            ))}

          {customers.filter((customer) => {
            const term =
              customerSearch
                .trim()
                .toLowerCase();

            return (
              !term ||
              customer.name
                .toLowerCase()
                .includes(term) ||
              (customer.phone ?? '')
                .toLowerCase()
                .includes(term) ||
              (customer.email ?? '')
                .toLowerCase()
                .includes(term)
            );
          }).length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-slate-400">
                No customers found.
              </p>
            </div>
          )}
        </div>
      </div>
    )}
  </div>
</div>

   {/* =====================================================
    PAYMENT METHOD
    ===================================================== */}

<div>
  <div className="mb-2 flex items-center justify-between">
    <p className="text-sm font-semibold text-slate-700">
      Payment Method
    </p>

    <span className="text-xs font-medium text-slate-400">
      Select how the customer paid
    </span>
  </div>

  {/* Payment Buttons */}
  <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
    {[
      {
        key: 'cash',
        label: 'Cash',
        icon: Banknote,
      },
      {
        key: 'banking',
        label: 'Banking',
        icon: Landmark,
      },
      {
        key: 'kbzpay',
        label: 'KBZPay',
        icon: QrCode,
      },
      {
        key: 'wavepay',
        label: 'WavePay',
        icon: QrCode,
      },
      {
        key: 'mmqr',
        label: 'MMQR',
        icon: QrCode,
      },
    ].map((method) => {
      const Icon = method.icon;
      const active =
        paymentMethod === method.key;

      return (
        <button
          type="button"
          key={method.key}
          onClick={() => {
  setPaymentMethod(
    method.key as Sale['paymentMethod']
  );

  setPaymentVerified(
    method.key === 'cash'
  );
}}
          className={`
  flex h-[58px] sm:h-20 flex-col
  items-center justify-center
  gap-1 sm:gap-2
  rounded-lg sm:rounded-xl border
  transition-all duration-150
  ${
    active
      ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500'
      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
  }
`}
        >
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />

<span className="text-[10px] sm:text-xs font-semibold leading-none">
            {method.label}
          </span>
        </button>
      );
    })}
  </div>

  {/* =====================================================
      QR PAYMENT
      ===================================================== */}

  {(
    paymentMethod === 'kbzpay' ||
    paymentMethod === 'wavepay' ||
    paymentMethod === 'mmqr'
  ) && (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">

      {/* QR Header */}
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">

          <div>
            <p className="text-sm font-semibold text-slate-900">
              {paymentMethod === 'kbzpay'
                ? 'KBZPay Payment'
                : paymentMethod === 'wavepay'
                ? 'WavePay Payment'
                : 'MMQR Payment'}
            </p>

            <p className="mt-0.5 text-xs text-slate-500">
              Ask the customer to scan the QR code
            </p>
          </div>

          <QrCode className="h-5 w-5 text-brand-600" />

        </div>
      </div>

      {/* QR */}
      <div className="flex flex-col items-center px-3 py-3 sm:px-4 sm:py-4">

        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <img
            src={
              paymentMethod === 'kbzpay'
                ? '/payments/kbzpay-qr.png'
                : paymentMethod === 'wavepay'
                ? '/payments/wavepay-qr.png'
                : '/payments/mmqr-qr.png'
            }
            alt={
              paymentMethod === 'kbzpay'
                ? 'KBZPay QR'
                : paymentMethod === 'wavepay'
                ? 'WavePay QR'
                : 'MMQR QR'
            }
            className="h-32 w-32 sm:h-44 sm:w-44 object-contain"
          />
        </div>

        {/* Amount */}
        <div className="mt-3 text-center">

          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Amount to Pay
          </p>

          <p className="mt-1 text-2xl font-bold text-brand-600 tabular-nums">
            {formatCurrency(total)}
          </p>

        </div>

        <p className="mt-2 text-xs text-slate-500">
          Verify that payment has been received before confirming the sale.
        </p>

      </div>
    </div>
  )}

  {/* Banking Information */}
  {paymentMethod === 'banking' && (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">

      <div className="flex items-start gap-3">

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 shadow-sm">
          <Landmark className="h-4 w-4" />
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-900">
            Bank Transfer
          </p>

          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            Confirm that the transfer has been received before completing the sale.
          </p>
        </div>

      </div>
    </div>
  )}
</div>

{paymentMethod !== 'cash' && (
  <button
    type="button"
    onClick={() =>
      setPaymentVerified(
        !paymentVerified
      )
    }
    className={`mt-4 flex w-full items-center justify-between rounded-xl border px-4 py-3 transition-all ${
      paymentVerified
        ? 'border-success-300 bg-success-50'
        : 'border-slate-200 bg-white hover:bg-slate-50'
    }`}
  >
    <div className="text-left">
      <p className="text-sm font-semibold text-slate-900">
        Payment received
      </p>

      <p className="mt-0.5 text-xs text-slate-500">
        Confirm after checking the payment.
      </p>
    </div>

    <div
      className={`flex h-6 w-6 items-center justify-center rounded-full border ${
        paymentVerified
          ? 'border-success-600 bg-success-600 text-white'
          : 'border-slate-300 bg-white'
      }`}
    >
      {paymentVerified && (
        <CheckCircle2 className="h-4 w-4" />
      )}
    </div>
  </button>
)}

    {/* Discount */}
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          Discount
        </p>

        {discountPercent > 0 && (
          <span className="text-xs font-semibold text-brand-600">
            {discountPercent}% applied
          </span>
        )}
      </div>

      <div className="grid grid-cols-5 gap-2">
        {[0, 5, 10, 15, 20].map(
          (percent) => (
            <button
              type="button"
              key={percent}
              onClick={() =>
                applyDiscountPercent(
                  percent
                )
              }
              className={`h-9 sm:h-10 rounded-lg border text-xs sm:text-sm font-semibold transition-all ${
                discountPercent === percent
                  ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {percent === 0
                ? 'None'
                : `${percent}%`}
            </button>
          )
        )}
      </div>
    </div>

    {/* Summary */}
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Subtotal
        </span>

        <span className="font-semibold text-slate-900 tabular-nums">
          {formatCurrency(subtotal)}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Discount
          {discountPercent > 0 && (
            <span className="ml-1 text-xs">
              ({discountPercent}%)
            </span>
          )}
        </span>

        <span
          className={`font-semibold tabular-nums ${
            discount > 0
              ? 'text-danger-600'
              : 'text-slate-500'
          }`}
        >
          {discount > 0
            ? `-${formatCurrency(discount)}`
            : formatCurrency(0)}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
        <span className="text-base font-bold text-slate-900">
          Total
        </span>

        <span className="text-2xl font-bold text-brand-600 tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>

    </div>
  </div>
</Modal>

{/* =====================================================
    INVOICE CUSTOMER DETAILS
    ===================================================== */}

<Modal
  open={newCustomerOpen}
  onClose={() => {
    setNewCustomerOpen(false);
  }}
  title="Customer Details"
  description="Add customer details for this invoice."
  size="sm"
  footer={
    <>
      <Button
        variant="outline"
        onClick={() => {
          setNewCustomerOpen(false);
        }}
      >
        Cancel
      </Button>

      <Button
        onClick={() => {
          setNewCustomerOpen(false);

          toast(
            invoiceCustomer.name.trim()
              ? 'Customer details added to invoice.'
              : 'Invoice will use walk-in customer.',
            'success'
          );
        }}
      >
        Use for Invoice
      </Button>
    </>
  }
>
  <div className="space-y-4">

    {/* Customer Name */}
    <div>
      <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
        <span>Customer Name</span>

        <span className="text-xs font-normal text-slate-400">
          Optional
        </span>
      </label>

      <input
        value={invoiceCustomer.name}
        onChange={(event) =>
          setInvoiceCustomer(
            (current) => ({
              ...current,
              name:
                event.target.value,
            })
          )
        }
        placeholder="Enter customer name"
        autoComplete="off"
        className="
          h-11 w-full rounded-lg
          border border-slate-300
          bg-white px-3
          text-sm text-slate-900
          outline-none
          focus:border-brand-500
          focus:ring-2
          focus:ring-brand-500/20
        "
      />
    </div>

    {/* Phone */}
    <div>
      <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
        <span>Phone</span>

        <span className="text-xs font-normal text-slate-400">
          Optional
        </span>
      </label>

      <input
        type="tel"
        value={invoiceCustomer.phone}
        onChange={(event) =>
          setInvoiceCustomer(
            (current) => ({
              ...current,
              phone:
                event.target.value,
            })
          )
        }
        placeholder="09xxxxxxxxx"
        autoComplete="off"
        className="
          h-11 w-full rounded-lg
          border border-slate-300
          bg-white px-3
          text-sm text-slate-900
          outline-none
          focus:border-brand-500
          focus:ring-2
          focus:ring-brand-500/20
        "
      />
    </div>

    {/* Address */}
    <div>
      <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
        <span>Address</span>

        <span className="text-xs font-normal text-slate-400">
          Optional
        </span>
      </label>

      <textarea
        value={invoiceCustomer.address}
        onChange={(event) =>
          setInvoiceCustomer(
            (current) => ({
              ...current,
              address:
                event.target.value,
            })
          )
        }
        placeholder="Customer address"
        rows={2}
        className="
          w-full resize-none rounded-lg
          border border-slate-300
          bg-white px-3 py-2.5
          text-sm text-slate-900
          outline-none
          focus:border-brand-500
          focus:ring-2
          focus:ring-brand-500/20
        "
      />
    </div>

    {/* Email */}
    <div>
      <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
        <span>Email</span>

        <span className="text-xs font-normal text-slate-400">
          Optional
        </span>
      </label>

      <input
        type="email"
        value={invoiceCustomer.email}
        onChange={(event) =>
          setInvoiceCustomer(
            (current) => ({
              ...current,
              email:
                event.target.value,
            })
          )
        }
        placeholder="customer@example.com"
        autoComplete="off"
        className="
          h-11 w-full rounded-lg
          border border-slate-300
          bg-white px-3
          text-sm text-slate-900
          outline-none
          focus:border-brand-500
          focus:ring-2
          focus:ring-brand-500/20
        "
      />
    </div>

    {/* Save customer option */}
    <label
      className="
        flex cursor-pointer items-start gap-3
        rounded-xl border border-slate-200
        bg-slate-50 px-3 py-3
      "
    >
      <input
        type="checkbox"
        checked={saveCustomer}
        onChange={(event) =>
          setSaveCustomer(
            event.target.checked
          )
        }
        className="
          mt-0.5 h-4 w-4
          rounded border-slate-300
        "
      />

      <div>
        <p className="text-sm font-semibold text-slate-800">
          Save customer
        </p>

        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          Save this customer for future purchases and warranty lookup.
        </p>
      </div>
    </label>

  </div>
</Modal>

      {/* =====================================================
    SALE COMPLETED
    ===================================================== */}

<Modal
  open={receiptOpen}
  onClose={() =>
    setReceiptOpen(false)
  }
  title="Sale Completed"
  size="sm"
  footer={
    <div className="grid w-full grid-cols-2 gap-3">
      <Button
  variant="outline"
  onClick={() => {
    if (!lastSale) {
      return;
    }

    window.open(
      `/invoice/${lastSale.id}`,
      '_blank'
    );
  }}
>
  View Invoice
</Button>
    </div>
  }
>
  {lastSale && (
    <div className="py-3">

      <div className="text-center">

        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-100 text-success-600">
          <CheckCircle2 className="h-9 w-9" />
        </div>

        <p className="text-xl font-bold text-slate-900">
          {lastSale.invoice}
        </p>

        <p className="mt-1 text-sm text-slate-500">
          {new Date(
            lastSale.date
          ).toLocaleString(
            'en-GB',
            {
              dateStyle: 'medium',
              timeStyle: 'short',
            }
          )}
        </p>

      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">

        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Items
          </span>

          <span className="font-semibold text-slate-900">
            {lastSale.items.reduce(
              (sum, item) =>
                sum + item.quantity,
              0
            )}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Payment
          </span>

          <span className="font-semibold capitalize text-slate-900">
            {lastSale.paymentMethod}
          </span>
        </div>

        {lastSale.discount > 0 && (
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Discount
            </span>

            <span className="font-semibold text-danger-600">
              -{formatCurrency(
                lastSale.discount
              )}
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">

          <span className="font-bold text-slate-900">
            Total
          </span>

          <span className="text-2xl font-bold text-brand-600 tabular-nums">
            {formatCurrency(
              lastSale.total
            )}
          </span>

        </div>

      </div>

      <div className="mt-4 text-center">
        <p className="text-xs text-slate-400">
          Cashier: {lastSale.cashierName}
        </p>
      </div>

    </div>
  )}
</Modal>

    </div>
  );
}

/* =========================================================
   CART PANEL
   ========================================================= */

interface CartPanelProps {
  cart: CartLine[];
  subtotal: number;
  discount: number;
  discountPercent: number;
  total: number;
  totalItems: number;

  onUpdateQty: (
    id: string,
    delta: number
  ) => void;

  onRemoveLine: (
    id: string
  ) => void;

  onClear: () => void;
  onCheckout: () => void;
  onCollapse?: () => void;

  noHeader?: boolean;
}

function CartPanel({
  cart,
  subtotal,
  discount,
  discountPercent,
  total,
  totalItems,
  onUpdateQty,
  onRemoveLine,
  onClear,
  onCheckout,
  onCollapse,
  noHeader,
}: CartPanelProps) {
  return (
    <>
      {!noHeader && (
  <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 shrink-0">

    <div className="flex items-center gap-2">

      <ShoppingCart className="h-5 w-5 text-brand-600" />

      <h3 className="font-bold text-slate-900">
        Cart
      </h3>

      <span className="rounded-full bg-brand-100 text-brand-700 text-xs font-bold px-2 py-0.5">
        {totalItems}
      </span>

    </div>

    <div className="flex items-center gap-3">

      {cart.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold text-slate-400 hover:text-danger-600 transition-colors"
        >
          Clear all
        </button>
      )}

      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          title="Collapse cart"
        >
          <X className="h-4 w-4" />
        </button>
      )}

    </div>

  </div>
)}

      {/* Cart Items */}

      <div
  className={`
    flex-1
    overflow-y-auto
    scrollbar-thin
  `}
>

        {cart.length ===
        0 ? (
          <EmptyState
            icon={
              <ShoppingCart className="h-8 w-8" />
            }
            title="Cart is empty"
            description="Click a product to add it to the sale."
          />
        ) : (
          <div className="p-3 space-y-2">

            {cart.map(
              (line) => (
                <div
                  key={
                    line.product.id
                  }
                  className="rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition-colors"
                >

                  <div className="flex items-start justify-between gap-2">

                    <div className="flex-1 min-w-0">

                      <p className="text-sm font-semibold text-slate-900 leading-tight line-clamp-2">
                        {
                          line
                            .product
                            .name
                        }
                      </p>

                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        {
                          line
                            .product
                            .sku
                        }
                      </p>

                    </div>

                    <button
                      onClick={() =>
                        onRemoveLine(
                          line
                            .product
                            .id
                        )
                      }
                      className="text-slate-300 hover:text-danger-500 transition-colors shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>

                  </div>

                  <div className="flex items-center justify-between mt-2.5">

                    <div className="flex items-center gap-1.5">

                      <button
                        onClick={() =>
                          onUpdateQty(
                            line
                              .product
                              .id,
                            -1
                          )
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>

                      <span className="w-8 text-center text-sm font-bold text-slate-900 tabular-nums">
                        {
                          line.quantity
                        }
                      </span>

                      <button
                        onClick={() =>
                          onUpdateQty(
                            line
                              .product
                              .id,
                            1
                          )
                        }
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>

                    </div>

                    <div className="text-right">

                      <p className="text-sm font-bold text-slate-900 tabular-nums">
                        {formatCurrency(
                          line
                            .product
                            .price *
                            line
                              .quantity
                        )}
                      </p>

                      <p className="text-xs text-slate-400 tabular-nums">
                        {formatCurrency(
                          line
                            .product
                            .price
                        )}{' '}
                        each
                      </p>

                    </div>
                  </div>
                </div>
              )
            )}

          </div>
        )}
      </div>

      {/* Totals */}

      {cart.length > 0 && (
        <div className="border-t border-slate-200 p-4 space-y-3 shrink-0 bg-white">


          <div className="space-y-1.5">

            <div className="flex justify-between text-sm">

              <span className="text-slate-500">
                Subtotal
              </span>

              <span className="font-semibold text-slate-900 tabular-nums">
                {formatCurrency(
                  subtotal
                )}
              </span>

            </div>

            <div className="flex justify-between text-sm">

              <span className="text-slate-500">
                Discount
              </span>

              <span
  className={`font-semibold tabular-nums ${
    discount > 0
      ? 'text-danger-600'
      : 'text-slate-500'
  }`}
>
  {discount > 0
    ? `-${formatCurrency(discount)}`
    : formatCurrency(0)}
</span>

            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-100">

              <span className="font-bold text-slate-900">
                Total
              </span>

              <span className="text-xl font-bold text-brand-600 tabular-nums">
                {formatCurrency(
                  total
                )}
              </span>

            </div>

          </div>

          <Button
            fullWidth
            size="lg"
            variant="success"
            onClick={onCheckout}
            leftIcon={
              <CheckCircle2 className="h-5 w-5" />
            }
          >
            Complete Sale
          </Button>

        </div>
      )}
    </>
  );
}