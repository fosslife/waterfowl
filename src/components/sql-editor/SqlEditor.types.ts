/**
 * SQL Editor Types
 *
 * This file defines the abstraction layer for the SQL editor.
 * The interface is engine-agnostic, allowing easy swapping between
 * CodeMirror, Monaco, or other editor implementations.
 */

export interface SchemaCompletionData {
  tables: TableCompletion[];
  views: ViewCompletion[];
  functions: FunctionCompletion[];
  schemas: string[];
}

export interface TableCompletion {
  name: string;
  schema?: string;
  columns?: ColumnCompletion[];
}

export interface ViewCompletion {
  name: string;
  schema?: string;
  columns?: ColumnCompletion[];
}

export interface ColumnCompletion {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface FunctionCompletion {
  name: string;
  schema?: string;
  signature?: string;
}

export interface SqlEditorDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface SqlEditorProps {
  /** Initial SQL content */
  initialValue?: string;

  /** Controlled value (if provided, editor becomes controlled) */
  value?: string;

  /** Called when editor content changes */
  onChange?: (value: string) => void;

  /** Called when user executes query (Ctrl/Cmd+Enter) */
  onExecute?: (query: string) => void;

  /** Schema data for autocomplete */
  schemaData?: SchemaCompletionData;

  /** Diagnostics/errors to display */
  diagnostics?: SqlEditorDiagnostic[];

  /** Placeholder text when editor is empty */
  placeholder?: string;

  /** Whether the editor is read-only */
  readOnly?: boolean;

  /** Auto-focus the editor on mount */
  autoFocus?: boolean;

  /** Minimum height of the editor */
  minHeight?: string;

  /** Maximum height of the editor (for scrolling) */
  maxHeight?: string;

  /** Additional CSS class name */
  className?: string;
}

export interface SqlEditorRef {
  /** Get the current editor value */
  getValue: () => string;

  /** Set the editor value */
  setValue: (value: string) => void;

  /** Focus the editor */
  focus: () => void;

  /** Get selected text (or full text if nothing selected) */
  getSelection: () => string;

  /** Insert text at cursor position */
  insertText: (text: string) => void;
}
