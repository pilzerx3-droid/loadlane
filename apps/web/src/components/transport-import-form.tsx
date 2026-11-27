"use client";

import { useActionState, useState } from "react";
import { Button, Card } from "@loadlane/ui";
import { importTransportsAction, type ImportState } from "../app/transport-actions";
import { Notice } from "./notices";

/** Paste or upload a CSV file, check it, then import it. All rows are imported or none. */
export function TransportImportForm() {
  const initial: ImportState = { csv: "" };
  const [state, action, pending] = useActionState(importTransportsAction, initial);
  const [csv, setCsv] = useState(state.csv);
  const report = state.report;
  const checkedClean =
    report?.status === "preview" && report.summary.failed === 0 && report.summary.total > 0;

  async function onFile(file: File | undefined) {
    if (file) setCsv(await file.text());
  }

  return (
    <form action={action} className="space-y-5">
      {state.message ? <Notice>{state.message}</Notice> : null}

      <Card className="space-y-4 p-5">
        <div>
          <label htmlFor="file" className="mb-1 block text-[13px] font-semibold">
            CSV file
          </label>
          <input
            id="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void onFile(event.target.files?.[0])}
            className="text-sm"
          />
        </div>
        <div>
          <label htmlFor="csv" className="mb-1 block text-[13px] font-semibold">
            Or paste the CSV text
          </label>
          <textarea
            id="csv"
            name="csv"
            rows={8}
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            spellCheck={false}
            className="w-full rounded-control border border-border bg-card px-3 py-2 font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="check" disabled={pending || csv.trim() === ""}>
            {pending ? "Working…" : "Check file"}
          </Button>
          {checkedClean && csv === state.csv ? (
            <Button type="submit" name="intent" value="import" variant="solid" disabled={pending}>
              Import {report.summary.total} transport{report.summary.total === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      </Card>

      {report ? (
        <Card className="space-y-3 p-5" aria-live="polite">
          {report.status === "imported" ? (
            <p className="font-semibold">
              Imported {report.created.length} transport{report.created.length === 1 ? "" : "s"}:{" "}
              <a href="/transports" className="underline">
                see the list
              </a>
              .
            </p>
          ) : report.fileProblems.length > 0 ? (
            <>
              <p className="font-semibold">The file cannot be imported.</p>
              <ul className="list-disc pl-5 text-sm">
                {report.fileProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="font-semibold">
                {report.summary.failed === 0
                  ? `${report.summary.total} row${report.summary.total === 1 ? "" : "s"} look good. Nothing has been imported yet.`
                  : `${report.summary.failed} of ${report.summary.total} rows have problems. Nothing is imported until all rows are fixed.`}
              </p>
              {report.rows
                .filter((row) => row.problems.length > 0)
                .map((row) => (
                  <div key={row.line} className="text-sm">
                    <p className="font-medium">Line {row.line}</p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {row.problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </>
          )}
        </Card>
      ) : null}
    </form>
  );
}
