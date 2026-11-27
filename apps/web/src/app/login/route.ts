import { handleLogin } from "../../lib/auth-routes";
import { redirectHome, withAuthDeps } from "../../lib/route-helpers";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withAuthDeps(request, handleLogin, redirectHome);
}
