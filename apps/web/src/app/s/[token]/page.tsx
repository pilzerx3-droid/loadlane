import type { Metadata } from "next";
import { Notice } from "../../../components/notices";
import { SpotCarrierConsole } from "../../../components/spot-carrier-console";
import { getAuthDeps } from "../../../lib/deps";
import { CARRIER_FAILURE_MESSAGES, carrierRequest } from "../../../lib/spot";

// The carrier's offer page: public, no sign-in. The token in the address is the credential, so the
// page is never indexed, never cached and never sends the address on as a referrer.
export const metadata: Metadata = {
  title: "Load offer",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function SpotOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await carrierRequest({
    apiUrl: getAuthDeps().config.apiUrl,
    token,
    path: "offer",
  });
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      {result.ok ? (
        <SpotCarrierConsole token={token} initial={result.data} />
      ) : (
        <Notice>{CARRIER_FAILURE_MESSAGES[result.reason]}</Notice>
      )}
    </main>
  );
}
