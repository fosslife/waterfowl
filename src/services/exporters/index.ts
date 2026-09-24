import type { ExportFormat } from "./types";
import { csvFormat } from "./csv";
import { jsonFormat } from "./json";
import { sqlFormat } from "./sql";

/**
 * Registered export formats, in the order shown in the picker. Add a new
 * format by importing it here and pushing it into the array — no other
 * file needs to know.
 */
export const EXPORT_FORMATS: ExportFormat[] = [csvFormat, jsonFormat, sqlFormat];

export function getExportFormat(id: string): ExportFormat | undefined {
  return EXPORT_FORMATS.find((f) => f.id === id);
}

export type { ExportColumn, ExportFormat } from "./types";
export { csvFormat, type CsvOptions, DEFAULT_CSV_OPTIONS } from "./csv";
export { jsonFormat, type JsonOptions, DEFAULT_JSON_OPTIONS } from "./json";
export { sqlFormat, type SqlOptions, DEFAULT_SQL_OPTIONS } from "./sql";
