import {
  AUTH_EXPIRED_EVENT,
  SESSION_EXPIRED_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  clearStoredAuthSession,
} from '@/lib/authSession';

const API_URL = '';

function getErrorMessage(data: unknown): string | null {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error;
  }

  return null;
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function getErrorCode(data: unknown): string | null {
  return typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string'
    ? data.code : null;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers = new Headers(options.headers);

  const isFormData =
    options.body instanceof FormData;

  if (
    !isFormData &&
    !headers.has('Content-Type') &&
    options.body
  ) {
    headers.set(
      'Content-Type',
      'application/json'
    );
  }

  if (token) {
    headers.set(
      'Authorization',
      `Bearer ${token}`
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `${API_URL}${endpoint}`,
      {
        ...options,
        headers,
      }
    );
  } catch {
    throw new Error(
      'Cannot connect to the POS server. Make sure the backend is running.'
    );
  }

  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    // Response may not contain JSON
  }

  if (!response.ok) {
    const errorMessage = getErrorMessage(data);

    if (response.status === 401) {
      clearStoredAuthSession();

      try {
        sessionStorage.setItem(
          SESSION_EXPIRED_STORAGE_KEY,
          'true'
        );
      } catch {
        // The redirect still works when browser storage is unavailable.
      }

      window.dispatchEvent(
        new Event(AUTH_EXPIRED_EVENT)
      );

      throw new ApiError(
        errorMessage ||
          'Your session has expired. Please sign in again.',
        response.status,
        getErrorCode(data)
      );
    }

    if (response.status === 403) {
      throw new ApiError(
        errorMessage ||
          'You do not have permission to perform this action.',
        response.status,
        getErrorCode(data)
      );
    }

    throw new ApiError(
      errorMessage ||
        `Request failed (${response.status})`,
      response.status,
      getErrorCode(data)
    );
  }

  return data as T;
}

export const api = {
  get<T>(endpoint: string) {
    return apiRequest<T>(endpoint);
  },

  post<T>(
    endpoint: string,
    body?: unknown
  ) {
    const isFormData =
      body instanceof FormData;

    return apiRequest<T>(
      endpoint,
      {
        method: 'POST',
        body:
          body === undefined
            ? undefined
            : isFormData
              ? body
              : JSON.stringify(body),
      }
    );
  },

  put<T>(
    endpoint: string,
    body?: unknown
  ) {
    const isFormData =
      body instanceof FormData;

    return apiRequest<T>(
      endpoint,
      {
        method: 'PUT',
        body:
          body === undefined
            ? undefined
            : isFormData
              ? body
              : JSON.stringify(body),
      }
    );
  },


  patch<T>(
  endpoint: string,
  body?: unknown
) {
  const isFormData =
    body instanceof FormData;

  return apiRequest<T>(
    endpoint,
    {
      method: 'PATCH',
      body:
        body === undefined
          ? undefined
          : isFormData
            ? body
            : JSON.stringify(body),
    }
  );
},

  delete<T>(endpoint: string) {
    return apiRequest<T>(
      endpoint,
      {
        method: 'DELETE',
      }
    );
  },
};
