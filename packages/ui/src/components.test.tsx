import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldMessage,
  Input,
  Label,
  NativeSelect,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "./index";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("cn", () => {
  it("joins classes and lets the last conflicting Tailwind class win", () => {
    expect(cn("p-2", false, "p-4", undefined, "text-sm")).toBe("p-4 text-sm");
  });
});

describe("Button", () => {
  it("is a type=button button by default, so it never submits a form by accident", () => {
    expect(html(<Button>Save</Button>)).toContain('type="button"');
  });

  it("can submit when it says so", () => {
    expect(html(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });

  it("lends its look to a link with asChild", () => {
    const markup = html(
      <Button asChild variant="outline">
        <a href="/members">Members</a>
      </Button>,
    );
    expect(markup).toMatch(/^<a href="\/members" class="[^"]*border-border/);
    expect(markup).not.toContain("<button");
  });

  it("applies the size and lets callers add classes", () => {
    const markup = html(
      <Button size="sm" className="w-full">
        Go
      </Button>,
    );
    expect(markup).toContain("h-8");
    expect(markup).toContain("w-full");
  });
});

describe("Badge", () => {
  it("shows its text, not only a color", () => {
    expect(html(<Badge variant="warning">Late +25 min</Badge>)).toContain("Late +25 min");
  });

  it("has a variant for each status color", () => {
    expect(html(<Badge variant="positive">ok</Badge>)).toContain("text-positive");
    expect(html(<Badge variant="warning">late</Badge>)).toContain("text-warning");
    expect(html(<Badge variant="danger">failed</Badge>)).toContain("text-danger");
    expect(html(<Badge>plain</Badge>)).toContain("bg-muted");
  });
});

describe("EmptyState", () => {
  it("says what is missing and offers the next step", () => {
    const markup = html(
      <EmptyState
        title="No transports yet"
        description="Transports will appear here."
        action={<a href="/new">Create one</a>}
      />,
    );
    expect(markup).toContain("<h2");
    expect(markup).toContain("No transports yet");
    expect(markup).toContain("Transports will appear here.");
    expect(markup).toContain('href="/new"');
  });

  it("works with only a title", () => {
    expect(html(<EmptyState title="Nothing here" />)).not.toContain("<p");
  });
});

describe("PageHeader", () => {
  it("renders the page title as the one h1", () => {
    const markup = html(
      <PageHeader title="Members" description="Who belongs here" actions={<span>act</span>} />,
    );
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Members");
    expect(markup).toContain("Who belongs here");
    expect(markup).toContain("act");
  });
});

describe("form controls", () => {
  it("connect a label to its input", () => {
    const markup = html(
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required />
      </div>,
    );
    expect(markup).toContain('for="name"');
    expect(markup).toContain('id="name"');
    expect(markup).toContain("required");
  });

  it("announce an error and keep a hint quiet", () => {
    expect(html(<FieldMessage invalid>Too short</FieldMessage>)).toContain('role="alert"');
    expect(html(<FieldMessage>Hint</FieldMessage>)).not.toContain("role=");
  });

  it("render a native select with its options", () => {
    const markup = html(
      <NativeSelect name="zone" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    );
    expect(markup).toContain("<select");
    expect(markup).toContain("<option");
  });
});

describe("Table", () => {
  it("renders column headers with scope=col", () => {
    const markup = html(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>E-mail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>a@example.com</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(markup).toContain('scope="col"');
    expect(markup).toContain("a@example.com");
  });
});

describe("Card and Skeleton", () => {
  it("render their children", () => {
    expect(html(<Card>content</Card>)).toContain("content");
  });

  it("hide the loading placeholder from screen readers", () => {
    expect(html(<Skeleton className="h-4 w-20" />)).toContain('aria-hidden="true"');
  });
});
