import { describe, it, expect } from "vitest";
import { exportSqlBlob, DEFAULT_SQL_OPTIONS, type SqlOptions } from "./sql";
import type { ExportColumn } from "./types";

/**
 * Expectations mirror the Rust exporter's tests in
 * `src-tauri/src/exporters/sql.rs` — see the note in `json.test.ts` for why
 * both sides assert against the same literals.
 */

const col = (name: string): ExportColumn => ({ name });
const typedCol = (name: string, pgType: string): ExportColumn => ({
  name,
  pgType,
});

async function exportText(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  opts: Partial<SqlOptions> = {},
): Promise<string> {
  const blob = exportSqlBlob(rows, columns, {
    ...DEFAULT_SQL_OPTIONS,
    table: "users",
    ...opts,
  });
  return blob.text();
}

describe("exportSqlBlob", () => {
  it("writes one statement per row by default", async () => {
    const out = await exportText(
      [
        { id: 1, name: "Ada" },
        { id: 2, name: "Bob" },
      ],
      [col("id"), col("name")],
    );
    expect(out).toBe(
      'INSERT INTO "public"."users" ("id", "name") VALUES (1, \'Ada\');\n' +
        'INSERT INTO "public"."users" ("id", "name") VALUES (2, \'Bob\');\n',
    );
  });

  it("doubles an embedded quote", async () => {
    const out = await exportText([{ name: "O'Brien" }], [col("name")]);
    expect(out).toContain("('O''Brien')");
  });

  it("leaves backslashes alone", async () => {
    const out = await exportText([{ p: "C:\\tmp" }], [col("p")]);
    expect(out).toContain("('C:\\tmp')");
  });

  it("writes nulls and booleans as bare keywords", async () => {
    const out = await exportText(
      [{ a: null, b: true, c: false }],
      [col("a"), col("b"), col("c")],
    );
    expect(out).toContain("(NULL, TRUE, FALSE)");
  });

  it("renders nested values as quoted JSON", async () => {
    const out = await exportText([{ meta: { k: 1 } }], [col("meta")]);
    expect(out).toContain("('{\"k\":1}')");
  });

  it("escapes a quote inside JSON for SQL", async () => {
    const out = await exportText([{ meta: { k: "it's" } }], [col("meta")]);
    expect(out).toContain("('{\"k\":\"it''s\"}')");
  });

  it("uses array-literal syntax for array columns", async () => {
    // The decoder hands us a JS array for both `text[]` and `jsonb`; only the
    // column type says which literal PostgreSQL will accept.
    const out = await exportText(
      [{ tags: ["vip", "premium"] }],
      [typedCol("tags", "_text")],
    );
    expect(out).toContain("('{vip,premium}')");
  });

  it("keeps JSON syntax for json columns", async () => {
    const out = await exportText(
      [{ meta: ["vip", "premium"] }],
      [typedCol("meta", "jsonb")],
    );
    expect(out).toContain('(\'["vip","premium"]\')');
  });

  it("quotes ambiguous array elements", async () => {
    const out = await exportText(
      [{ tags: ["a b", "c,d", "", "NULL", "plain"] }],
      [typedCol("tags", "TEXT[]")],
    );
    expect(out).toContain('(\'{"a b","c,d","","NULL",plain}\')');
  });

  it("escapes quotes and backslashes in array elements", async () => {
    const out = await exportText(
      [{ tags: ['say "hi"', "back\\slash"] }],
      [typedCol("tags", "_text")],
    );
    expect(out).toContain('(\'{"say \\"hi\\"","back\\\\slash"}\')');
  });

  it("leaves a null array element unquoted", async () => {
    const out = await exportText(
      [{ tags: ["a", null] }],
      [typedCol("tags", "_text")],
    );
    expect(out).toContain("('{a,NULL}')");
  });

  it("doubles a quote inside an array element for SQL", async () => {
    const out = await exportText(
      [{ tags: ["it's"] }],
      [typedCol("tags", "_text")],
    );
    expect(out).toContain("('{it''s}')");
  });

  it("writes an empty array as empty braces", async () => {
    const out = await exportText([{ tags: [] }], [typedCol("tags", "_text")]);
    expect(out).toContain("('{}')");
  });

  it("escapes quotes in identifiers", async () => {
    const out = await exportText([{ 'c"ol': 1 }], [col('c"ol')], {
      table: 'we"ird',
    });
    expect(out).toContain('"we""ird" ("c""ol")');
  });

  it("can omit the schema", async () => {
    const out = await exportText([{ id: 1 }], [col("id")], {
      include_schema: false,
    });
    expect(out).toBe('INSERT INTO "users" ("id") VALUES (1);\n');
  });

  it("batches rows into one statement", async () => {
    const out = await exportText(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [col("id")],
      { rows_per_statement: 2 },
    );
    expect(out).toBe(
      'INSERT INTO "public"."users" ("id") VALUES\n  (1),\n  (2);\n' +
        'INSERT INTO "public"."users" ("id") VALUES\n  (3);\n',
    );
  });

  it("treats a zero batch size as one", async () => {
    const out = await exportText([{ id: 1 }, { id: 2 }], [col("id")], {
      rows_per_statement: 0,
    });
    expect(out.match(/INSERT INTO/g)).toHaveLength(2);
  });

  it("wraps the script in a transaction", async () => {
    const out = await exportText([{ id: 1 }], [col("id")], {
      transaction: true,
    });
    expect(out).toBe(
      'BEGIN;\nINSERT INTO "public"."users" ("id") VALUES (1);\nCOMMIT;\n',
    );
  });

  it("produces a valid script for an empty result", async () => {
    const out = await exportText([], [col("id")], { transaction: true });
    expect(out).toBe("BEGIN;\nCOMMIT;\n");
  });

  it("applies ON CONFLICT to every statement", async () => {
    const out = await exportText([{ id: 1 }, { id: 2 }], [col("id")], {
      on_conflict_do_nothing: true,
    });
    expect(out.match(/ON CONFLICT DO NOTHING;/g)).toHaveLength(2);
  });

  it("pads a column missing from the row with NULL", async () => {
    const out = await exportText([{ id: 1 }], [col("id"), col("name")]);
    expect(out).toBe(
      'INSERT INTO "public"."users" ("id", "name") VALUES (1, NULL);\n',
    );
  });
});
