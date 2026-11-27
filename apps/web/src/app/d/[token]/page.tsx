import type { Metadata } from "next";
import { DriverConsole } from "../../../components/driver-console";
import { Notice } from "../../../components/notices";
import { getAuthDeps } from "../../../lib/deps";
import { DRIVER_FAILURE_MESSAGES, driverJobSchema, driverRequest } from "../../../lib/driver-api";

// The Driver Link page: public, mobile first, no sign-in. The token in the address is the credential,
// so the page is never indexed, never cached and never sends the address on as a referrer.
export const metadata: Metadata = {
  title: "Your transport",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function DriverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await driverRequest({
    apiUrl: getAuthDeps().config.apiUrl,
    token,
    path: "job",
    schema: driverJobSchema,
  });
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      {result.ok ? (
        <DriverConsole token={token} initial={result.data} />
      ) : (
        <Notice>{DRIVER_FAILURE_MESSAGES[result.reason]}</Notice>
      )}
    </main>
  );
}
