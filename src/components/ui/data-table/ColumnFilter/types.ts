export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal"
  | "is_null"
  | "is_not_null";

export interface ColumnFilter {
  column: string;
  operator: FilterOperator;
  value: string | null;
}

export type FilterCategory =
  | "text"
  | "numeric"
  | "boolean"
  | "date"
  | "enum"
  | "generic";

/** Map PostgreSQL types to filter categories */
export function getFilterCategory(pgType: string): FilterCategory {
  const upper = pgType.toUpperCase();

  // Numeric types
  const numericTypes = [
    "INT2",
    "INT4",
    "INT8",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "SERIAL",
    "SMALLSERIAL",
    "BIGSERIAL",
    "FLOAT4",
    "FLOAT8",
    "REAL",
    "DOUBLE PRECISION",
    "NUMERIC",
    "DECIMAL",
    "MONEY",
    "OID",
  ];
  if (numericTypes.includes(upper)) return "numeric";

  // Boolean
  if (upper === "BOOL" || upper === "BOOLEAN") return "boolean";

  // Text types
  const textTypes = ["TEXT", "VARCHAR", "CHAR", "BPCHAR", "NAME", "UNKNOWN"];
  if (textTypes.includes(upper)) return "text";

  // Date/Time types
  const dateTypes = [
    "DATE",
    "TIME",
    "TIMETZ",
    "TIMESTAMP",
    "TIMESTAMPTZ",
    "INTERVAL",
  ];
  if (dateTypes.includes(upper)) return "date";

  // UUID, JSON, XML, arrays — generic text search
  const genericTypes = [
    "UUID",
    "JSON",
    "JSONB",
    "XML",
    "BYTEA",
    "INET",
    "CIDR",
    "MACADDR",
    "MACADDR8",
  ];
  if (genericTypes.includes(upper)) return "generic";

  // Array types
  if (upper.endsWith("[]") || upper.startsWith("_")) return "generic";

  // Unknown types (likely enums) — we'll try to detect enum in the component
  return "enum";
}

export interface OperatorOption {
  value: FilterOperator;
  label: string;
}

export const TEXT_OPERATORS: OperatorOption[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not equals" },
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
  { value: "is_null", label: "Is NULL" },
  { value: "is_not_null", label: "Is not NULL" },
];

export const NUMERIC_OPERATORS: OperatorOption[] = [
  { value: "equals", label: "=" },
  { value: "not_equals", label: "≠" },
  { value: "greater_than", label: ">" },
  { value: "less_than", label: "<" },
  { value: "greater_than_or_equal", label: "≥" },
  { value: "less_than_or_equal", label: "≤" },
  { value: "is_null", label: "Is NULL" },
  { value: "is_not_null", label: "Is not NULL" },
];

export const DATE_OPERATORS: OperatorOption[] = [
  { value: "equals", label: "Equals" },
  { value: "greater_than", label: "After" },
  { value: "less_than", label: "Before" },
  { value: "greater_than_or_equal", label: "On or after" },
  { value: "less_than_or_equal", label: "On or before" },
  { value: "is_null", label: "Is NULL" },
  { value: "is_not_null", label: "Is not NULL" },
];

export const GENERIC_OPERATORS: OperatorOption[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "is_null", label: "Is NULL" },
  { value: "is_not_null", label: "Is not NULL" },
];
