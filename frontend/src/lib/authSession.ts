export const USER_STORAGE_KEY = 'pos-auth-user';
export const TOKEN_STORAGE_KEY = 'pos-auth-token';
export const SESSION_EXPIRED_STORAGE_KEY =
  'pos-auth-session-expired';
export const AUTH_EXPIRED_EVENT = 'pos-auth-expired';

export function clearStoredAuthSession() {
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // React state is still cleared when browser storage is unavailable.
  }
}
