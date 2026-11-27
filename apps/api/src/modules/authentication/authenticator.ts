import {
  ConflictException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";
import type { AuthContext, AuthenticatedRequest } from "../../platform/request-context.ts";
import {
  InvalidTokenError,
  ProviderUnavailableError,
  type TokenVerifier,
} from "./token-verifier.ts";
import {
  EmailAlreadyRegisteredError,
  EmailNotVerifiedError,
  UserDeactivatedError,
  type UserResolver,
} from "./user-resolver.ts";

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

/** Turns the Authorization header into one of our users, or throws the matching HTTP error. */
export class Authenticator {
  private readonly logger = new Logger(Authenticator.name);

  constructor(
    private readonly verifier: TokenVerifier,
    private readonly resolver: UserResolver,
  ) {}

  async authenticate(request: AuthenticatedRequest, response: Response): Promise<AuthContext> {
    const accessToken = BEARER_PATTERN.exec(request.headers.authorization ?? "")?.[1];
    if (!accessToken) {
      response.setHeader("WWW-Authenticate", "Bearer");
      throw new UnauthorizedException();
    }

    try {
      const verified = await this.verifier.verify(accessToken);
      const user = await this.resolver.resolve(verified, accessToken);
      const auth: AuthContext = { user, issuer: verified.issuer, subject: verified.subject };
      request.auth = auth;
      return auth;
    } catch (error) {
      throw this.toHttpException(error, response);
    }
  }

  private toHttpException(error: unknown, response: Response): Error {
    if (error instanceof InvalidTokenError) {
      // The reason goes to the log only: it would help someone probing for a weakness.
      this.logger.warn(`Rejected access token (${error.reason})`);
      response.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
      return new UnauthorizedException();
    }
    if (error instanceof ProviderUnavailableError) {
      this.logger.error(
        error.message,
        error.cause instanceof Error ? error.cause.stack : undefined,
      );
      return new ServiceUnavailableException({
        statusCode: 503,
        code: "provider_unavailable",
        message: "The sign-in provider is not reachable",
      });
    }
    // `code` is for programs (the web app maps it to a message), `message` is for people reading logs.
    if (error instanceof EmailNotVerifiedError) {
      return new ForbiddenException({
        statusCode: 403,
        code: "email_not_verified",
        message: error.message,
      });
    }
    if (error instanceof UserDeactivatedError) {
      return new ForbiddenException({
        statusCode: 403,
        code: "account_disabled",
        message: error.message,
      });
    }
    if (error instanceof EmailAlreadyRegisteredError) {
      return new ConflictException({
        statusCode: 409,
        code: "email_in_use",
        message: error.message,
      });
    }
    this.logger.error(
      "Unexpected error while authenticating",
      error instanceof Error ? error.stack : String(error),
    );
    return error instanceof Error ? error : new Error("Unexpected error");
  }
}
