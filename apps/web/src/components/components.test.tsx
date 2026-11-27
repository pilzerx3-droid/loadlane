import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
