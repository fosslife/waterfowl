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
import {
  Columns3,
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import styles from "./ColumnVisibility.module.css";

const STORAGE_PREFIX = "waterfowl:colvis:";
const PIN_STORAGE_PREFIX = "waterfowl:colpin:";
const ORDER_STORAGE_PREFIX = "waterfowl:colorder:";

export type ColumnVisibilityState = Record<string, boolean>;

/** Pinned column ids per edge, in pin order. Center columns are absent. */
export interface ColumnPinningState {
  left: string[];
  right: string[];
}

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

function loadPinning(key: string | undefined): ColumnPinningState {
  if (!key || typeof window === "undefined") return { left: [], right: [] };
  try {
    const raw = window.localStorage.getItem(PIN_STORAGE_PREFIX + key);
    if (!raw) return { left: [], right: [] };
    const parsed = JSON.parse(raw);
    return {
      left: Array.isArray(parsed?.left) ? parsed.left : [],
      right: Array.isArray(parsed?.right) ? parsed.right : [],
    };
  } catch {
    return { left: [], right: [] };
  }
}

function savePinning(key: string, state: ColumnPinningState) {
  try {
    window.localStorage.setItem(
      PIN_STORAGE_PREFIX + key,
      JSON.stringify(state),
    );
  } catch {
    // Quota or privacy mode — silently ignore
  }
}

/**
 * Column pinning state, optionally persisted to localStorage when `storageKey`
 * is provided. Mirrors {@link useColumnVisibility}.
 */
export function useColumnPinning(storageKey: string | undefined) {
  const [pinning, setPinning] = useState<ColumnPinningState>(() =>
    loadPinning(storageKey),
  );

  useEffect(() => {
    setPinning(loadPinning(storageKey));
  }, [storageKey]);

  const setPinningPersisted = useCallback(
    (
      updater:
        | ColumnPinningState
        | ((prev: ColumnPinningState) => ColumnPinningState),
    ) => {
      setPinning((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (storageKey) savePinning(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return [pinning, setPinningPersisted] as const;
}

/**
 * Reorder `ids` according to `order`: ids listed in `order` come first (in that
 * order), followed by any remaining ids in their original order. Mirrors
 * TanStack's column-order algorithm so our layout stays in sync.
 */
export function applyColumnOrder(ids: string[], order: string[]): string[] {
  if (order.length === 0) return ids;
  const remaining = [...ids];
  const ordered: string[] = [];
  for (const id of order) {
    const idx = remaining.indexOf(id);
    if (idx > -1) ordered.push(remaining.splice(idx, 1)[0]);
  }
  return [...ordered, ...remaining];
}

function loadOrder(key: string | undefined): string[] {
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOrder(key: string, order: string[]) {
  try {
    window.localStorage.setItem(
      ORDER_STORAGE_PREFIX + key,
      JSON.stringify(order),
    );
  } catch {
    // Quota or privacy mode — silently ignore
  }
}

/**
 * Column order (explicit id list), optionally persisted to localStorage when
 * `storageKey` is provided. Empty array means natural declaration order.
 */
export function useColumnOrder(storageKey: string | undefined) {
  const [order, setOrder] = useState<string[]>(() => loadOrder(storageKey));

  useEffect(() => {
    setOrder(loadOrder(storageKey));
  }, [storageKey]);

  const setOrderPersisted = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      setOrder((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (storageKey) saveOrder(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return [order, setOrderPersisted] as const;
}

interface ColumnItem {
  id: string;
  label: string;
}

interface ColumnVisibilityMenuProps {
  columns: ColumnItem[];
  visibility: ColumnVisibilityState;
  onChange: (next: ColumnVisibilityState) => void;
  pinning: ColumnPinningState;
  onPinChange: (
    updater: (prev: ColumnPinningState) => ColumnPinningState,
  ) => void;
  /** Reorder columns. Receives the full new id order (left → right). */
  onOrderChange: (next: string[]) => void;
}

export const ColumnVisibilityMenu = memo(function ColumnVisibilityMenu({
  columns,
  visibility,
  onChange,
  pinning,
  onPinChange,
  onOrderChange,
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
    const menuWidth = 280;
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

  const togglePin = useCallback(
    (id: string, side: "left" | "right") => {
      onPinChange((prev) => {
        const left = prev.left.filter((c) => c !== id);
        const right = prev.right.filter((c) => c !== id);
        if (prev[side].includes(id)) return { left, right };
        return side === "left"
          ? { left: [...left, id], right }
          : { left, right: [...right, id] };
      });
    },
    [onPinChange],
  );

  const moveColumn = useCallback(
    (id: string, dir: "up" | "down") => {
      const ids = columns.map((c) => c.id);
      const i = ids.indexOf(id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      onOrderChange(ids);
    },
    [columns, onOrderChange],
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
            <div className={styles.menuColHeaders}>
              <span className={styles.menuColHeadersSpacer} />
              <span className={styles.menuColGroupLabel}>Reorder</span>
              <span className={styles.menuColGroupLabel}>Pin</span>
            </div>
            <div className={styles.menuList}>
              {columns.map((col, idx) => {
                const visible = visibility[col.id] !== false;
                const pinnedLeft = pinning.left.includes(col.id);
                const pinnedRight = pinning.right.includes(col.id);
                return (
                  <div key={col.id} className={styles.menuItem}>
                    <label className={styles.menuItemLabel}>
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggle(col.id)}
                      />
                      <span>{col.label}</span>
                    </label>
                    <div className={styles.controlGroup}>
                      <button
                        type="button"
                        className={styles.pinBtn}
                        onClick={() => moveColumn(col.id, "up")}
                        disabled={idx === 0}
                        title="Move earlier"
                        aria-label="Move earlier"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        className={styles.pinBtn}
                        onClick={() => moveColumn(col.id, "down")}
                        disabled={idx === columns.length - 1}
                        title="Move later"
                        aria-label="Move later"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    <div className={styles.controlGroup}>
                      <button
                        type="button"
                        className={`${styles.pinBtn} ${pinnedLeft ? styles.pinBtnActive : ""}`}
                        onClick={() => togglePin(col.id, "left")}
                        title={pinnedLeft ? "Unpin" : "Pin left"}
                        aria-label={pinnedLeft ? "Unpin" : "Pin left"}
                      >
                        <ArrowLeftToLine size={12} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.pinBtn} ${pinnedRight ? styles.pinBtnActive : ""}`}
                        onClick={() => togglePin(col.id, "right")}
                        title={pinnedRight ? "Unpin" : "Pin right"}
                        aria-label={pinnedRight ? "Unpin" : "Pin right"}
                      >
                        <ArrowRightToLine size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
});
