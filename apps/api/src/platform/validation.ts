import { HttpException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

export interface FieldError {
  path: string;
  message: string;
  code: string;
}

/** 400 with a list of field errors, rendered as a problem document by ProblemFilter. */
export class ValidationFailedError extends HttpException {
  constructor(readonly errors: FieldError[]) {
    super(
      { statusCode: 400, code: "validation_failed", message: "The request is not valid", errors },
      400,
    );
  }
}

export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validates and converts a request part (query, body, params) with a Zod schema.
 * Usage: `@Query(new ZodPipe(schema)) query: z.output<typeof schema>`. The same schema feeds the
 * OpenAPI document (see ApiRoute), so validation and documentation share one source.
 */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new ValidationFailedError(toFieldErrors(result.error));
    return result.data;
  }
}
