import { describe, expect, it } from "vitest";
import { splitStatements, statementAtCursor } from "./sqlStatements";

const texts = (sql: string) => splitStatements(sql).map((s) => s.text);

describe("splitStatements", () => {
  it("splits on top-level semicolons", () => {
    expect(texts("SELECT 1; SELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps a final statement that has no terminator", () => {
    expect(texts("SELECT 1")).toEqual(["SELECT 1"]);
  });

  it("yields nothing for input with no statements", () => {
    expect(texts("")).toEqual([]);
    expect(texts(";;;")).toEqual([]);
    expect(texts("-- nothing here\n/* nor here */")).toEqual([]);
  });

  describe("semicolons that are not boundaries", () => {
    it("ignores one inside a string literal", () => {
      expect(texts("SELECT ';'; SELECT 2")).toEqual(["SELECT ';'", "SELECT 2"]);
    });

    it("handles a doubled-quote escape inside a literal", () => {
      expect(texts("SELECT 'it''s; fine'; SELECT 2")).toEqual([
        "SELECT 'it''s; fine'",
        "SELECT 2",
      ]);
    });

    it("treats backslash as an escape only in an E'' string", () => {
      expect(texts("SELECT E'a\\'; b'; SELECT 2")).toEqual([
        "SELECT E'a\\'; b'",
        "SELECT 2",
      ]);
      // standard_conforming_strings has been on by default since 9.1, so here
      // the backslash is literal and the quote still closes the string.
      expect(texts("SELECT 'a\\'; SELECT 2")).toEqual([
        "SELECT 'a\\'",
        "SELECT 2",
      ]);
    });

    it("ignores one inside a quoted identifier", () => {
      expect(texts('SELECT "a;b" FROM t; SELECT 2')).toEqual([
        'SELECT "a;b" FROM t',
        "SELECT 2",
      ]);
    });

    it("ignores one inside a line comment", () => {
      expect(texts("SELECT 1 -- ; not a boundary\n; SELECT 2")).toEqual([
        "SELECT 1 -- ; not a boundary",
        "SELECT 2",
      ]);
    });

    it("ignores one inside a block comment", () => {
      expect(texts("SELECT /* ; still going */ 1; SELECT 2")).toEqual([
        "SELECT /* ; still going */ 1",
        "SELECT 2",
      ]);
    });

    it("ignores one inside a nested block comment", () => {
      expect(
        texts("SELECT /* outer /* inner ; */ still ; */ 1; SELECT 2"),
      ).toEqual(["SELECT /* outer /* inner ; */ still ; */ 1", "SELECT 2"]);
    });

    it("ignores ones inside a dollar-quoted function body", () => {
      const sql = `CREATE FUNCTION f() RETURNS int AS $$
BEGIN
  PERFORM 1;
  RETURN 2;
END;
$$ LANGUAGE plpgsql;
SELECT f();`;
      const statements = texts(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain("PERFORM 1;");
      expect(statements[1]).toBe("SELECT f()");
    });

    it("ignores ones inside a tagged dollar quote", () => {
      const sql =
        "CREATE FUNCTION g() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql;\nSELECT g();";
      expect(texts(sql)).toHaveLength(2);
    });
  });

  it("does not mistake a positional parameter for a dollar quote", () => {
    expect(texts("SELECT $1; SELECT 2")).toEqual(["SELECT $1", "SELECT 2"]);
  });

  it("starts a statement's range at its first code character", () => {
    expect(splitStatements("-- note\nSELECT 1;")[0].from).toBe(8);
  });

  it("terminates on an unterminated literal instead of hanging", () => {
    expect(texts("SELECT 'oops")).toEqual(["SELECT 'oops"]);
  });
});

describe("statementAtCursor", () => {
  const doc = "SELECT 1;\n\nSELECT 2;\n";
  const statements = splitStatements(doc);
  const at = (pos: number) => statementAtCursor(statements, pos)?.text ?? null;

  it("finds the statement the cursor sits in", () => {
    expect(at(3)).toBe("SELECT 1");
    expect(at(14)).toBe("SELECT 2");
  });

  it("counts both ends of a statement as inside it", () => {
    expect(at(0)).toBe("SELECT 1");
    expect(at(8)).toBe("SELECT 1");
  });

  it("takes the preceding statement when the cursor is just past its semicolon", () => {
    expect(at(9)).toBe("SELECT 1");
    expect(at(10)).toBe("SELECT 1");
  });

  it("takes the last statement at the end of the document", () => {
    expect(at(doc.length)).toBe("SELECT 2");
  });

  it("falls forward when nothing precedes the cursor", () => {
    expect(statementAtCursor(splitStatements("\n\nSELECT 1;"), 0)?.text).toBe(
      "SELECT 1",
    );
  });

  it("returns null when there are no statements", () => {
    expect(statementAtCursor([], 0)).toBeNull();
  });
});
