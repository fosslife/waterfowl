import { describe, it, expect } from "vitest";
import { exportJsonBlob, DEFAULT_JSON_OPTIONS, type JsonOptions } from "./json";
import type { ExportColumn } from "./types";

/**
 * These expectations are copied verbatim from the Rust exporter's tests in
 * `src-tauri/src/exporters/json.rs`. The in-memory (current page / selection)
 * path runs this file and the streamed path runs the Rust one, so the two
 * must produce identical bytes for the same rows — asserting both against
 * the same literals is what keeps them honest.
 */

const col = (name: string): ExportColumn => ({ name });

async function exportText(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  opts: Partial<JsonOptions> = {},
): Promise<string> {
  const blob = exportJsonBlob(rows, columns, {
    ...DEFAULT_JSON_OPTIONS,
    ...opts,
  });
  return blob.text();
}

describe("exportJsonBlob", () => {
  it("emits the array layout as a single document", async () => {
    const out = await exportText(
      [
        { a: 1, b: "x" },
        { a: 2, b: "y" },
      ],
      [col("a"), col("b")],
    );
    expect(out).toBe('[{"a":1,"b":"x"},{"a":2,"b":"y"}]\n');
  });

  it("emits an empty array for no rows", async () => {
    const out = await exportText([], [col("a")]);
    expect(out).toBe("[]\n");
  });

  it("emits ndjson with no wrapper", async () => {
    const out = await exportText([{ a: 1 }, { a: 2 }, { a: 3 }], [col("a")], {
      layout: "ndjson",
    });
    expect(out).toBe('{"a":1}\n{"a":2}\n{"a":3}\n');
  });

  it("emits nothing for an empty ndjson export", async () => {
    const out = await exportText([], [col("a")], { layout: "ndjson" });
    expect(out).toBe("");
  });

  it("includes nulls by default", async () => {
    const out = await exportText([{ a: null, b: 1 }], [col("a"), col("b")]);
    expect(out).toBe('[{"a":null,"b":1}]\n');
  });

  it("omits null fields when asked", async () => {
    const out = await exportText([{ a: null, b: 1 }], [col("a"), col("b")], {
      include_nulls: false,
    });
    expect(out).toBe('[{"b":1}]\n');
  });

  it("indents each object when pretty-printing", async () => {
    const out = await exportText(
      [
        { a: 1, b: "x" },
        { a: 2, b: "y" },
      ],
      [col("a"), col("b")],
      { pretty: true },
    );
    expect(out).toBe(
      '[\n  {\n    "a": 1,\n    "b": "x"\n  },\n  {\n    "a": 2,\n    "b": "y"\n  }\n]\n',
    );
  });

  it("passes nested values through unchanged", async () => {
    const out = await exportText([{ a: { k: [1, 2] } }], [col("a")]);
    expect(out).toBe('[{"a":{"k":[1,2]}}]\n');
  });

  it("writes null for a column missing from the row", async () => {
    const out = await exportText([{ a: 1 }], [col("a"), col("b")]);
    expect(out).toBe('[{"a":1,"b":null}]\n');
  });

  it("follows column order, not row key order", async () => {
    // Rows arrive as objects whose key order we don't control; the exported
    // key order has to match the columns the user sees.
    const out = await exportText([{ b: "x", a: 1 }], [col("a"), col("b")]);
    expect(out).toBe('[{"a":1,"b":"x"}]\n');
  });

  it("treats undefined the same as null", async () => {
    const out = await exportText([{ a: undefined }], [col("a")]);
    expect(out).toBe('[{"a":null}]\n');
  });
});
