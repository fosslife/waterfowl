/**
 * SQL statement splitting.
 *
 * Postgres only accepts one command per prepared statement, and a SQL editor is
 * a buffer full of them. This module finds statement boundaries so the app can
 * run the one under the cursor.
 *
 * Splitting on `;` alone is wrong: semicolons appear inside string literals,
 * quoted identifiers, comments, and dollar-quoted function bodies. The scanner
 * below walks the text once, skipping over each of those regions, so only a
 * semicolon in code position ends a statement.
 */

export interface SqlRange {
  from: number;
  to: number;
}

export interface SqlStatement {
  /** Statement text, without the terminating semicolon or surrounding blanks. */
  text: string;
  /** Offset of the statement's first character in the source document. */
  from: number;
  /** Offset one past its last character. Excludes the terminating semicolon. */
  to: number;
}

const IDENT_CHAR = /[A-Za-z0-9_]/;
const IDENT_START = /[A-Za-z_]/;

/**
 * Read a dollar-quote delimiter at `i` (`$$`, `$tag$`). Returns the full
 * delimiter including both dollars, or null if this `$` doesn't open one —
 * it may be a positional parameter (`$1`) or plain punctuation.
 */
function readDollarTag(sql: string, i: number): string | null {
  let j = i + 1;
  if (j < sql.length && IDENT_START.test(sql[j])) {
    j++;
    while (j < sql.length && IDENT_CHAR.test(sql[j])) j++;
  }
  return sql[j] === "$" ? sql.slice(i, j + 1) : null;
}

/**
 * Skip a single-quoted literal starting at the opening quote. `''` escapes an
 * embedded quote; a backslash escapes the next character only in an E'' string,
 * since standard_conforming_strings has been on by default since Postgres 9.1.
 */
function skipSingleQuoted(sql: string, i: number): number {
  const prev = sql[i - 1];
  const beforePrev = sql[i - 2];
  const isEscapeString =
    (prev === "E" || prev === "e") &&
    (i < 2 || !IDENT_CHAR.test(beforePrev ?? ""));

  i++;
  while (i < sql.length) {
    const c = sql[i];
    if (isEscapeString && c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length; // Unterminated — treat the rest of the buffer as literal.
}

/** Skip a double-quoted identifier starting at the opening quote. `""` escapes. */
function skipDoubleQuoted(sql: string, i: number): number {
  i++;
  while (i < sql.length) {
    if (sql[i] === '"') {
      if (sql[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

/** Skip a `/* *\/` comment starting at the opening slash. These nest in Postgres. */
function skipBlockComment(sql: string, i: number): number {
  let depth = 1;
  i += 2;
  while (i < sql.length && depth > 0) {
    if (sql[i] === "/" && sql[i + 1] === "*") {
      depth++;
      i += 2;
    } else if (sql[i] === "*" && sql[i + 1] === "/") {
      depth--;
      i += 2;
    } else {
      i++;
    }
  }
  return i;
}

/**
 * Split a SQL buffer into its individual statements.
 *
 * Blank runs and standalone comments between statements belong to neither
 * neighbour, so a statement's range starts at its first code character. Text
 * that is only comments yields no statements at all.
 */
export function splitStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = -1;
  let i = 0;

  const push = (end: number) => {
    if (start < 0) return;
    const text = sql.slice(start, end).replace(/\s+$/, "");
    if (text) statements.push({ text, from: start, to: start + text.length });
    start = -1;
  };

  while (i < sql.length) {
    const c = sql[i];

    if (c === "-" && sql[i + 1] === "-") {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i = skipBlockComment(sql, i);
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Anything past here is code, so it opens a statement if none is open.
    if (start < 0) start = i;

    if (c === ";") {
      push(i);
      i++;
      continue;
    }
    if (c === "'") {
      i = skipSingleQuoted(sql, i);
      continue;
    }
    if (c === '"') {
      i = skipDoubleQuoted(sql, i);
      continue;
    }
    if (c === "$") {
      const tag = readDollarTag(sql, i);
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }
    i++;
  }

  push(sql.length); // Trailing statement with no terminating semicolon.
  return statements;
}

/**
 * Pick the statement a cursor at `pos` refers to.
 *
 * Both ends of a statement count as inside it. When the cursor sits in the
 * blank space or comments between statements, the one *before* it wins: the
 * usual case is having just typed the terminating semicolon and reached for the
 * execute shortcut.
 */
export function statementAtCursor(
  statements: SqlStatement[],
  pos: number,
): SqlStatement | null {
  if (statements.length === 0) return null;

  let preceding: SqlStatement | null = null;
  for (const statement of statements) {
    if (pos >= statement.from && pos <= statement.to) return statement;
    if (statement.to < pos) preceding = statement;
  }

  // Before the first statement there is nothing preceding, so fall forward.
  return preceding ?? statements[0];
}
