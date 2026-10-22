export class AppError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message);
  }
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}
