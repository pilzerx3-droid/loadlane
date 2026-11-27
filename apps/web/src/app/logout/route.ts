import { handleLogout } from "../../lib/auth-routes";
import { withAuthDeps } from "../../lib/route-helpers";

export const dynamic = "force-dynamic";

// POST only: signing out must not be triggered by following a link or loading an image.
export function POST(request: Request): Promise<Response> {
  return withAuthDeps(
    request,
    handleLogout,
    () => new Response("Sign-in is not configured", { status: 503 }),
  );
}
