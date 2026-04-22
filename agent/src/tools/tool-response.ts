export interface SuccessResult<T> {
  ok: true;
  data: T;
}

export interface FailureResult {
  ok: false;
  message: string;
}

export type ToolResult<T> = SuccessResult<T> | FailureResult;

export function successResponse<T>(data: T): string {
  const result: SuccessResult<T> = { ok: true, data };
  return JSON.stringify(result);
}

export function failureResponse(message: string): string {
  const result: FailureResult = { ok: false, message };
  return JSON.stringify(result);
}
