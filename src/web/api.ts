export class ApiRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    ...(options.body !== undefined && options.body !== null ? { 'content-type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(data?.error?.message ?? 'Erro inesperado', data?.error?.code ?? 'unknown', response.status);
  }
  return data as T;
}
