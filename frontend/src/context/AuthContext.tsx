import {
  createContext,
  useEffect,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { User } from '@/types';
import {
  AUTH_EXPIRED_EVENT,
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
  clearStoredAuthSession,
} from '@/lib/authSession';
import { api } from '@/lib/api';

interface AuthContextValue {
  user: User | null;
  login: (
    username: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<User>;
  completeSetup: (details: {
    name: string;
    username: string;
    password: string;
  }) => Promise<User>;
  logout: () => void;
  updateUser: (user: User) => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_URL = '';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);
  const authenticatedUserId = user?.id;

  useEffect(() => {
    function handleExpiredSession() {
      setUser(null);
    }

    window.addEventListener(
      AUTH_EXPIRED_EVENT,
      handleExpiredSession
    );

    return () => {
      window.removeEventListener(
        AUTH_EXPIRED_EVENT,
        handleExpiredSession
      );
    };
  }, []);

  useEffect(() => {
    if (!authenticatedUserId) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    api
      .get<User>('/api/auth/profile')
      .then((profile) => {
        if (cancelled) {
          return;
        }

        setUser((currentUser) => {
          if (!currentUser) {
            return currentUser;
          }

          const validatedUser: User = {
            ...currentUser,
            ...profile,
            status: 'active',
          };

          localStorage.setItem(
            USER_STORAGE_KEY,
            JSON.stringify(validatedUser)
          );
          return validatedUser;
        });
      })
      .catch(() => {
        // The shared API handler clears invalid sessions and redirects.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authenticatedUserId]);

  async function login(
    username: string,
    password: string,
    rememberMe = true
  ): Promise<User> {
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
          rememberMe,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      const loggedInUser: User = {
        ...data.user,
        status: 'active',
      };

      setUser(loggedInUser);

      localStorage.setItem(
        USER_STORAGE_KEY,
        JSON.stringify(loggedInUser)
      );

      localStorage.setItem(
        TOKEN_STORAGE_KEY,
        data.token
      );

      return loggedInUser;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(
          'Cannot connect to the POS server. Make sure the backend is running.'
        );
      }

      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function completeSetup(details: {
    name: string;
    username: string;
    password: string;
  }): Promise<User> {
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: details.name.trim(),
          username: details.username.trim(),
          password: details.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not create the owner account');
      }

      const owner: User = {
        ...data.user,
        status: 'active',
      };

      setUser(owner);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(owner));
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);

      return owner;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(
          'Cannot connect to the POS server. Make sure the backend is running.'
        );
      }

      throw error;
    } finally {
      setLoading(false);
    }
  }

  function updateUser(updatedUser: User) {
  setUser(updatedUser);

  try {
    localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify(updatedUser)
    );
  } catch {
    // ignore storage errors
  }
}

  function logout() {
    setUser(null);

    try {
      clearStoredAuthSession();
    } catch {
      // ignore storage errors
    }
  }

  const value = useMemo<AuthContextValue>(
  () => ({
    user,
    login,
    completeSetup,
    logout,
    updateUser,
    loading,
  }),
  [user, loading]
);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error(
      'useAuth must be used within AuthProvider'
    );
  }

  return ctx;
}
