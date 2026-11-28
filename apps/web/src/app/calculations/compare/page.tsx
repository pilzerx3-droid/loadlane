import type { Metadata } from "next";
import { PageHeader } from "@loadlane/ui";
import { AppShell } from "../../../components/app-shell";
import { CalculationCompare } from "../../../components/calculation-compare";
import { ForbiddenNotice, Notice } from "../../../components/notices";
import { apiRequest } from "../../../lib/api-client";
import { calculationDetailSchema } from "../../../lib/calculations";
import { getAuthDeps } from "../../../lib/deps";
import { requireOrganizationPage } from "../../../lib/viewer";

export const metadata: Metadata = { title: "Compare calculations" };
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer, allowed } = await requireOrganizationPage("calculation:read");
  const params = await searchParams;
  const raw = params["id"];
  const ids = [
    ...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter((id) => UUID_PATTERN.test(id))),
  ];
  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else if (ids.length < 2 || ids.length > 4) {
    content = (
      <Notice>
        Choose two to four calculations to compare.{" "}
        <a href="/calculations" className="underline">
          Back to calculations
        </a>
      </Notice>
    );
  } else {
    const base = {
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
    };
    const results = await Promise.all(
      ids.map((id) =>
        apiRequest({ ...base, path: `/v1/calculations/${id}`, schema: calculationDetailSchema }),
      ),
    );
    const found = results.flatMap((result) => (result.ok ? [result.data] : []));
    content =
      found.length === ids.length ? (
        <CalculationCompare calculations={found} />
      ) : (
        <Notice>One of these calculations could not be loaded. It may not exist.</Notice>
      );
  }
  return (
    <AppShell viewer={viewer}>
      <PageHeader title="Compare calculations" description="Side by side, nothing converted" />
      {content}
    </AppShell>
  );
}
