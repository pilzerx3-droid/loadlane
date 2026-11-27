import {
  applyDecorators,
  Controller,
  Get,
  Inject,
  Injectable,
  type INestApplication,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { z } from "zod";
import { Public } from "./access.ts";
import { problemSchema } from "./problem.ts";

type JsonSchema = Record<string, unknown>;

/** JSON Schema (2020-12, the dialect of OpenAPI 3.1) of a Zod schema. */
export function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output"): JsonSchema {
  const result = z.toJSONSchema(schema, { target: "draft-2020-12", io }) as JsonSchema;
  delete result["$schema"];
  return result;
}

/**
 * Documents a route from its Zod schemas: the success response and the query parameters. Who may call
 * the route and which headers it needs comes from @RequirePermissions and friends (see access.ts).
 */
export function ApiRoute(options: { summary: string; response: z.ZodType; query?: z.ZodObject }) {
  const decorators: MethodDecorator[] = [
    ApiOperation({ summary: options.summary }),
    ApiOkResponse({ description: "Success", schema: jsonSchema(options.response) }),
  ];
  if (options.query) {
    const query = jsonSchema(options.query, "input") as {
      properties?: Record<string, JsonSchema>;
      required?: string[];
    };
    for (const [name, property] of Object.entries(query.properties ?? {})) {
      decorators.push(
        ApiQuery({ name, required: query.required?.includes(name) ?? false, schema: property }),
      );
    }
  }
  return applyDecorators(...decorators);
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

type Operation = {
  security?: unknown[];
  parameters?: unknown[];
  responses?: Record<string, unknown>;
  [extension: string]: unknown;
};

/** Adds the shared problem schema and the error responses every route can produce. */
export function finalizeOpenApi(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas["Problem"] = jsonSchema(problemSchema, "output");

  const problem = (description: string) => ({
    description,
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  });

  for (const pathItem of Object.values(document.paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method] as Operation | undefined;
      if (!operation) continue;
      const signedIn = (operation.security?.length ?? 0) > 0;
      const responses = (operation.responses ??= {});

      if ((operation.parameters?.length ?? 0) > 0)
        responses["400"] ??= problem("The request is not valid");
      if (signedIn) {
        responses["401"] ??= problem("Missing or invalid access token");
        responses["403"] ??= problem(
          "E-mail not verified, account disabled, not an active member of the organization, or a permission is missing",
        );
        responses["409"] ??= problem(
          "The e-mail address belongs to an account with a different sign-in",
        );
        responses["503"] ??= problem("The sign-in provider is not reachable");
      }
      responses["429"] ??= problem("Too many requests. See the Retry-After header.");
      responses["500"] ??= problem("Unexpected error");
    }
  }
  return document;
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Loadlane API")
    .setDescription(
      "Transport visibility, freight calculation and spot freight. Errors are RFC 9457 problem documents.",
    )
    .setVersion("0.1.0")
    .setOpenAPIVersion("3.1.0")
    .addBearerAuth()
    .build();
  return finalizeOpenApi(SwaggerModule.createDocument(app, config));
}

@Injectable()
export class OpenApiService {
  private document: OpenAPIObject | undefined;

  set(document: OpenAPIObject): void {
    this.document = document;
  }

  get(): OpenAPIObject {
    if (!this.document) throw new Error("The OpenAPI document has not been built");
    return this.document;
  }
}

@Controller("v1")
export class OpenApiController {
  constructor(@Inject(OpenApiService) private readonly service: OpenApiService) {}

  @Get("openapi.json")
  @Public()
  @ApiOperation({ summary: "The OpenAPI document of this API (not served in production)" })
  document(): OpenAPIObject {
    return this.service.get();
  }
}
