/**
 * Exhaustiveness guard for discriminated unions and switch statements.
 * The compiler rejects calls where `value` is not `never`; at runtime it throws.
 */
export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
