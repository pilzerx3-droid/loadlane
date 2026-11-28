import { Plus } from "lucide-react";
import { z } from "zod";
import { Button, Card, PageHeader } from "@loadlane/ui";
import { apiRequest } from "../lib/api-client";
import { getAuthDeps } from "../lib/deps";
import { MASTER_DATA, type MasterDataKey } from "../lib/master-data";
import { recordSchema } from "../lib/master-data-actions";
import { parsePage } from "../lib/paging";
import { requireOrganizationPage } from "../lib/viewer";
import { setArchivedAction } from "../app/master-data-actions";
import { AppShell } from "./app-shell";
import { LocationCoordinatesCard } from "./location-coordinates-card";
import { MasterDataForm } from "./master-data-form";
import { MasterDataList } from "./master-data-list";
import { ForbiddenNotice, Notice } from "./notices";

const PAGE_SIZE = 25;

const listSchema = z.object({
  items: z.array(recordSchema),
  page: z.object({ total: z.number().int() }),
});

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The list page of one kind of master data. */
export async function MasterDataListPage({
  kind,
  searchParams,
}: {
  kind: MasterDataKey;
  searchParams: Promise<SearchParams>;
}) {
  const config = MASTER_DATA[kind];
  const { viewer, allowed } = await requireOrganizationPage(config.read);
  const params = await searchParams;
  const page = parsePage(params["page"]);
  const q = first(params["q"]).trim().slice(0, 100);
  const includeArchived = first(params["archived"]) === "1";
  const canManage = viewer.active.permissions.includes(config.manage);

  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
      includeArchived: String(includeArchived),
    });
    if (q) query.set("q", q);
    const result = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: `/v1${config.path}?${query.toString()}`,
      schema: listSchema,
    });
    content = result.ok ? (
      <MasterDataList
        config={config}
        records={result.data.items}
        total={result.data.page.total}
        page={page}
        pageSize={PAGE_SIZE}
        q={q}
        includeArchived={includeArchived}
        canManage={canManage}
      />
    ) : result.status === 403 ? (
      <ForbiddenNotice />
    ) : (
      <Notice>
        The {config.plural.toLowerCase()} could not be loaded right now. Please try again in a
        moment.
      </Notice>
    );
  }

  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title={config.plural}
        description={config.description}
        actions={
          allowed && canManage ? (
            <Button asChild>
              <a href={`${config.path}/new`}>
                <Plus aria-hidden="true" /> Add {config.singular}
              </a>
            </Button>
          ) : undefined
        }
      />
      {content}
    </AppShell>
  );
}

/** The page to add a record (`id` undefined) or to change one. */
export async function MasterDataFormPage({
  kind,
  id,
  geoNotice,
}: {
  kind: MasterDataKey;
  id?: string;
  /** Outcome of the last coordinates action (locations only), from the page address. */
  geoNotice?: string;
}) {
  const config = MASTER_DATA[kind];
  const { viewer, allowed } = await requireOrganizationPage(config.manage);
  const title = id === undefined ? `Add ${config.singular}` : `Edit ${config.singular}`;

  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else if (id === undefined) {
    content = (
      <Card className="p-5">
        <MasterDataForm config={config} id="" values={{}} />
      </Card>
    );
  } else {
    const result = await apiRequest({
      apiUrl: getAuthDeps().config.apiUrl,
      accessToken: viewer.accessToken,
      organizationId: viewer.active.id,
      path: `/v1${config.path}/${id}`,
      schema: recordSchema,
    });
    if (!result.ok) {
      content =
        result.status === 404 || result.status === 400 ? (
          <Notice>This {config.singular} does not exist.</Notice>
        ) : (
          <Notice>
            The {config.singular} could not be loaded right now. Please try again in a moment.
          </Notice>
        );
    } else {
      const record = result.data;
      const values: Record<string, string> = {};
      for (const field of config.fields) {
        const value = record[field.name];
        values[field.name] = typeof value === "string" ? value : "";
      }
      const archived = typeof record["archivedAt"] === "string";
      content = (
        <div className="space-y-5">
          {archived ? (
            <Notice>
              This {config.singular} is archived. It does not show up in lists or on new transports
              until you restore it.
            </Notice>
          ) : null}
          <Card className="p-5">
            <MasterDataForm config={config} id={id} values={values} />
          </Card>
          {kind === "locations" ? (
            <LocationCoordinatesCard
              id={id}
              latitude={typeof record["latitude"] === "number" ? record["latitude"] : null}
              longitude={typeof record["longitude"] === "number" ? record["longitude"] : null}
              source={typeof record["geocodeSource"] === "string" ? record["geocodeSource"] : null}
              geocodedAt={typeof record["geocodedAt"] === "string" ? record["geocodedAt"] : null}
              notice={geoNotice}
            />
          ) : null}
          <form action={setArchivedAction.bind(null, kind, id, !archived)}>
            <Button type="submit" variant="outline">
              {archived ? `Restore ${config.singular}` : `Archive ${config.singular}`}
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">
              {archived
                ? "Restoring makes it available again."
                : "Archiving hides it from lists and new transports. Existing transports keep it."}
            </p>
          </form>
        </div>
      );
    }
  }

  return (
    <AppShell viewer={viewer}>
      <PageHeader title={title} description={config.description} />
      {content}
    </AppShell>
  );
}
