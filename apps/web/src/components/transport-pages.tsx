import { Pencil, Plus } from "lucide-react";
import { z } from "zod";
import { Button, PageHeader } from "@loadlane/ui";
import { apiRequest } from "../lib/api-client";
import { getAuthDeps } from "../lib/deps";
import { parsePage } from "../lib/paging";
import { isoToLocalInput } from "../lib/time";
import {
  locationOptionListSchema,
  optionListSchema,
  transportDetailSchema,
  transportListSchema,
  type TransportDetail,
} from "../lib/transport-api";
import { emptyTransportForm, type TransportFormValues } from "../lib/transport-form";
import { requireOrganizationPage, type ActiveViewer } from "../lib/viewer";
import { AppShell } from "./app-shell";
import { ForbiddenNotice, Notice } from "./notices";
import { TransportForm, type Option } from "./transport-form";
import { TransportDetailView, TransportStatusBadge, TransportsList } from "./transport-views";

const PAGE_SIZE = 25;
// The selects of the form list up to this many records. Larger lists need a search field (later).
const OPTION_LIMIT = 100;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function call<S extends z.ZodType>(viewer: ActiveViewer, path: string, schema: S) {
  return apiRequest({
    apiUrl: getAuthDeps().config.apiUrl,
    accessToken: viewer.accessToken,
    organizationId: viewer.active.id,
    path,
    schema,
  });
}

const PROBLEMS: Record<string, string> = {
  invalid_transition: "That status change is not possible from the current status.",
  carrier_required: "Choose a carrier (edit the transport) before assigning it.",
  forbidden: "You do not have permission to change this transport.",
  not_found: "This transport no longer exists.",
  unavailable: "The status could not be changed right now. Please try again in a moment.",
};

export async function TransportsListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { viewer, allowed } = await requireOrganizationPage("transport:read");
  const params = await searchParams;
  const page = parsePage(params["page"]);
  const q = first(params["q"]).trim().slice(0, 100);
  const status = first(params["status"]);
  const canManage = viewer.active.permissions.includes("transport:manage");

  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    const result = await call(viewer, `/v1/transports?${query.toString()}`, transportListSchema);
    content = result.ok ? (
      <TransportsList
        items={result.data.items}
        total={result.data.page.total}
        page={page}
        pageSize={PAGE_SIZE}
        q={q}
        status={status}
        canManage={canManage}
      />
    ) : result.status === 400 ? (
      <Notice>That filter is not valid. Clear the search and try again.</Notice>
    ) : result.status === 403 ? (
      <ForbiddenNotice />
    ) : (
      <Notice>The transports could not be loaded right now. Please try again in a moment.</Notice>
    );
  }

  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title="Transports"
        description={`Shipments of ${viewer.active.name}`}
        actions={
          allowed && canManage ? (
            <Button asChild>
              <a href="/transports/new">
                <Plus aria-hidden="true" /> New transport
              </a>
            </Button>
          ) : undefined
        }
      />
      {content}
    </AppShell>
  );
}

function valuesOf(transport: TransportDetail): TransportFormValues {
  return {
    customerId: transport.customer.id,
    carrierId: transport.carrier?.id ?? "",
    customerReference: transport.customerReference ?? "",
    purchaseOrder: transport.purchaseOrder ?? "",
    weightLb: transport.weightLb === null ? "" : String(transport.weightLb),
    pieces: transport.pieces === null ? "" : String(transport.pieces),
    notes: transport.notes ?? "",
    stops: transport.stops.map((stop) => ({
      type: stop.type,
      locationId: stop.location.id,
      start: isoToLocalInput(stop.windowStart, stop.location.timezone),
      end: isoToLocalInput(stop.windowEnd, stop.location.timezone),
      reference: stop.reference ?? "",
    })),
  };
}

/** The form to create a transport (`id` undefined) or to change one. */
export async function TransportFormPage({ id }: { id?: string }) {
  const { viewer, allowed } = await requireOrganizationPage("transport:manage");
  const title = id === undefined ? "New transport" : "Edit transport";

  let content;
  if (!allowed) {
    content = <ForbiddenNotice />;
  } else {
    const [customers, carriers, locations, existing] = await Promise.all([
      call(viewer, `/v1/customers?limit=${OPTION_LIMIT}`, optionListSchema),
      call(viewer, `/v1/carriers?limit=${OPTION_LIMIT}`, optionListSchema),
      call(viewer, `/v1/locations?limit=${OPTION_LIMIT}`, locationOptionListSchema),
      id === undefined
        ? Promise.resolve(undefined)
        : call(viewer, `/v1/transports/${id}`, transportDetailSchema),
    ]);
    if (!customers.ok || !carriers.ok || !locations.ok) {
      content = (
        <Notice>
          The customers, carriers or locations could not be loaded. You may not have permission to
          read all of them, or the service is unavailable. Please try again in a moment.
        </Notice>
      );
    } else if (existing && !existing.ok) {
      content = <Notice>This transport does not exist or could not be loaded.</Notice>;
    } else if (existing?.ok && !existing.data.editable) {
      content = (
        <Notice>
          This transport is already on the road and can no longer be edited.{" "}
          <a href={`/transports/${existing.data.id}`} className="underline">
            Back to the transport
          </a>
        </Notice>
      );
    } else if (customers.data.items.length === 0 || locations.data.items.length === 0) {
      content = (
        <Notice>
          A transport needs a customer and locations.{" "}
          {customers.data.items.length === 0 ? (
            <a href="/customers/new" className="underline">
              Add a customer
            </a>
          ) : (
            <a href="/locations/new" className="underline">
              Add a location
            </a>
          )}{" "}
          first.
        </Notice>
      );
    } else {
      const options = (items: { id: string; name: string }[]): Option[] =>
        items.map((item) => ({ id: item.id, label: item.name }));
      content = (
        <TransportForm
          id={id ?? ""}
          values={existing?.ok ? valuesOf(existing.data) : emptyTransportForm()}
          customers={options(customers.data.items)}
          carriers={options(carriers.data.items)}
          locations={locations.data.items.map((item) => ({
            id: item.id,
            label: `${item.name} (${item.city}, ${item.state})`,
          }))}
        />
      );
    }
  }

  return (
    <AppShell viewer={viewer}>
      <PageHeader title={title} />
      {content}
    </AppShell>
  );
}

export async function TransportDetailPage({ id, problem }: { id: string; problem: string }) {
  const { viewer, allowed } = await requireOrganizationPage("transport:read");
  const canManage = viewer.active.permissions.includes("transport:manage");

  if (!allowed) {
    return (
      <AppShell viewer={viewer}>
        <PageHeader title="Transport" />
        <ForbiddenNotice />
      </AppShell>
    );
  }
  const result = await call(viewer, `/v1/transports/${id}`, transportDetailSchema);
  if (!result.ok) {
    return (
      <AppShell viewer={viewer}>
        <PageHeader title="Transport" />
        <Notice>
          {result.status === 404 || result.status === 400
            ? "This transport does not exist."
            : "The transport could not be loaded right now. Please try again in a moment."}{" "}
          <a href="/transports" className="underline">
            Back to all transports
          </a>
        </Notice>
      </AppShell>
    );
  }
  const transport = result.data;
  return (
    <AppShell viewer={viewer}>
      <PageHeader
        title={transport.reference}
        description={<TransportStatusBadge status={transport.status} />}
        actions={
          canManage && transport.editable ? (
            <Button asChild variant="outline">
              <a href={`/transports/${transport.id}/edit`}>
                <Pencil aria-hidden="true" /> Edit
              </a>
            </Button>
          ) : undefined
        }
      />
      {problem && PROBLEMS[problem] ? (
        <div className="mb-5">
          <Notice>{PROBLEMS[problem]}</Notice>
        </div>
      ) : null}
      <TransportDetailView transport={transport} canManage={canManage} />
    </AppShell>
  );
}
