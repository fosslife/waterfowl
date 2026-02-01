/**
 * SQL Editor Component
 *
 * This is the public-facing component that consumers should use.
 * It wraps the underlying editor engine (CodeMirror by default)
 * and provides a stable API regardless of the engine used.
 *
 * To swap engines (e.g., to Monaco), simply change the import
 * below to point to a different engine implementation.
 */

import { forwardRef } from "react";
import { CodeMirrorEngine } from "./engines/CodeMirrorEngine";
import type { SqlEditorProps, SqlEditorRef } from "./SqlEditor.types";
import styles from "./SqlEditor.module.css";
import clsx from "clsx";

export const SqlEditor = forwardRef<SqlEditorRef, SqlEditorProps>(
  function SqlEditor(props, ref) {
    const { className, ...editorProps } = props;

    return (
      <div className={clsx(styles.wrapper, className)}>
        <CodeMirrorEngine ref={ref} {...editorProps} />
      </div>
    );
  }
);

// Re-export types for convenience
export type {
  SqlEditorProps,
  SqlEditorRef,
  SchemaCompletionData,
  TableCompletion,
  ViewCompletion,
  ColumnCompletion,
  FunctionCompletion,
  SqlEditorDiagnostic,
} from "./SqlEditor.types";
