export function formatAsSqlLiteral(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) {
    return `ARRAY[${val.map((v) => formatAsSqlLiteral(v)).join(", ")}]`;
  }
  if (typeof val === "object") {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

export function inferType(data: Record<string, any>[], col: string): string {
  const sample = data.find(
    (row) => row[col] !== null && row[col] !== undefined,
  )?.[col];
  if (sample === undefined) return "unknown";
  if (typeof sample === "number")
    return Number.isInteger(sample) ? "int" : "float";
  if (typeof sample === "boolean") return "bool";
  if (typeof sample === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return "date";
    if (sample.length > 100) return "text";
    return "varchar";
  }
  if (typeof sample === "object") return "json";
  return "unknown";
}

/** Check if column type is numeric (for right-alignment) */
export function isNumericColumn(type: string | undefined): boolean {
  if (!type) return false;
  const numericTypes = [
    "int",
    "float",
    "int2",
    "int4",
    "int8",
    "smallint",
    "integer",
    "bigint",
    "serial",
    "smallserial",
    "bigserial",
    "float4",
    "float8",
    "real",
    "double precision",
    "numeric",
    "decimal",
    "money",
    "oid",
  ];
  return numericTypes.includes(type.toLowerCase());
}

export function formatValue(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (Array.isArray(val)) {
    // Display arrays as comma-separated values
    return val.map((v) => (v === null ? "NULL" : String(v))).join(", ");
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
