import {
  QUOTE_STATUS_LABELS,
  formatInZone,
  formatPercent,
  formatUsd,
  isQuoteStatus,
} from "@loadlane/shared";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  NativeSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@loadlane/ui";
import {
  changeQuoteStatusAction,
  emailQuoteAction,
  createQuoteAction,
  updateQuoteAction,
} from "../app/quote-actions";
import type { QuoteDetail, QuoteSummary } from "../lib/quotes";

export const QUOTE_PROBLEMS: Record<string, string> = {
  invalid: "These values were not accepted. Check the dates and try again.",
  needs_customer: "This calculation has no customer. Choose one for the quote.",
  not_editable: "Only a draft quote can be edited.",
  expired: "The validity date has passed. Change the date first (draft) or create a new quote.",
  invalid_transition: "That status change is not possible from the current status.",
  forbidden: "You do not have permission to change quotes.",
  not_found: "This quote or calculation no longer exists.",
  unavailable: "Loadlane could not save this right now. Please try again in a moment.",
  send_failed: "The e-mail could not be sent. Download the PDF and send it yourself.",
  mail_unconfigured:
    "E-mail is not set up on this server yet. Download the PDF and send it yourself.",
  not_sendable: "Mark the quote as sent before e-mailing it.",
  needs_address: "The customer has no contact e-mail stored. Enter an address.",
  invalid_address: "That e-mail address was not accepted.",
};

function statusText(status: string, expired: boolean): string {
  if (expired) return "Expired";
  return isQuoteStatus(status) ? QUOTE_STATUS_LABELS[status] : status;
}

export function QuotesList({ items, canManage }: { items: QuoteSummary[]; canManage: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No quotes yet"
        description={
          canManage
            ? "Open a saved calculation and create a quote from it."
            : "Nobody has created a quote yet."
        }
        action={
          <a href="/calculations" className="text-sm underline">
            Go to calculations
          </a>
        }
      />
    );
  }
  return (
    <Card className="p-2 sm:p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quote</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Valid until</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <a href={`/quotes/${item.id}`} className="font-medium hover:underline">
                  {item.reference}
                </a>
                <p className="text-xs text-muted-foreground">{item.calculationName}</p>
              </TableCell>
              <TableCell>{item.customer.name}</TableCell>
              <TableCell>{statusText(item.status, item.expired)}</TableCell>
              <TableCell className="text-right font-mono">{formatUsd(item.priceCents)}</TableCell>
              <TableCell className="text-muted-foreground">{item.validUntil}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Form to create a draft quote from one calculation. */
export function NewQuoteForm({
  calculationId,
  calculationName,
  priceCents,
  customerFixed,
  customers,
  defaultValidUntil,
}: {
  calculationId: string;
  calculationName: string;
  priceCents: number;
  /** True when the calculation already has a customer; then no choice is offered. */
  customerFixed: boolean;
  customers: { id: string; label: string }[];
  defaultValidUntil: string;
}) {
  return (
    <form action={createQuoteAction} className="space-y-5">
      <input type="hidden" name="calculationId" value={calculationId} />
      <Card className="space-y-4 p-5">
        <p className="text-sm">
          Offering <span className="font-semibold">{formatUsd(priceCents)}</span> from the
          calculation “{calculationName}”. The price is copied and will not change.
        </p>
        {!customerFixed ? (
          <div>
            <label htmlFor="quote-customer" className="mb-1 block text-[13px] font-semibold">
              Customer
            </label>
            <NativeSelect id="quote-customer" name="customerId" required defaultValue="">
              <option value="" disabled>
                Choose a customer
              </option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div>
          <label htmlFor="quote-valid" className="mb-1 block text-[13px] font-semibold">
            Valid until
          </label>
          <Input
            id="quote-valid"
            name="validUntil"
            type="date"
            required
            defaultValue={defaultValidUntil}
          />
        </div>
        <div>
          <label htmlFor="quote-terms" className="mb-1 block text-[13px] font-semibold">
            Terms shown to the customer (optional)
          </label>
          <textarea
            id="quote-terms"
            name="terms"
            rows={4}
            className="w-full rounded-control border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="quote-notes" className="mb-1 block text-[13px] font-semibold">
            Internal notes (optional)
          </label>
          <textarea
            id="quote-notes"
            name="notes"
            rows={2}
            className="w-full rounded-control border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </Card>
      <Button type="submit" variant="solid">
        Create draft quote
      </Button>
    </form>
  );
}

export function QuoteDetailView({
  quote,
  canManage,
  canCreateTransport = false,
  timeZone,
}: {
  quote: QuoteDetail;
  canManage: boolean;
  /** Whether the person may create transports (a different permission than managing quotes). */
  canCreateTransport?: boolean;
  timeZone: string;
}) {
  const next = quote.allowedStatuses;
  return (
    <div className="space-y-5">
      <Card className="space-y-2 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-mono text-3xl font-semibold">{formatUsd(quote.priceCents)}</p>
          <span className="rounded-control border border-border px-3 py-1 text-sm font-medium">
            {statusText(quote.status, quote.expired)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          For {quote.customer.name} · valid until {quote.validUntil}
          {quote.expired ? " (the validity date has passed)" : ""}
        </p>
        {quote.sentAt ? (
          <p className="text-sm text-muted-foreground">
            Sent {formatInZone(quote.sentAt, timeZone)}
          </p>
        ) : null}
        {quote.decidedAt ? (
          <p className="text-sm text-muted-foreground">
            Decided {formatInZone(quote.decidedAt, timeZone)}
          </p>
        ) : null}
        {quote.terms ? <p className="whitespace-pre-line pt-2 text-sm">{quote.terms}</p> : null}
        <p className="pt-2 text-sm">
          <a href={`/quotes/${quote.id}/pdf`} className="underline">
            Download as PDF
          </a>{" "}
          <span className="text-muted-foreground">
            (for the customer: price, validity and terms; no cost or margin)
          </span>
        </p>
      </Card>

      <Card className="space-y-1 p-5 text-sm">
        <CardHeader>
          <CardTitle>Internal view</CardTitle>
        </CardHeader>
        <p>
          Cost {formatUsd(quote.calculation.costCents)} · contribution{" "}
          {formatUsd(quote.calculation.contributionCents)} · markup{" "}
          {quote.calculation.markupBp === null ? "n/a" : formatPercent(quote.calculation.markupBp)}{" "}
          · margin{" "}
          {quote.calculation.marginBp === null ? "n/a" : formatPercent(quote.calculation.marginBp)}
        </p>
        <p className="text-muted-foreground">
          From calculation “{quote.calculationName}”.{" "}
          <a href={`/calculations/${quote.calculation.id}`} className="underline">
            Open calculation
          </a>
          {quote.notes ? ` · Notes: ${quote.notes}` : ""}
        </p>
      </Card>

      {quote.status === "accepted" ? (
        <Card className="space-y-2 p-5 text-sm">
          <h2 className="text-base font-semibold">Transport</h2>
          {quote.transport ? (
            <p>
              Transport{" "}
              <a href={`/transports/${quote.transport.id}`} className="underline">
                {quote.transport.reference}
              </a>{" "}
              was created from this quote.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                The customer accepted. Create the transport from this quote: the customer, the price
                reference and a note are filled in, you add stops and times.
              </p>
              {canCreateTransport ? (
                <Button asChild variant="solid">
                  <a href={`/transports/new?quote=${quote.id}`}>Create transport from this quote</a>
                </Button>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {canManage && next.length > 0 ? (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold">Next step</h2>
          <div className="flex flex-wrap gap-2">
            {next.map((status) => (
              <form key={status} action={changeQuoteStatusAction.bind(null, quote.id)}>
                <input type="hidden" name="status" value={status} />
                <Button type="submit" variant={status === "cancelled" ? "outline" : "solid"}>
                  {status === "sent"
                    ? "Mark as sent"
                    : status === "accepted"
                      ? "Customer accepted"
                      : status === "rejected"
                        ? "Customer rejected"
                        : "Cancel quote"}
                </Button>
              </form>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Mark the quote as sent once it went to your customer. After that you can e-mail the PDF
            from here.
          </p>
        </Card>
      ) : null}

      {canManage && quote.status === "sent" && !quote.expired ? (
        <form action={emailQuoteAction.bind(null, quote.id)}>
          <Card className="space-y-3 p-5">
            <h2 className="text-base font-semibold">E-mail the PDF</h2>
            <div>
              <label htmlFor="email-to" className="mb-1 block text-[13px] font-semibold">
                To (leave empty to use the customer contact e-mail)
              </label>
              <Input
                id="email-to"
                name="to"
                type="email"
                autoComplete="off"
                placeholder="customer@example.com"
              />
            </div>
            <Button type="submit" variant="outline">
              Send quote by e-mail
            </Button>
          </Card>
        </form>
      ) : null}

      {canManage && quote.editable ? (
        <form action={updateQuoteAction.bind(null, quote.id)}>
          <Card className="space-y-4 p-5">
            <h2 className="text-base font-semibold">Edit draft</h2>
            <div>
              <label htmlFor="edit-valid" className="mb-1 block text-[13px] font-semibold">
                Valid until
              </label>
              <Input
                id="edit-valid"
                name="validUntil"
                type="date"
                required
                defaultValue={quote.validUntil}
              />
            </div>
            <div>
              <label htmlFor="edit-terms" className="mb-1 block text-[13px] font-semibold">
                Terms
              </label>
              <textarea
                id="edit-terms"
                name="terms"
                rows={4}
                defaultValue={quote.terms ?? ""}
                className="w-full rounded-control border border-border bg-card px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="edit-notes" className="mb-1 block text-[13px] font-semibold">
                Internal notes
              </label>
              <textarea
                id="edit-notes"
                name="notes"
                rows={2}
                defaultValue={quote.notes ?? ""}
                className="w-full rounded-control border border-border bg-card px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" variant="outline">
              Save changes
            </Button>
          </Card>
        </form>
      ) : null}
    </div>
  );
}
