import type { Metadata } from "next";
import { Card, PageHeader } from "@loadlane/ui";
import { AppShell } from "../../components/app-shell";
import { MembersTable, Pagination } from "../../components/members-table";
import { ForbiddenNotice, Notice } from "../../components/notices";
import { apiRequest, membersResponseSchema } from "../../lib/api-client";
import { getAuthDeps } from "../../lib/deps";
import { parsePage } from "../../lib/paging";
import { requireOrganizationPage } from "../../lib/viewer";

export const metadata: Metadata = { title: "Members" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { viewer, allowed } = await requireOrganizationPage("member:read");
  const page = parsePage((await searchParams)["page"]);

  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const result = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: `/v1/members?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
      schema: membersResponseSchema,
    });
    if (!result.ok) {
      content =
        result.status === 403 ? (
          <ForbiddenNotice />
        ) : (
          <Notice>The members could not be loaded right now. Please try again in a moment.</Notice>
        );
    } else {
      content = (
        <Card className="p-2 sm:p-4">
          <MembersTable members={result.data.members} currentUserId={viewer.user.id} />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={result.data.page.total}
            path="/members"
          />
        </Card>
      );
    }
  }

  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Members"
        description={`People in ${viewer.active.name} and what they can do`}
      />
      {content}
    </AppShell>
  );
}
