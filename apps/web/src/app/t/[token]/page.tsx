import type { Metadata } from "next";
import { Notice } from "../../../components/notices";
import { PublicTrackingView } from "../../../components/public-tracking-view";
import { getAuthDeps } from "../../../lib/deps";
import { fetchPublicTracking } from "../../../lib/tracking-links";

// The customer tracking page: public, no sign-in. The token in the address is the credential, so
// the page is never indexed, never cached and never sends the address on as a referrer.
export const metadata: Metadata = {
  title: "Track your shipment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

const MESSAGES = {
  invalid: "This tracking link is not valid.",
  gone: "This tracking link is no longer active. Ask the sender for a new one.",
  unavailable: "Tracking is not available right now. Please try again in a moment.",
} as const;

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await fetchPublicTracking(getAuthDeps().config.apiUrl, token);
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      {result.ok ? (
        <PublicTrackingView tracking={result.data} />
      ) : (
        <Notice>{MESSAGES[result.reason]}</Notice>
      )}
    </main>
  );
}
