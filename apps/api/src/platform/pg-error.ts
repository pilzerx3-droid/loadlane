export interface PgErrorInfo {
  /** SQLSTATE, for example 23505 for a unique violation. */
  code?: string;
  constraint?: string;
}

/** Drizzle wraps driver errors; this looks at the error itself and at its cause. */
export function pgErrorInfo(error: unknown): PgErrorInfo {
  if (typeof error !== "object" || error === null) return {};
  const cause = (error as { cause?: unknown }).cause;
  return typeof cause === "object" && cause !== null ? cause : error;
}
