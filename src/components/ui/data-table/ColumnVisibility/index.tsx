import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Columns3 } from "lucide-react";
import styles from "./ColumnVisibility.module.css";

const STORAGE_PREFIX = "waterfowl:colvis:";

export type ColumnVisibilityState = Record<string, boolean>;

function loadVisibility(key: string | undefined): ColumnVisibilityState {
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveVisibility(key: string, state: ColumnVisibilityState) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
  } catch {
    // Quota or privacy mode — silently ignore
  }
}

/**
 * Visibility state for the data table, optionally persisted to localStorage
 * when `storageKey` is provided. The map stores only hidden columns (value
 * `false`); missing entries mean visible. This keeps stored JSON compact and
 * makes new columns visible by default.
 */
export function useColumnVisibility(storageKey: string | undefined) {
  const [visibility, setVisibility] = useState<ColumnVisibilityState>(() =>
    loadVisibility(storageKey),
  );

  // If the storage key changes (e.g. switching tabs), reload from storage.
  useEffect(() => {
    setVisibility(loadVisibility(storageKey));
  }, [storageKey]);

  const setVisibilityPersisted = useCallback(
    (
      updater:
        | ColumnVisibilityState
        | ((prev: ColumnVisibilityState) => ColumnVisibilityState),
    ) => {
      setVisibility((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (storageKey) saveVisibility(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return [visibility, setVisibilityPersisted] as const;
}

interface ColumnItem {
  id: string;
  label: string;
}

interface ColumnVisibilityMenuProps {
  columns: ColumnItem[];
  visibility: ColumnVisibilityState;
  onChange: (next: ColumnVisibilityState) => void;
}

export const ColumnVisibilityMenu = memo(function ColumnVisibilityMenu({
  columns,
  visibility,
  onChange,
}: ColumnVisibilityMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hiddenCount = useMemo(
    () => columns.filter((c) => visibility[c.id] === false).length,
    [columns, visibility],
  );

  const openMenu = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = 240;
    const menuHeight = 360;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - menuWidth - 8, rect.left),
    );
    const top = Math.max(8, rect.top - menuHeight - 4);
    setPos({ left, top });
    setOpen(true);
  }, []);

  // Close on outside click / Escape / scroll
  useEffect(() => {
    if (!open) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Keep menu pinned above button after layout (e.g. scroll within page).
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = buttonRef.current;
      const menu = menuRef.current;
      if (!btn || !menu) return;
      const rect = btn.getBoundingClientRect();
      const menuHeight = menu.offsetHeight;
      const left = Math.max(
        8,
        Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left),
      );
      const top = Math.max(8, rect.top - menuHeight - 4);
      setPos({ left, top });
    };
    reposition();
  }, [open]);

  const toggle = useCallback(
    (id: string) => {
      const next = { ...visibility };
      if (next[id] === false) {
        delete next[id];
      } else {
        next[id] = false;
      }
      onChange(next);
    },
    [visibility, onChange],
  );

  const showAll = useCallback(() => onChange({}), [onChange]);

  const hideAllButFirst = useCallback(() => {
    if (columns.length === 0) return;
    const next: ColumnVisibilityState = {};
    for (let i = 1; i < columns.length; i++) {
      next[columns[i].id] = false;
    }
    onChange(next);
  }, [columns, onChange]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.toggle} ${open ? styles.toggleActive : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        title="Show/hide columns"
      >
        <Columns3 size={13} />
        <span>Columns</span>
        {hiddenCount > 0 && <span className={styles.badge}>{hiddenCount}</span>}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.menu}
            style={{ left: pos.left, top: pos.top }}
          >
            <div className={styles.menuHeader}>
              <span>Columns</span>
              <div className={styles.menuActions}>
                <button
                  type="button"
                  className={styles.menuAction}
                  onClick={showAll}
                >
                  Show all
                </button>
                <button
                  type="button"
                  className={styles.menuAction}
                  onClick={hideAllButFirst}
                >
                  Hide all
                </button>
              </div>
            </div>
            <div className={styles.menuList}>
              {columns.map((col) => {
                const visible = visibility[col.id] !== false;
                return (
                  <label key={col.id} className={styles.menuItem}>
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={() => toggle(col.id)}
                    />
                    <span>{col.label}</span>
                  </label>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
});
