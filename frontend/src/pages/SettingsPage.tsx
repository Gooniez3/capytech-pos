import {
  useEffect,
  useState,
} from 'react';


import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';


import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

import { api } from '@/lib/api';

import type {
  User as UserType,
} from '@/types';

import {
  Store,
  Bell,
  Shield,
  User,
  Save,
  Eye,
  EyeOff,
} from 'lucide-react';

interface StoreSettings {
  id: number;
  storeName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: 'ks' | 'usd';
  taxRate: number;
  updatedAt: string;
}

interface NotificationPreferences {
  userId: number;
  lowStock: boolean;
  dailySalesSummary: boolean;
  newStaff: boolean;
  refundActivity: boolean;
  updatedAt: string;
}

export function SettingsPage() {
  const {
    toast,
  } = useToast();

  const {
  user,
  updateUser,
  logout,
} = useAuth();

  const [
    tab,
    setTab,
  ] =
    useState<
      | 'store'
      | 'profile'
      | 'notifications'
      | 'security'
    >(
      'store'
    );

  const [
    profileName,
    setProfileName,
  ] =
    useState(
      user?.name ?? ''
    );

  const [
    savingProfile,
    setSavingProfile,
  ] =
    useState(false);

    const [storeName, setStoreName] = useState('');
const [storePhone, setStorePhone] = useState('');
const [storeEmail, setStoreEmail] = useState('');
const [storeAddress, setStoreAddress] = useState('');
const [storeCurrency, setStoreCurrency] =
  useState<'ks' | 'usd'>('ks');

const [storeTaxRate, setStoreTaxRate] =
  useState(0);

const [loadingStore, setLoadingStore] =
  useState(true);

const [savingStore, setSavingStore] =
  useState(false);

const [
  currentPassword,
  setCurrentPassword,
] = useState('');

const [
  newPassword,
  setNewPassword,
] = useState('');

const [
  confirmPassword,
  setConfirmPassword,
] = useState('');

const [
  savingPassword,
  setSavingPassword,
] = useState(false);

const [
  showPasswords,
  setShowPasswords,
] = useState(false);

const [
  notificationPreferences,
  setNotificationPreferences,
] = useState<NotificationPreferences | null>(null);

const [
  loadingNotifications,
  setLoadingNotifications,
] = useState(true);

const [
  savingNotifications,
  setSavingNotifications,
] = useState(false);

  useEffect(() => {
    setProfileName(
      user?.name ?? ''
    );
  }, [user]);

  useEffect(() => {
  async function loadStoreSettings() {
    try {
      setLoadingStore(true);

      const settings =
        await api.get<StoreSettings>(
          '/api/settings/store'
        );

      setStoreName(
        settings.storeName ?? ''
      );

      setStorePhone(
        settings.phone ?? ''
      );

      setStoreEmail(
        settings.email ?? ''
      );

      setStoreAddress(
        settings.address ?? ''
      );

      setStoreCurrency(
        settings.currency ?? 'ks'
      );

      const loadedTaxRate =
        Number(settings.taxRate);

      setStoreTaxRate(
        loadedTaxRate === 5 ||
          loadedTaxRate === 10
          ? loadedTaxRate
          : 0
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to load store settings.',
        'error'
      );
    } finally {
      setLoadingStore(false);
    }
  }

  loadStoreSettings();
}, [toast]);


/* =========================================================
   LOAD NOTIFICATION PREFERENCES
   ========================================================= */

useEffect(() => {
  async function loadNotificationPreferences() {
    try {
      setLoadingNotifications(true);

      const preferences =
        await api.get<NotificationPreferences>(
          '/api/notifications/preferences'
        );

      setNotificationPreferences(
        preferences
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to load notification preferences.',
        'error'
      );
    } finally {
      setLoadingNotifications(false);
    }
  }

  loadNotificationPreferences();
}, [toast]);



  const tabs = [
    {
      key:
        'store' as const,

      label:
        'Store',

      icon:
        Store,
    },

    {
      key:
        'profile' as const,

      label:
        'Profile',

      icon:
        User,
    },

    {
      key:
        'notifications' as const,

      label:
        'Notifications',

      icon:
        Bell,
    },

    {
      key:
        'security' as const,

      label:
        'Security',

      icon:
        Shield,
    },
  ];

  async function handleStoreSave() {
  const cleanStoreName = storeName.trim();

  if (!cleanStoreName) {
    toast(
      'Store name is required.',
      'warning'
    );

    return;
  }

  const taxRate = storeTaxRate;

  try {
    setSavingStore(true);

    const updated =
      await api.put<StoreSettings>(
        '/api/settings/store',
        {
          storeName: cleanStoreName,
          phone: storePhone.trim(),
          email: storeEmail.trim(),
          address: storeAddress.trim(),
          currency: storeCurrency,
          taxRate,
        }
      );

    setStoreName(updated.storeName ?? '');
    setStorePhone(updated.phone ?? '');
    setStoreEmail(updated.email ?? '');
    setStoreAddress(updated.address ?? '');
    setStoreCurrency(updated.currency ?? 'ks');
    setStoreTaxRate(
      updated.taxRate === 5 ||
        updated.taxRate === 10
        ? updated.taxRate
        : 0
    );

    toast(
      'Store information updated successfully.',
      'success'
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to update store information.',
      'error'
    );
  } finally {
    setSavingStore(false);
  }
}

  /* =========================================================
     PROFILE SAVE
     ========================================================= */

  async function handleProfileSave() {
    const name =
      profileName.trim();

    if (!name) {
      toast(
        'Full name is required.',
        'warning'
      );

      return;
    }

    try {
      setSavingProfile(
        true
      );

      const updated =
        await api.patch<{
          id:
            number | string;

          name:
            string;

          username:
            string;

          role:
            UserType['role'];
        }>(
          '/api/auth/profile',
          {
            name,
          }
        );

      const updatedUser:
        UserType = {
          ...(user as UserType),

          id:
            String(
              updated.id
            ),

          name:
            updated.name,

          username:
            updated.username,

          role:
            updated.role,

          status:
            'active',
        };

      updateUser(
        updatedUser
      );

      toast(
        'Profile updated successfully.',
        'success'
      );
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Failed to update profile.',
        'error'
      );
    } finally {
      setSavingProfile(
        false
      );
    }
  }

  /* =========================================================
   PASSWORD CHANGE
   ========================================================= */

async function handlePasswordChange() {
  if (!currentPassword) {
    toast(
      'Enter your current password.',
      'warning'
    );

    return;
  }

  if (!newPassword) {
    toast(
      'Enter a new password.',
      'warning'
    );

    return;
  }

  if (newPassword.length < 8) {
    toast(
      'New password must be at least 8 characters.',
      'warning'
    );

    return;
  }

  if (newPassword !== confirmPassword) {
    toast(
      'New passwords do not match.',
      'warning'
    );

    return;
  }

  if (currentPassword === newPassword) {
    toast(
      'New password must be different from your current password.',
      'warning'
    );

    return;
  }

  try {
    setSavingPassword(true);

    await api.patch<{
      message: string;
    }>(
      '/api/auth/password',
      {
        currentPassword,
        newPassword,
      }
    );

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');

    toast(
      'Password updated successfully. Please sign in again.',
      'success'
    );

    /*
     * Give the success toast a moment to display
     * before removing the authenticated session.
     */
    window.setTimeout(
      () => {
        logout();
      },
      1200
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to update password.',
      'error'
    );
  } finally {
    setSavingPassword(false);
  }
}

  async function handleNotificationSave() {
  if (!notificationPreferences) {
    return;
  }

  try {
    setSavingNotifications(true);

    const updated =
      await api.put<NotificationPreferences>(
        '/api/notifications/preferences',
        {
          lowStock:
            notificationPreferences.lowStock,

          dailySalesSummary:
            notificationPreferences.dailySalesSummary,

          newStaff:
            notificationPreferences.newStaff,

          refundActivity:
            notificationPreferences.refundActivity,
        }
      );

    setNotificationPreferences(
      updated
    );

    toast(
      'Notification preferences saved successfully.',
      'success'
    );
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : 'Failed to save notification preferences.',
      'error'
    );
  } finally {
    setSavingNotifications(false);
  }
}

  return (
    <div className="space-y-6">

      <PageHeader
        title="Settings"
        subtitle="Manage your store and account preferences."
      />

      <div className="flex flex-col gap-6 lg:flex-row">

        {/* =====================================================
            TABS
            ===================================================== */}

        <div className="shrink-0 lg:w-56">

          <div className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col">

            {tabs.map(
              (
                item
              ) => {
                const Icon =
                  item.icon;

                const active =
                  tab ===
                  item.key;

                return (
                  <button
                    key={
                      item.key
                    }
                    type="button"
                    onClick={() =>
                      setTab(
                        item.key
                      )
                    }
                    className={`
                      flex
                      h-10
                      shrink-0
                      items-center
                      gap-2.5
                      rounded-lg
                      px-3.5
                      text-sm
                      font-medium
                      transition-colors
                      ${
                        active
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }
                    `}
                  >
                    <Icon className="h-4 w-4" />

                    {
                      item.label
                    }
                  </button>
                );
              }
            )}

          </div>

        </div>

        {/* =====================================================
            CONTENT
            ===================================================== */}

        <div className="min-w-0 flex-1">

          {/* ===================================================
              STORE
              =================================================== */}

          {tab === 'store' && (
  <Card
    title="Store Information"
    subtitle="Basic details about your store."
  >
    {loadingStore ? (
      <div className="py-8 text-center text-sm text-slate-500">
        Loading store information...
      </div>
    ) : (
      <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

          {/* Store Name */}

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Store Name
            </label>

            <input
              value={storeName}
              onChange={(event) =>
                setStoreName(event.target.value)
              }
              placeholder="Store name"
              className="
                h-10
                w-full
                rounded-lg
                border
                border-slate-300
                bg-white
                px-3
                text-sm
                text-slate-900
                outline-none
                transition
                focus:border-brand-500
                focus:ring-2
                focus:ring-brand-500/20
              "
            />
          </div>

          {/* Phone */}

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Phone Number
            </label>

            <input
              value={storePhone}
              onChange={(event) =>
                setStorePhone(event.target.value)
              }
              placeholder="Store phone number"
              className="
                h-10
                w-full
                rounded-lg
                border
                border-slate-300
                bg-white
                px-3
                text-sm
                text-slate-900
                outline-none
                transition
                focus:border-brand-500
                focus:ring-2
                focus:ring-brand-500/20
              "
            />
          </div>

          {/* Email */}

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Email
            </label>

            <input
              type="email"
              value={storeEmail}
              onChange={(event) =>
                setStoreEmail(event.target.value)
              }
              placeholder="Store email"
              className="
                h-10
                w-full
                rounded-lg
                border
                border-slate-300
                bg-white
                px-3
                text-sm
                text-slate-900
                outline-none
                transition
                focus:border-brand-500
                focus:ring-2
                focus:ring-brand-500/20
              "
            />
          </div>

          {/* Address */}

<div className="sm:col-span-2">
  <label className="mb-1.5 block text-sm font-semibold text-slate-700">
    Address
  </label>

  <textarea
    value={storeAddress}
    onChange={(event) =>
      setStoreAddress(
        event.target.value
      )
    }
    placeholder="Enter store address"
    rows={3}
    className="
      w-full
      resize-none
      rounded-lg
      border
      border-slate-300
      bg-white
      px-3
      py-2.5
      text-sm
      leading-5
      text-slate-900
      outline-none
      transition
      placeholder:text-slate-400
      focus:border-brand-500
      focus:ring-2
      focus:ring-brand-500/20
    "
  />
</div>

          {/* Currency */}

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Currency
            </label>

            <select
              value={storeCurrency}
              onChange={(event) =>
                setStoreCurrency(
                  event.target.value as 'ks' | 'usd'
                )
              }
              className="
                h-10
                w-full
                rounded-lg
                border
                border-slate-300
                bg-white
                px-3
                text-sm
                text-slate-900
                outline-none
                transition
                focus:border-brand-500
                focus:ring-2
                focus:ring-brand-500/20
              "
            >
              <option value="ks">
                Myanmar Kyat (Ks)
              </option>

              <option value="usd">
                US Dollar ($)
              </option>
            </select>
          </div>

          {/* Tax is added after discount at checkout */}

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">
              Tax Rate
            </label>

            <select
              value={String(storeTaxRate)}
              onChange={(event) => {
                const nextRate = Number(event.target.value);
                setStoreTaxRate(
                  nextRate === 5 || nextRate === 10 ? nextRate : 0
                );
              }}
              className="
                h-10
                w-full
                rounded-lg
                border
                border-slate-300
                bg-white
                px-3
                text-sm
                text-slate-900
                outline-none
                transition
                focus:border-brand-500
                focus:ring-2
                focus:ring-brand-500/20
              "
            >
              <option value="0">
                No Tax (0%)
              </option>
              <option value="5">
                5%
              </option>
              <option value="10">
                10%
              </option>
            </select>

            <p className="mt-1.5 text-xs text-slate-500">
              Tax is added after discount. The till reads this rate from the server, not the cashier screen. Old sales stay at 0%.
            </p>
          </div>

        </div>

        <div className="mt-5 flex justify-end">
          <Button
            leftIcon={
              <Save className="h-4 w-4" />
            }
            onClick={handleStoreSave}
            disabled={
              savingStore ||
              !storeName.trim()
            }
          >
            {savingStore
              ? 'Saving...'
              : 'Save Changes'}
          </Button>
        </div>
      </>
    )}
  </Card>
)}

          {/* ===================================================
              PROFILE
              =================================================== */}

          {tab ===
            'profile' && (
            <Card
              title="Profile"
              subtitle="Your personal account information."
            >

              <div className="mb-6 flex items-center gap-4">

                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700">
                  {user?.name
                    ?.charAt(
                      0
                    )
                    .toUpperCase() ??
                    'U'}
                </div>

                <div>

                  <p className="text-lg font-bold text-slate-900">
                    {
                      user?.name
                    }
                  </p>

                  <p className="text-sm capitalize text-slate-500">
                    {
                      user?.role
                    }
                  </p>

                </div>

              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                {/* Full Name */}

                <div>

                  <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Full Name
                  </label>

                  <input
                    value={
                      profileName
                    }
                    onChange={(
                      event
                    ) =>
                      setProfileName(
                        event.target
                          .value
                      )
                    }
                    placeholder="Enter your full name"
                    className="
                      h-10
                      w-full
                      rounded-lg
                      border
                      border-slate-300
                      bg-white
                      px-3
                      text-sm
                      text-slate-900
                      outline-none
                      transition
                      focus:border-brand-500
                      focus:ring-2
                      focus:ring-brand-500/20
                    "
                  />

                </div>

                {/* Username */}

                <Input
                  label="Username"
                  name="username"
                  value={
                    user?.username ??
                    ''
                  }
                  disabled
                />

                {/* Role */}

                <Input
                  label="Role"
                  name="role"
                  value={
                    user?.role ??
                    ''
                  }
                  disabled
                />

              </div>

              <div className="mt-5 flex justify-end">

                <Button
                  leftIcon={
                    <Save className="h-4 w-4" />
                  }
                  disabled={
                    savingProfile ||
                    !profileName.trim() ||
                    profileName.trim() ===
                      user?.name
                  }
                  onClick={
                    handleProfileSave
                  }
                >
                  {savingProfile
                    ? 'Saving...'
                    : 'Update Profile'}
                </Button>

              </div>

            </Card>
          )}

          {/* ===================================================
    NOTIFICATIONS
    =================================================== */}

{tab === 'notifications' && (
  <Card
    title="Notifications"
    subtitle="Choose what alerts you want to receive."
  >
    {loadingNotifications ? (
      <div className="py-8 text-center text-sm text-slate-500">
        Loading notification preferences...
      </div>
    ) : !notificationPreferences ? (
      <div className="py-8 text-center text-sm text-slate-500">
        Notification preferences could not be loaded.
      </div>
    ) : (
      <>
        <div className="space-y-4">

          {/* Low stock */}

          <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Low stock alerts
              </p>

              <p className="mt-0.5 text-xs text-slate-500">
                Get notified when products drop below reorder level
              </p>
            </div>

            <Toggle
              checked={
                notificationPreferences.lowStock
              }
              onChange={(checked) =>
                setNotificationPreferences(
                  (current) =>
                    current
                      ? {
                          ...current,
                          lowStock:
                            checked,
                        }
                      : current
                )
              }
            />
          </div>

          {/* Daily sales */}

          <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Daily sales summary
              </p>

              <p className="mt-0.5 text-xs text-slate-500">
                Receive a summary of daily sales at end of day
              </p>
            </div>

            <Toggle
              checked={
                notificationPreferences.dailySalesSummary
              }
              onChange={(checked) =>
                setNotificationPreferences(
                  (current) =>
                    current
                      ? {
                          ...current,
                          dailySalesSummary:
                            checked,
                        }
                      : current
                )
              }
            />
          </div>

          {/* New staff */}

          <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                New staff registrations
              </p>

              <p className="mt-0.5 text-xs text-slate-500">
                Alert when a new staff member joins
              </p>
            </div>

            <Toggle
              checked={
                notificationPreferences.newStaff
              }
              onChange={(checked) =>
                setNotificationPreferences(
                  (current) =>
                    current
                      ? {
                          ...current,
                          newStaff:
                            checked,
                        }
                      : current
                )
              }
            />
          </div>

          {/* Refund */}

          <div className="flex items-start justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Refund activity
              </p>

              <p className="mt-0.5 text-xs text-slate-500">
                Notify when a refund transaction is completed
              </p>
            </div>

            <Toggle
              checked={
                notificationPreferences.refundActivity
              }
              onChange={(checked) =>
                setNotificationPreferences(
                  (current) =>
                    current
                      ? {
                          ...current,
                          refundActivity:
                            checked,
                        }
                      : current
                )
              }
            />
          </div>

        </div>

        <div className="mt-5 flex justify-end">
          <Button
            leftIcon={
              <Save className="h-4 w-4" />
            }
            onClick={
              handleNotificationSave
            }
            disabled={
              savingNotifications
            }
          >
            {savingNotifications
              ? 'Saving...'
              : 'Save Preferences'}
          </Button>
        </div>
      </>
    )}
  </Card>
)}
          

          {/* ===================================================
    SECURITY
    =================================================== */}

{tab === 'security' && (
  <Card
    title="Security"
    subtitle="Change your account password."
  >
    <div className="space-y-4">

      <div>
  <label className="mb-1.5 block text-sm font-semibold text-slate-700">
    Current Password
  </label>

  <div className="relative">
    <input
      type={showPasswords ? 'text' : 'password'}
      value={currentPassword}
      onChange={(event) =>
        setCurrentPassword(event.target.value)
      }
      autoComplete="current-password"
      placeholder="Enter current password"
      className="
        h-10
        w-full
        rounded-lg
        border
        border-slate-300
        bg-white
        px-3
        pr-11
        text-sm
        text-slate-900
        outline-none
        transition
        placeholder:text-slate-400
        focus:border-brand-500
        focus:ring-2
        focus:ring-brand-500/20
      "
    />

    <button
      type="button"
      onClick={() =>
        setShowPasswords((value) => !value)
      }
      className="
        absolute
        right-3
        top-1/2
        -translate-y-1/2
        text-slate-400
        transition
        hover:text-slate-700
      "
      aria-label={
        showPasswords
          ? 'Hide passwords'
          : 'Show passwords'
      }
    >
      {showPasswords ? (
        <EyeOff className="h-5 w-5" />
      ) : (
        <Eye className="h-5 w-5" />
      )}
    </button>
  </div>
</div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          New Password
        </label>

        <input
          type={showPasswords ? 'text' : 'password'}
          value={newPassword}
          onChange={(event) =>
            setNewPassword(
              event.target.value
            )
          }
          autoComplete="new-password"
          placeholder="Minimum 8 characters"
          className="
            h-10
            w-full
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            text-sm
            text-slate-900
            outline-none
            transition
            placeholder:text-slate-400
            focus:border-brand-500
            focus:ring-2
            focus:ring-brand-500/20
          "
        />

        <p className="mt-1.5 text-xs text-slate-500">
          Use at least 8 characters.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          Confirm New Password
        </label>

        <input
          type={showPasswords ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(event) =>
            setConfirmPassword(
              event.target.value
            )
          }
          autoComplete="new-password"
          placeholder="Re-enter new password"
          className="
            h-10
            w-full
            rounded-lg
            border
            border-slate-300
            bg-white
            px-3
            text-sm
            text-slate-900
            outline-none
            transition
            placeholder:text-slate-400
            focus:border-brand-500
            focus:ring-2
            focus:ring-brand-500/20
          "
        />

        {confirmPassword &&
          newPassword !== confirmPassword && (
            <p className="mt-1.5 text-xs font-medium text-red-600">
              Passwords do not match.
            </p>
          )}
      </div>

    </div>

    <div className="mt-5 flex justify-end">

      <Button
        leftIcon={
          <Shield className="h-4 w-4" />
        }
        onClick={handlePasswordChange}
        disabled={
          savingPassword ||
          !currentPassword ||
          !newPassword ||
          !confirmPassword ||
          newPassword.length < 8 ||
          newPassword !== confirmPassword
        }
      >
        {savingPassword
          ? 'Updating...'
          : 'Update Password'}
      </Button>

    </div>
  </Card>
)}

        </div>

      </div>

    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (
    checked: boolean
  ) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() =>
        onChange(!checked)
      }
      className={`
        relative
        h-6
        w-11
        shrink-0
        rounded-full
        transition-colors
        ${
          checked
            ? 'bg-brand-600'
            : 'bg-slate-200'
        }
      `}
    >
      <span
        className={`
          absolute
          top-0.5
          h-5
          w-5
          rounded-full
          bg-white
          shadow-sm
          transition-transform
          ${
            checked
              ? 'translate-x-5'
              : 'translate-x-0.5'
          }
        `}
      />
    </button>
  );
}
