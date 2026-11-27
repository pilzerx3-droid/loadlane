import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "./csv.ts";

const fields = (text: string) => parseCsv(text).map((row) => row.fields);

describe("parseCsv", () => {
  it("reads rows and fields", () => {
    expect(fields("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("reads Windows line breaks, a missing final line break and blank lines", () => {
    expect(fields("a,b\r\n\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields", () => {
    expect(fields("a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("reads quoted fields with commas, doubled quotes and line breaks", () => {
    expect(fields('"Smith, John","He said ""hi""","line1\nline2"\n')).toEqual([
      ["Smith, John", 'He said "hi"', "line1\nline2"],
    ]);
  });

  it("ignores a byte order mark", () => {
    expect(fields("﻿a,b\n")).toEqual([["a", "b"]]);
  });

  it("reports the line each row started on, also after a multi-line field", () => {
    const rows = parseCsv('a,b\n"x\ny",1\n\nlast,2');
    expect(rows.map((row) => row.line)).toEqual([1, 2, 5]);
  });

  it("keeps spaces inside fields", () => {
    expect(fields(" a , b \n")).toEqual([[" a ", " b "]]);
  });

  it("refuses a quote that is never closed", () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow(CsvError);
  });

  it("refuses text after a closing quote", () => {
    expect(() => parseCsv('"a"b,c')).toThrow(CsvError);
  });

  it("treats a quote in the middle of an unquoted field as text", () => {
    expect(fields('5" pipe,x')).toEqual([['5" pipe', "x"]]);
  });

  it("returns nothing for empty text", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});
