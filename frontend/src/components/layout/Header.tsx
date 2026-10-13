import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Menu,
  Bell,
  CheckCheck,
  Trash2,
} from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';

interface HeaderProps {
  onMenuClick: () => void;
  title: string;
}

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  relatedSaleId: number | null;
  createdAt: string;
}

interface NotificationResponse {
  notifications: Notification[];
  unreadCount: number;
}

export function Header({
  onMenuClick,
  title,
}: HeaderProps) {
  const { user } = useAuth();

  const [
    notifications,
    setNotifications,
  ] = useState<Notification[]>([]);

  const [
    unreadCount,
    setUnreadCount,
  ] = useState(0);

  const [
    notificationOpen,
    setNotificationOpen,
  ] = useState(false);

  const [
    loadingNotifications,
    setLoadingNotifications,
  ] = useState(false);

  const notificationRef =
    useRef<HTMLDivElement | null>(null);

  /* =========================================================
     LOAD NOTIFICATIONS
     ========================================================= */

  async function loadNotifications() {
    try {
      setLoadingNotifications(true);

      const data =
        await api.get<NotificationResponse>(
          '/api/notifications'
        );

      setNotifications(
        data.notifications
      );

      setUnreadCount(
        data.unreadCount
      );
    } catch (error) {
      console.error(
        'Failed to load notifications:',
        error
      );
    } finally {
      setLoadingNotifications(false);
    }
  }

  useEffect(() => {
  if (!user) {
    return;
  }

  // Load immediately
  loadNotifications();

  // Then refresh every 30 seconds
  const intervalId =
    window.setInterval(
      () => {
        loadNotifications();
      },
      30000
    );

  return () => {
    window.clearInterval(
      intervalId
    );
  };
}, [user]);

  /* =========================================================
     CLOSE DROPDOWN WHEN CLICKING OUTSIDE
     ========================================================= */

  useEffect(() => {
    function handleClickOutside(
      event: MouseEvent
    ) {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(
          event.target as Node
        )
      ) {
        setNotificationOpen(false);
      }
    }

    document.addEventListener(
      'mousedown',
      handleClickOutside
    );

    return () => {
      document.removeEventListener(
        'mousedown',
        handleClickOutside
      );
    };
  }, []);

  /* =========================================================
     MARK ONE AS READ
     ========================================================= */

  async function markAsRead(
    notification: Notification
  ) {
    if (notification.isRead) {
      return;
    }

    try {
      await apiRequestPatch(
        `/api/notifications/${notification.id}/read`
      );

      setNotifications(
        (current) =>
          current.map((item) =>
            item.id === notification.id
              ? {
                  ...item,
                  isRead: true,
                }
              : item
          )
      );

      setUnreadCount(
        (current) =>
          Math.max(0, current - 1)
      );
    } catch (error) {
      console.error(
        'Failed to mark notification as read:',
        error
      );
    }
  }

  /* =========================================================
     MARK ALL AS READ
     ========================================================= */

  async function markAllAsRead() {
    if (unreadCount === 0) {
      return;
    }

    try {
      await apiRequestPatch(
        '/api/notifications/read-all'
      );

      setNotifications(
        (current) =>
          current.map((item) => ({
            ...item,
            isRead: true,
          }))
      );

      setUnreadCount(0);
    } catch (error) {
      console.error(
        'Failed to mark all notifications as read:',
        error
      );
    }
  }

  /* =========================================================
   DELETE ALL NOTIFICATIONS
   ========================================================= */

async function deleteAllNotifications() {
  if (notifications.length === 0) {
    return;
  }

  const confirmed =
    window.confirm(
      'Delete all notifications? This cannot be undone.'
    );

  if (!confirmed) {
    return;
  }

  try {
    await api.delete<{
      message: string;
    }>(
      '/api/notifications'
    );

    setNotifications([]);
    setUnreadCount(0);
  } catch (error) {
    console.error(
      'Failed to delete notifications:',
      error
    );
  }
}

  /* =========================================================
     PATCH HELPER
     ========================================================= */

  async function apiRequestPatch(
    endpoint: string
  ) {
    return api.patch(endpoint);
  }

  /* =========================================================
     TIME FORMAT
     ========================================================= */

  function formatTime(
    value: string
  ) {
    const date =
      new Date(value);

    const now =
      new Date();

    const difference =
      now.getTime() -
      date.getTime();

    const minutes =
      Math.floor(
        difference / 60000
      );

    if (minutes < 1) {
      return 'Just now';
    }

    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours =
      Math.floor(
        minutes / 60
      );

    if (hours < 24) {
      return `${hours}h ago`;
    }

    const days =
      Math.floor(
        hours / 24
      );

    if (days < 7) {
      return `${days}d ago`;
    }

    return date.toLocaleDateString();
  }

  return (
    <header
      className="
        sticky
        top-0
        z-30
        flex
        h-16
        items-center
        gap-3
        border-b
        border-slate-200
        bg-white/80
        px-4
        backdrop-blur-md
        lg:px-6
      "
    >
      {/* Mobile menu */}

      <button
        onClick={onMenuClick}
        className="
          flex
          h-9
          w-9
          items-center
          justify-center
          rounded-lg
          text-slate-600
          transition-colors
          hover:bg-slate-100
          lg:hidden
        "
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Page title */}

      <h2 className="hidden text-lg font-bold text-slate-900 sm:block">
        {title}
      </h2>

      <div className="ml-auto flex items-center gap-2">

        

        {/* ===================================================
            NOTIFICATION BELL
            =================================================== */}

        <div
          ref={notificationRef}
          className="relative"
        >
          <button
            type="button"
            onClick={() => {
              setNotificationOpen(
                (current) => !current
              );

              if (!notificationOpen) {
                loadNotifications();
              }
            }}
            className="
              relative
              flex
              h-9
              w-9
              items-center
              justify-center
              rounded-lg
              text-slate-600
              transition-colors
              hover:bg-slate-100
            "
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />

            {unreadCount > 0 && (
              <span
                className="
                  absolute
                  -right-1
                  -top-1
                  flex
                  min-h-5
                  min-w-5
                  items-center
                  justify-center
                  rounded-full
                  bg-red-500
                  px-1
                  text-[10px]
                  font-bold
                  text-white
                  ring-2
                  ring-white
                "
              >
                {unreadCount > 99
                  ? '99+'
                  : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown */}

          
            {notificationOpen && (
  <div
    className="
      fixed
      left-3
      right-3
      top-[4.75rem]
      z-50
      max-h-[calc(100dvh-5.5rem)]
      overflow-hidden
      rounded-xl
      border
      border-slate-200
      bg-white
      shadow-xl

      sm:absolute
      sm:left-auto
      sm:right-0
      sm:top-12
      sm:w-[360px]
      sm:max-h-none
    "
  >
              {/* Dropdown header */}

              <div
                className="
                  flex
                  items-center
                  justify-between
                  border-b
                  border-slate-100
                  px-4
                  py-3
                "
              >
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Notifications
                  </h3>

                  <p className="mt-0.5 text-xs text-slate-500">
                    {unreadCount === 0
                      ? 'You are all caught up'
                      : `${unreadCount} unread`}
                  </p>
                </div>

                <div className="flex items-center gap-3">

  {unreadCount > 0 && (
    <button
      type="button"
      onClick={markAllAsRead}
      className="
        flex
        items-center
        gap-1
        whitespace-nowrap
        text-xs
        font-semibold
        text-brand-600
        transition-colors
        hover:text-brand-700
      "
    >
      <CheckCheck className="h-4 w-4" />

      Mark all read
    </button>
  )}

  {notifications.length > 0 && (
    <button
      type="button"
      onClick={deleteAllNotifications}
      className="
        flex
        items-center
        gap-1
        whitespace-nowrap
        text-xs
        font-semibold
        text-red-500
        transition-colors
        hover:text-red-600
      "
    >
      <Trash2 className="h-4 w-4" />

      Delete all
    </button>
  )}

</div>
              </div>

              {/* Notifications */}

              <div
  className="
    max-h-[calc(100dvh-10rem)]
    overflow-y-auto
    sm:max-h-[420px]
  "
>

                {loadingNotifications &&
                notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading notifications...
                  </div>
                ) : notifications.length ===
                  0 ? (
                  <div className="px-4 py-10 text-center">
                    <Bell className="mx-auto h-7 w-7 text-slate-300" />

                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      No notifications
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      New alerts will appear here.
                    </p>
                  </div>
                ) : (
                  notifications.map(
                    (notification) => (
                      <button
                        key={
                          notification.id
                        }
                        type="button"
                        onClick={() =>
                          markAsRead(
                            notification
                          )
                        }
                        className={`
                          relative
                          block
                          w-full
                          border-b
                          border-slate-100
                          px-4
                          py-3
                          text-left
                          transition-colors
                          last:border-b-0
                          hover:bg-slate-50

                          ${
                            !notification.isRead
                              ? 'bg-brand-50/40'
                              : 'bg-white'
                          }
                        `}
                      >
                        <div className="flex gap-3">

                          {/* Unread indicator */}

                          <div className="pt-1.5">
                            <span
                              className={`
                                block
                                h-2
                                w-2
                                rounded-full

                                ${
                                  !notification.isRead
                                    ? 'bg-brand-600'
                                    : 'bg-transparent'
                                }
                              `}
                            />
                          </div>

                          <div className="min-w-0 flex-1">

                            <div className="flex items-start justify-between gap-3">
                              <p
                                className={`
                                  text-sm
                                  text-slate-900

                                  ${
                                    !notification.isRead
                                      ? 'font-bold'
                                      : 'font-semibold'
                                  }
                                `}
                              >
                                {
                                  notification.title
                                }
                              </p>

                              <span className="shrink-0 text-[11px] text-slate-400">
                                {formatTime(
                                  notification.createdAt
                                )}
                              </span>
                            </div>

                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              {
                                notification.message
                              }
                            </p>
                          </div>
                        </div>
                      </button>
                    )
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {/* User */}

        <div
          className="
            ml-1
            flex
            items-center
            gap-2
            border-l
            border-slate-200
            pl-2
          "
        >
          <div
            className="
              flex
              h-9
              w-9
              items-center
              justify-center
              rounded-full
              bg-brand-100
              text-sm
              font-semibold
              text-brand-700
            "
          >
            {user?.name?.charAt(0) ??
              'U'}
          </div>

          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-tight text-slate-900">
              {user?.name}
            </p>

            <p className="text-xs capitalize leading-tight text-slate-500">
              {user?.role}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
