import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { TOKEN_VERIFIER, USER_RESOLVER } from "./tokens.ts";
import {
  InvalidTokenError,
  ProviderUnavailableError,
  type TokenVerifier,
} from "./token-verifier.ts";
import {
  EmailAlreadyRegisteredError,
  EmailNotVerifiedError,
  UserDeactivatedError,
  type ResolvedUser,
  type UserResolver,
} from "./user-resolver.ts";

/** Set on the request by AuthGuard. */
export interface AuthContext {
  user: ResolvedUser;
  issuer: string;
  subject: string;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i;

/** Requires a valid access token and resolves it to one of our users. */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(USER_RESOLVER) private readonly resolver: UserResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const accessToken = BEARER_PATTERN.exec(request.headers.authorization ?? "")?.[1];
    if (!accessToken) {
      response.setHeader("WWW-Authenticate", "Bearer");
      throw new UnauthorizedException();
    }

    try {
      const verified = await this.verifier.verify(accessToken);
      const user = await this.resolver.resolve(verified, accessToken);
      request.auth = { user, issuer: verified.issuer, subject: verified.subject };
      return true;
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
      return new ServiceUnavailableException("The sign-in provider is not reachable");
    }
    if (error instanceof EmailNotVerifiedError) return new ForbiddenException(error.message);
    if (error instanceof UserDeactivatedError) return new ForbiddenException(error.message);
    if (error instanceof EmailAlreadyRegisteredError) return new ConflictException(error.message);
    this.logger.error(
      "Unexpected error while authenticating",
      error instanceof Error ? error.stack : String(error),
    );
    return error instanceof Error ? error : new Error("Unexpected error");
  }
}
