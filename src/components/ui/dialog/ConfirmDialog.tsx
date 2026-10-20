import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!isOpen) return;

    // Danger dialogs start on Cancel. Other dialogs still start on Confirm.
    // The effect does not depend on onCancel, so a parent re-render cannot
    // pull keyboard focus back onto Delete.
    const focusTarget =
      variant === "danger" ? cancelBtnRef.current : confirmBtnRef.current;
    focusTarget?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, variant]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={styles.dialog}
        data-variant={variant}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className={styles.header}>
          {variant !== "default" && (
            <div className={styles.iconWrapper} data-variant={variant}>
              <AlertTriangle size={18} />
            </div>
          )}
          <h3 id="confirm-title" className={styles.title}>
            {title}
          </h3>
          <button className={styles.closeBtn} onClick={onCancel} title="Cancel">
            <X size={16} />
          </button>
        </div>

        <p id="confirm-message" className={styles.message}>
          {message}
        </p>

        <div className={styles.actions}>
          <button
            ref={cancelBtnRef}
            className={styles.cancelBtn}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={styles.confirmBtn}
            data-variant={variant}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
