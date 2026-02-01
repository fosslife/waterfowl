/**
 * CodeMirror 6 Engine for SQL Editor
 *
 * This is the CodeMirror-specific implementation of the SQL editor.
 * It can be swapped out for Monaco or another editor by creating
 * a new engine file and updating the import in SqlEditor.tsx
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
} from "react";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { sql, PostgreSQL, SQLConfig } from "@codemirror/lang-sql";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { linter, Diagnostic } from "@codemirror/lint";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import type {
  SqlEditorProps,
  SqlEditorRef,
  SchemaCompletionData,
} from "../SqlEditor.types";

// Create compartments for dynamic configuration
const editableCompartment = new Compartment();
const diagnosticsCompartment = new Compartment();
const sqlLanguageCompartment = new Compartment();

/**
 * Build SQL schema configuration for CodeMirror's sql() language
 * This provides table/column completions that work alongside SQL keyword completions
 */
function buildSqlSchema(
  schemaData?: SchemaCompletionData
): SQLConfig["schema"] {
  if (!schemaData) return undefined;

  const schema: Record<string, string[]> = {};

  // Add tables with their columns
  for (const table of schemaData.tables) {
    schema[table.name] = table.columns?.map((c) => c.name) || [];
  }

  // Add views
  for (const view of schemaData.views) {
    schema[view.name] = view.columns?.map((c) => c.name) || [];
  }

  return schema;
}

/**
 * Create theme that matches the app's design system
 */
const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-base-50)",
    color: "var(--color-text-primary)",
    fontSize: "var(--text-sm)",
    fontFamily: "var(--font-mono)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-content": {
    caretColor: "var(--color-accent-primary)",
    padding: "var(--space-3) 0",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--color-accent-primary)",
    borderLeftWidth: "2px",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(0, 243, 255, 0.04)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
    {
      backgroundColor: "rgba(0, 243, 255, 0.15) !important",
    },
  ".cm-gutters": {
    backgroundColor: "var(--color-base-100)",
    color: "var(--color-text-tertiary)",
    border: "none",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 var(--space-3)",
    minWidth: "3em",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(0, 243, 255, 0.08)",
    color: "var(--color-text-secondary)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-placeholder": {
    color: "var(--color-text-tertiary)",
    fontStyle: "italic",
  },
  // Autocomplete styling
  ".cm-tooltip": {
    backgroundColor: "var(--color-base-200)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    "& > ul": {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-sm)",
      maxHeight: "200px",
    },
    "& > ul > li": {
      padding: "var(--space-1) var(--space-2)",
    },
    "& > ul > li[aria-selected]": {
      backgroundColor: "rgba(0, 243, 255, 0.15)",
      color: "var(--color-text-primary)",
    },
  },
  ".cm-completionLabel": {
    color: "var(--color-text-primary)",
  },
  ".cm-completionDetail": {
    color: "var(--color-text-tertiary)",
    fontStyle: "italic",
    marginLeft: "var(--space-2)",
  },
  ".cm-completionIcon": {
    opacity: 0.7,
  },
  // Diagnostic styling
  ".cm-diagnostic-error": {
    borderLeft: "3px solid var(--color-accent-secondary)",
    backgroundColor: "rgba(255, 0, 85, 0.1)",
    padding: "var(--space-1) var(--space-2)",
    marginLeft: "var(--space-2)",
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid var(--color-accent-tertiary)",
    backgroundColor: "rgba(255, 204, 0, 0.1)",
    padding: "var(--space-1) var(--space-2)",
    marginLeft: "var(--space-2)",
  },
  ".cm-lintRange-error": {
    backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="%23ff0055" fill="none" stroke-width="1"/></svg>')`,
  },
  ".cm-lintRange-warning": {
    backgroundImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="%23ffcc00" fill="none" stroke-width="1"/></svg>')`,
  },
  // Search/match highlighting
  ".cm-searchMatch": {
    backgroundColor: "rgba(255, 204, 0, 0.3)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgba(255, 204, 0, 0.5)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(0, 243, 255, 0.2)",
    outline: "1px solid rgba(0, 243, 255, 0.4)",
  },
});

/**
 * Syntax highlighting colors
 */
const syntaxColors = syntaxHighlighting(defaultHighlightStyle);

export const CodeMirrorEngine = forwardRef<SqlEditorRef, SqlEditorProps>(
  function CodeMirrorEngine(
    {
      initialValue = "",
      value,
      onChange,
      onExecute,
      schemaData,
      diagnostics,
      placeholder,
      readOnly = false,
      autoFocus = false,
      minHeight = "200px",
      maxHeight,
      className,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onExecuteRef = useRef(onExecute);

    // Keep refs updated
    onChangeRef.current = onChange;
    onExecuteRef.current = onExecute;

    // Build SQL schema for completions
    const sqlSchema = useMemo(() => buildSqlSchema(schemaData), [schemaData]);

    // Convert diagnostics to CodeMirror format
    const cmDiagnostics = useMemo((): Diagnostic[] => {
      if (!diagnostics) return [];
      return diagnostics.map((d) => ({
        from: d.from,
        to: d.to,
        severity: d.severity,
        message: d.message,
      }));
    }, [diagnostics]);

    // Initialize editor
    useEffect(() => {
      if (!containerRef.current) return;

      // Execute keymap with highest precedence so it's not captured by other handlers
      const executeKeymap = Prec.highest(
        keymap.of([
          {
            key: "Ctrl-Enter",
            mac: "Cmd-Enter",
            run: (view) => {
              const selection = view.state.selection.main;
              const doc = view.state.doc.toString();
              const query = selection.empty
                ? doc
                : doc.slice(selection.from, selection.to);
              onExecuteRef.current?.(query);
              return true;
            },
          },
        ])
      );

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current?.(update.state.doc.toString());
        }
      });

      const state = EditorState.create({
        doc: value ?? initialValue,
        extensions: [
          // Execute keymap first with highest precedence
          executeKeymap,

          // Basic setup
          lineNumbers(),
          history(),
          bracketMatching(),
          indentOnInput(),
          highlightSelectionMatches(),

          // Keymaps
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...searchKeymap,
          ]),

          // SQL language with PostgreSQL dialect and schema for entity completions
          // This provides BOTH SQL keyword completions AND table/column completions
          sqlLanguageCompartment.of(
            sql({
              dialect: PostgreSQL,
              upperCaseKeywords: true,
              schema: sqlSchema,
            })
          ),

          // Autocomplete configuration (uses completions from sql() above)
          autocompletion({
            activateOnTyping: true,
          }),

          // Diagnostics/linting
          diagnosticsCompartment.of(linter(() => cmDiagnostics)),

          // Theme and styling
          editorTheme,
          syntaxColors,

          // Placeholder
          placeholder ? placeholderExt(placeholder) : [],

          // Read-only state
          editableCompartment.of(EditorView.editable.of(!readOnly)),

          // Change listener
          updateListener,

          // Height constraints
          EditorView.theme({
            "&": {
              minHeight,
              ...(maxHeight ? { maxHeight, overflow: "auto" } : {}),
            },
            ".cm-scroller": {
              overflow: "auto",
            },
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;

      if (autoFocus) {
        view.focus();
      }

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []); // Only run once on mount

    // Update value when controlled
    useEffect(() => {
      const view = viewRef.current;
      if (!view || value === undefined) return;

      const currentValue = view.state.doc.toString();
      if (currentValue !== value) {
        view.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: value,
          },
        });
      }
    }, [value]);

    // Update readOnly state
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: editableCompartment.reconfigure(
          EditorView.editable.of(!readOnly)
        ),
      });
    }, [readOnly]);

    // Update diagnostics
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: diagnosticsCompartment.reconfigure(
          linter(() => cmDiagnostics)
        ),
      });
    }, [cmDiagnostics]);

    // Update SQL schema when schemaData changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({
        effects: sqlLanguageCompartment.reconfigure(
          sql({
            dialect: PostgreSQL,
            upperCaseKeywords: true,
            schema: sqlSchema,
          })
        ),
      });
    }, [sqlSchema]);

    // Expose imperative API
    useImperativeHandle(ref, () => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? "",
      setValue: (newValue: string) => {
        const view = viewRef.current;
        if (!view) return;
        const currentValue = view.state.doc.toString();
        view.dispatch({
          changes: {
            from: 0,
            to: currentValue.length,
            insert: newValue,
          },
        });
      },
      focus: () => viewRef.current?.focus(),
      getSelection: () => {
        const view = viewRef.current;
        if (!view) return "";
        const selection = view.state.selection.main;
        const doc = view.state.doc.toString();
        return selection.empty ? doc : doc.slice(selection.from, selection.to);
      },
      insertText: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const selection = view.state.selection.main;
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: text,
          },
          selection: { anchor: selection.from + text.length },
        });
      },
    }));

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          minHeight,
          ...(maxHeight ? { maxHeight, overflow: "hidden" } : {}),
        }}
      />
    );
  }
);
