export function successResponse<T>(data: T): string {
  return JSON.stringify({ ok: true, data });
}

export function failureResponse(message: string): string {
  return JSON.stringify({ ok: false, message });
}
