import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MASTER_DATA } from "../lib/master-data";
import { Dashboard } from "./dashboard";
import { MasterDataList } from "./master-data-list";
import { TransportsList } from "./transport-views";
import { MembersTable, Pagination, roleLabel } from "./members-table";
import { describeOrganization, OrganizationDetails } from "./organization-details";
import {
  ForbiddenNotice,
  NotConfiguredScreen,
  Notice,
  ProblemScreen,
  SIGN_IN_ERRORS,
  SignedOutScreen,
} from "./notices";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const members = [
  {
    userId: "u1",
    email: "ada@example.com",
    displayName: "Ada Lovelace",
    status: "active" as const,
    roles: ["admin"],
  },
  {
    userId: "u2",
    email: "bob@example.com",
    displayName: "Bob",
    status: "invited" as const,
    roles: [],
  },
  {
    userId: "u3",
    email: "cy@example.com",
    displayName: "Cy",
    status: "suspended" as const,
    roles: ["carrier_user", "sales"],
  },
];

describe("MembersTable", () => {
  const markup = html(<MembersTable members={members} currentUserId="u1" />);

  it("lists every member with e-mail address", () => {
    for (const text of ["Ada Lovelace", "ada@example.com", "Bob", "bob@example.com", "Cy"]) {
      expect(markup).toContain(text);
    }
  });

  it("marks the signed-in person", () => {
    expect(markup.match(/\(you\)/g)).toHaveLength(1);
  });

  it("names roles in words and says when there is none", () => {
    expect(markup).toContain("Admin");
    expect(markup).toContain("Carrier user");
    expect(markup).toContain("Sales");
    expect(markup).toContain("No role");
  });

  it("states each status in words, with the matching color", () => {
    expect(markup).toContain("Active");
    expect(markup).toContain("Invited");
    expect(markup).toContain("Suspended");
    expect(markup).toContain("text-positive");
    expect(markup).toContain("text-warning");
  });

  it("has column headers", () => {
    expect(markup.match(/scope="col"/g)).toHaveLength(4);
  });
});

describe("roleLabel", () => {
  it("falls back to the key for a role it has no name for", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("auditor")).toBe("auditor");
  });
});

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    expect(html(<Pagination page={1} pageSize={25} total={25} path="/members" />)).toBe("");
  });

  it("links to the next page from the first", () => {
    const markup = html(<Pagination page={1} pageSize={25} total={60} path="/members" />);
    expect(markup).toContain('href="/members?page=2"');
    expect(markup).not.toContain("Previous");
    expect(markup).toContain("Page 1 of 3, 60 in total");
  });

  it("links both ways in the middle and only back on the last page", () => {
    const middle = html(<Pagination page={2} pageSize={25} total={60} path="/members" />);
    expect(middle).toContain('href="/members?page=1"');
    expect(middle).toContain('href="/members?page=3"');
    const last = html(<Pagination page={3} pageSize={25} total={60} path="/members" />);
    expect(last).toContain("Previous");
    expect(last).not.toContain("Next");
  });
});

describe("OrganizationDetails", () => {
  const organization = {
    id: "o1",
    name: "Acme Logistics",
    slug: "acme-logistics",
    region: "us" as const,
    distanceUnit: "mi" as const,
    weightUnit: "lb" as const,
    currency: "USD",
    locale: "en-US",
    timezone: "America/Chicago",
  };

  it("describes units in words", () => {
    const text = Object.fromEntries(describeOrganization(organization));
    expect(text).toMatchObject({
      Region: "United States",
      "Distance unit": "Miles",
      "Weight unit": "Pounds",
      Currency: "USD",
      "Time zone": "America/Chicago",
    });
  });

  it("renders a description list", () => {
    const markup = html(<OrganizationDetails organization={organization} />);
    expect(markup).toContain("<dl");
    expect(markup).toContain("Acme Logistics");
    expect(markup).toContain("acme-logistics");
  });
});

describe("screens and notices", () => {
  it("announce messages to screen readers", () => {
    expect(html(<Notice>Problem</Notice>)).toContain('role="alert"');
  });

  it("SignedOutScreen offers the sign-in link and shows a known sign-in error", () => {
    const markup = html(<SignedOutScreen error="login_expired" />);
    expect(markup).toContain('href="/login"');
    expect(markup).toContain(SIGN_IN_ERRORS["login_expired"]);
  });

  it("SignedOutScreen ignores an error code it does not know, so URLs cannot inject text", () => {
    const markup = html(<SignedOutScreen error="<script>alert(1)</script>" />);
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain('role="alert"');
  });

  it("ProblemScreen explains the problem and offers to sign out", () => {
    const markup = html(<ProblemScreen problem="email_not_verified" />);
    expect(markup).toContain("not verified");
    expect(markup).toContain('action="/logout"');
    expect(markup).toContain('method="post"');
  });

  it("NotConfiguredScreen points to the setup guide", () => {
    expect(html(<NotConfiguredScreen />)).toContain("docs/dev-setup-zitadel.md");
  });

  it("ForbiddenNotice says access is missing without revealing details", () => {
    const markup = html(<ForbiddenNotice />);
    expect(markup).toContain("do not have access");
    expect(markup).toContain("<h1");
  });
});

describe("MasterDataList", () => {
  const config = MASTER_DATA.customers;
  const base = {
    config,
    total: 0,
    page: 1,
    pageSize: 25,
    q: "",
    includeArchived: false,
    canManage: true,
  };

  it("invites a manager to add the first record", () => {
    const markup = html(<MasterDataList {...base} records={[]} />);
    expect(markup).toContain("No customers yet");
    expect(markup).toContain('href="/customers/new"');
  });

  it("does not offer to add when the person cannot manage", () => {
    const markup = html(<MasterDataList {...base} records={[]} canManage={false} />);
    expect(markup).not.toContain("/customers/new");
  });

  it("says nothing matched instead of 'no records yet' when filtered", () => {
    const markup = html(<MasterDataList {...base} records={[]} q="zzz" />);
    expect(markup).toContain("No customers match");
    expect(markup).not.toContain("/customers/new");
  });

  it("links each record to its page and marks archived ones", () => {
    const records = [
      { id: "a1", name: "Acme", contactName: "Pat", contactEmail: null, archivedAt: null },
      {
        id: "b2",
        name: "Old Co",
        contactName: null,
        contactEmail: "x@y.z",
        archivedAt: "2026-01-01",
      },
    ];
    const markup = html(<MasterDataList {...base} records={records} total={2} />);
    expect(markup).toContain('href="/customers/a1"');
    expect(markup).toContain("Acme");
    expect(markup).toContain("–");
    expect(markup.match(/Archived/g)).toHaveLength(1);
  });

  it("keeps the search text in the page links", () => {
    const records = [{ id: "a1", name: "Acme" }];
    const markup = html(
      <MasterDataList {...base} records={records} total={60} q="ac" includeArchived />,
    );
    expect(markup).toContain("page=2");
    expect(markup).toContain("q=ac");
    expect(markup).toContain("archived=1");
  });
});

describe("TransportsList", () => {
  const item = {
    id: "t1",
    number: 7,
    reference: "LL-000007",
    status: "in_transit" as const,
    customer: { id: "c1", name: "Acme Foods" },
    carrier: null,
    customerReference: "SO-1001",
    purchaseOrder: null,
    origin: {
      city: "Dallas",
      state: "TX",
      timezone: "America/Chicago",
      windowStart: "2026-12-01T20:00:00.000Z",
    },
    destination: {
      city: "Denver",
      state: "CO",
      timezone: "America/Denver",
      windowStart: "2026-12-02T15:00:00.000Z",
    },
    createdAt: "2026-11-30T12:00:00.000Z",
  };
  const base = { total: 1, page: 1, pageSize: 25, q: "", status: "", canManage: true };

  it("shows the transport with its status in words, route, pickup time in the pickup's zone and carrier", () => {
    const markup = html(<TransportsList {...base} items={[item]} />);
    expect(markup).toContain('href="/transports/t1"');
    expect(markup).toContain("LL-000007");
    expect(markup).toContain("SO-1001");
    expect(markup).toContain("In transit");
    expect(markup).toContain("Dallas, TX");
    expect(markup).toContain("Denver, CO");
    expect(markup).toContain("12/01/2026 2:00 PM CST");
    expect(markup).toContain("Not assigned");
  });

  it("offers to create the first transport only to people who may", () => {
    expect(html(<TransportsList {...base} items={[]} total={0} />)).toContain("/transports/new");
    expect(html(<TransportsList {...base} items={[]} total={0} canManage={false} />)).not.toContain(
      "/transports/new",
    );
  });

  it("says nothing matched when filtered, and keeps the filter in the page links", () => {
    expect(html(<TransportsList {...base} items={[]} total={0} q="zzz" />)).toContain(
      "No transports match",
    );
    const markup = html(
      <TransportsList {...base} items={[item]} total={80} q="acme" status="planned" />,
    );
    expect(markup).toContain("q=acme");
    expect(markup).toContain("status=planned");
  });

  it("does not offer a delayed filter: delay is derived later, not a status", () => {
    expect(html(<TransportsList {...base} items={[]} total={0} />)).not.toContain("Delayed");
  });
});

describe("Dashboard", () => {
  const summary = {
    total: 12,
    byStatus: { created: 2, planned: 3, in_transit: 4, delivered: 3 },
    active: 4,
    open: 5,
    withoutCarrier: 5,
    pickupsNext24Hours: 2,
    deliveredLast7Days: 3,
  };

  it("shows the counts and links to the matching list", () => {
    const markup = html(<Dashboard summary={summary} canManage />);
    expect(markup).toContain("Active");
    expect(markup).toContain("Pickups in 24 hours");
    expect(markup).toContain('href="/transports?status=created,planned"');
    expect(markup).toContain("12 in total");
    expect(markup).toContain("In transit");
  });

  it("lists every status, also those with no transports, as zero", () => {
    const markup = html(<Dashboard summary={summary} canManage />);
    expect(markup).toContain("Completed");
    expect(markup).toContain("Cancelled");
  });

  it("is honest about what it does not know yet: no late or position counts", () => {
    const markup = html(<Dashboard summary={summary} canManage />);
    expect(markup).toContain("does not estimate");
    expect(markup).not.toContain("Late transports</p>");
  });

  it("shows an empty state instead of zeros when there are no transports", () => {
    const empty = { ...summary, total: 0, byStatus: {}, active: 0, open: 0 };
    expect(html(<Dashboard summary={empty} canManage />)).toContain("No transports yet");
    expect(html(<Dashboard summary={empty} canManage />)).toContain("/transports/new");
    expect(html(<Dashboard summary={empty} canManage={false} />)).not.toContain("/transports/new");
  });
});
