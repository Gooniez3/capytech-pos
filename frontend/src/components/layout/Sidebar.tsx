import { NavLink } from 'react-router-dom';

import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Boxes,
  Receipt,
  Users,
  BarChart3,
  Settings,
  ChevronLeft,
  LogOut,
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { RoleBadge } from '@/components/ui/StatusBadge';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const navItems = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    to: '/pos',
    label: 'POS',
    icon: ShoppingCart,
  },
  {
    to: '/products',
    label: 'Products',
    icon: Package,
  },
  {
    to: '/inventory',
    label: 'Inventory',
    icon: Boxes,
  },
  {
    to: '/sales',
    label: 'Sales',
    icon: Receipt,
  },
  {
    to: '/staff',
    label: 'Staff',
    icon: Users,
    hidden: true,
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: BarChart3,
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: Settings,
  },
];

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { user, logout } = useAuth();

  /*
   * Desktop:
   * collapsed = true  -> icon-only sidebar
   * collapsed = false -> full sidebar
   *
   * Mobile:
   * always show the full sidebar when opened.
   */
  const showFullContent =
    mobileOpen || !collapsed;

  return (
    <>
      {/* =====================================================
          MOBILE BACKDROP
          ===================================================== */}

      {mobileOpen && (
        <div
          className="
            fixed
            inset-0
            z-40
            bg-slate-900/40
            backdrop-blur-sm
            lg:hidden
          "
          onClick={onCloseMobile}
        />
      )}

      {/* =====================================================
          SIDEBAR
          ===================================================== */}

      <aside
        className={`
          fixed
          left-0
          top-0
          z-50

          flex
          h-screen
          w-64
          shrink-0
          flex-col

          bg-slate-900
          text-slate-300

          transition-all
          duration-300

          ${
            mobileOpen
              ? 'translate-x-0'
              : '-translate-x-full'
          }

          lg:sticky
          lg:translate-x-0

          ${
            collapsed
              ? 'lg:w-[72px]'
              : 'lg:w-64'
          }
        `}
      >
        {/* Logo / Brand */}
<div className="flex h-[72px] shrink-0 items-center border-b border-slate-800 px-4">
  <div className="flex min-w-0 items-center gap-3">
    {/* Logo */}
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
      <img
        src="/logo.png"
        alt="CapyTech"
        className="h-full w-full object-contain p-1.5"
      />
    </div>

    {/* Brand */}
    {showFullContent && (
      <div className="min-w-0">
        <p className="truncate text-[16px] font-semibold leading-5 tracking-tight text-white">
          CapyTech
        </p>

        <p className="mt-0.5 truncate text-[11px] font-medium tracking-wide text-slate-500">
          Retail Management
        </p>
      </div>
    )}
  </div>

  {/* Mobile close */}
  {mobileOpen && (
    <button
      type="button"
      onClick={onCloseMobile}
      className="
        ml-auto
        flex
        h-8
        w-8
        shrink-0
        items-center
        justify-center
        rounded-md
        text-slate-400
        transition-colors
        hover:bg-slate-800
        hover:text-white
        lg:hidden
      "
      aria-label="Close sidebar"
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  )}
</div>
          
        {/* =====================================================
            NAVIGATION
            ===================================================== */}

        <nav
          className="
            flex-1
            space-y-1
            overflow-y-auto
            px-3
            py-4
            scrollbar-thin
          "
        >
          {navItems
            .filter((item) => !item.hidden)
            .map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onCloseMobile}
                  className={({ isActive }) =>
                    `
                      flex
                      h-10
                      items-center
                      gap-3
                      rounded-lg
                      px-3

                      text-sm
                      font-medium

                      transition-colors

                      ${
                        isActive
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }

                      ${
                        collapsed &&
                        !mobileOpen
                          ? 'justify-center px-0'
                          : ''
                      }
                    `
                  }
                  title={
                    collapsed &&
                    !mobileOpen
                      ? item.label
                      : undefined
                  }
                >
                  <Icon
                    className="
                      h-5
                      w-5
                      shrink-0
                    "
                  />

                  {showFullContent && (
                    <span>
                      {item.label}
                    </span>
                  )}
                </NavLink>
              );
            })}
        </nav>

        {/* =====================================================
            USER AREA
            ===================================================== */}

        <div
          className="
            shrink-0
            space-y-2
            border-t
            border-slate-800
            p-3
          "
        >
          {/* User */}

          <div
            className={`
              flex
              items-center
              gap-3

              ${
                collapsed &&
                !mobileOpen
                  ? 'justify-center'
                  : ''
              }
            `}
          >
            <div
              className="
                flex
                h-9
                w-9
                shrink-0
                items-center
                justify-center

                rounded-full
                bg-slate-700

                text-sm
                font-semibold
                text-white
              "
            >
              {user?.name?.charAt(0) ?? 'U'}
            </div>

            {showFullContent && (
              <div className="min-w-0 flex-1">
                <p
                  className="
                    truncate
                    text-sm
                    font-semibold
                    text-white
                  "
                >
                  {user?.name}
                </p>

                <div className="mt-0.5">
                  {user && (
                    <RoleBadge
                      role={user.role}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Full Logout */}

          {showFullContent && (
            <button
              type="button"
              onClick={logout}
              className="
                flex
                h-9
                w-full
                items-center
                gap-3

                rounded-lg
                px-3

                text-sm
                font-medium
                text-slate-400

                transition-colors

                hover:bg-danger-600/20
                hover:text-danger-400
              "
            >
              <LogOut className="h-4 w-4" />

              <span>
                Logout
              </span>
            </button>
          )}

          {/* Desktop Collapsed Logout */}

          {collapsed &&
            !mobileOpen && (
              <button
                type="button"
                onClick={logout}
                className="
                  flex
                  h-9
                  w-full
                  items-center
                  justify-center

                  rounded-lg
                  px-3

                  text-slate-400

                  transition-colors

                  hover:bg-danger-600/20
                  hover:text-danger-400
                "
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
        </div>

        {/* =====================================================
            DESKTOP COLLAPSE TOGGLE
            ===================================================== */}

        <button
          type="button"
          onClick={onToggle}
          className="
            absolute
            -right-3
            top-20

            hidden
            h-6
            w-6
            items-center
            justify-center

            rounded-full

            border
            border-slate-200

            bg-white
            text-slate-500

            shadow-card

            transition-colors

            hover:border-brand-300
            hover:text-brand-600

            lg:flex
          "
          aria-label={
            collapsed
              ? 'Expand sidebar'
              : 'Collapse sidebar'
          }
          title={
            collapsed
              ? 'Expand sidebar'
              : 'Collapse sidebar'
          }
        >
          <ChevronLeft
            className={`
              h-4
              w-4

              transition-transform

              ${
                collapsed
                  ? 'rotate-180'
                  : ''
              }
            `}
          />
        </button>
      </aside>
    </>
  );
}