const API_URL = '';

function getToken(): string | null {
  return localStorage.getItem('pos-auth-token');
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

  let data: any = null;

  try {
    data = await response.json();
  } catch {
    // Response may not contain JSON
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        data?.error ||
          'Your session has expired. Please sign in again.'
      );
    }

    if (response.status === 403) {
      throw new Error(
        data?.error ||
          'You do not have permission to perform this action.'
      );
    }

    throw new Error(
      data?.error ||
        `Request failed (${response.status})`
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