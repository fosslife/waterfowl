import { useEffect, useState } from "react";
import { X, CheckCircle, AlertTriangle, Info, AlertCircle } from "lucide-react";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastData {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastProps extends ToastData {
  onClose: (id: string) => void;
}

const variantConfig = {
  success: {
    icon: CheckCircle,
    color: "var(--color-success)",
    bg: "rgba(0, 255, 136, 0.1)",
    border: "rgba(0, 255, 136, 0.3)",
  },
  error: {
    icon: AlertCircle,
    color: "var(--color-accent-secondary)",
    bg: "rgba(255, 0, 85, 0.1)",
    border: "rgba(255, 0, 85, 0.3)",
  },
  warning: {
    icon: AlertTriangle,
    color: "var(--color-accent-tertiary)",
    bg: "rgba(255, 204, 0, 0.1)",
    border: "rgba(255, 204, 0, 0.3)",
  },
  info: {
    icon: Info,
    color: "var(--color-accent-primary)",
    bg: "rgba(0, 243, 255, 0.1)",
    border: "rgba(0, 243, 255, 0.3)",
  },
};

export function Toast({
  id,
  message,
  variant,
  duration = 4000,
  onClose,
}: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const config = variantConfig[variant];
  const Icon = config.icon;

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onClose(id), 200);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        backdropFilter: "blur(8px)",
        minWidth: 300,
        maxWidth: 420,
        animation: isExiting
          ? "toastExit 0.2s ease-out forwards"
          : "toastEnter 0.3s ease-out",
      }}
    >
      <Icon
        size={18}
        style={{ color: config.color, flexShrink: 0, marginTop: 1 }}
      />
      <p
        style={{
          flex: 1,
          fontSize: "var(--text-sm)",
          color: "var(--color-text-primary)",
          lineHeight: 1.5,
          margin: 0,
        }}
      >
        {message}
      </p>
      <button
        onClick={handleClose}
        style={{
          background: "transparent",
          color: "var(--color-text-tertiary)",
          padding: 2,
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "var(--color-text-primary)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "var(--color-text-tertiary)")
        }
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastData[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <style>{`
        @keyframes toastEnter {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes toastExit {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(100%);
          }
        }
      `}</style>
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onClose={onClose} />
      ))}
    </div>
  );
}
