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

/** A span of the document, as character offsets. */
export interface EditorRange {
  from: number;
  to: number;
}

export interface SqlEditorProps {
  /** Initial SQL content */
  initialValue?: string;

  /** Controlled value (if provided, editor becomes controlled) */
  value?: string;

  /** Called when editor content changes */
  onChange?: (value: string) => void;

  /**
   * Called when the user asks to execute (Ctrl/Cmd+Enter). The editor doesn't
   * decide *what* runs — the consumer reads the cursor or selection and picks.
   */
  onExecute?: () => void;

  /** Called when the user asks to run the whole script (Ctrl/Cmd+Shift+Enter). */
  onExecuteScript?: () => void;

  /** Called whenever the cursor moves or the selection changes. */
  onCursorActivity?: (position: number, selection: EditorRange) => void;

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

  /** Current cursor offset. */
  getCursorPosition: () => number;

  /** Current selection. `from === to` means nothing is selected. */
  getSelectionRange: () => EditorRange;

  /**
   * Tint a span to show which statement will run. Pass null to clear it.
   * Purely visual — it has no bearing on what executes.
   */
  setActiveStatement: (range: EditorRange | null) => void;

  /** Insert text at cursor position */
  insertText: (text: string) => void;
}
