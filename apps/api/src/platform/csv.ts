/**
 * Reads CSV text (RFC 4180): comma separated, fields in double quotes may contain commas, line breaks
 * and doubled quotes. A byte order mark at the start (Excel adds one) is ignored. Blank lines are
 * skipped. Returns the rows as arrays of fields, each with the line number it started on.
 * Throws CsvError for text that cannot be read, such as a quote that is never closed.
 */
export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

export interface CsvRow {
  line: number;
  fields: string[];
}

export function parseCsv(input: string): CsvRow[] {
  const text = input.startsWith("﻿") ? input.slice(1) : input;
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let line = 1;
  let rowLine = 1;

  const endField = (): void => {
    fields.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = (): void => {
    endField();
    if (fields.length > 1 || fields[0]?.trim() !== "") rows.push({ line: rowLine, fields });
    fields = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index] as string;
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        if (character === "\n") line++;
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "" && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (character === ",") {
      endField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      endRow();
      line++;
      rowLine = line;
    } else if (fieldWasQuoted) {
      throw new CsvError("Unexpected text after a closing quote", line);
    } else {
      field += character;
    }
  }
  if (inQuotes) throw new CsvError("A quoted field is never closed", rowLine);
  if (field !== "" || fields.length > 0 || fieldWasQuoted) endRow();
  return rows;
}
