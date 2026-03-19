import { useState, useCallback, useRef, useMemo } from "react";
import type { ColumnFilter, FilterOperator } from "./types";

interface UseColumnFiltersOptions {
  /** Debounce delay in milliseconds for filter changes */
  debounceMs?: number;
  /** Callback fired when debounced filters change */
  onFiltersChange: (filters: ColumnFilter[]) => void;
}

interface FilterInputState {
  operator: FilterOperator;
  value: string;
}

export function useColumnFilters({
  debounceMs = 300,
  onFiltersChange,
}: UseColumnFiltersOptions) {
  // Raw input state per column (not yet debounced)
  const [filterInputs, setFilterInputs] = useState<
    Record<string, FilterInputState>
  >({});

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Memoize callback ref to avoid stale closures in debounce
  const onFiltersChangeRef = useRef(onFiltersChange);
  onFiltersChangeRef.current = onFiltersChange;

  /** Build ColumnFilter[] from current input state */
  const buildFilters = useCallback(
    (inputs: Record<string, FilterInputState>): ColumnFilter[] => {
      const filters: ColumnFilter[] = [];
      for (const [column, state] of Object.entries(inputs)) {
        // Skip empty filters (but allow null-check operators w/o value)
        if (
          state.operator !== "is_null" &&
          state.operator !== "is_not_null" &&
          !state.value.trim()
        ) {
          continue;
        }
        filters.push({
          column,
          operator: state.operator,
          value:
            state.operator === "is_null" || state.operator === "is_not_null"
              ? null
              : state.value.trim(),
        });
      }
      return filters;
    },
    [],
  );

  /** Schedule a debounced filter change */
  const scheduleUpdate = useCallback(
    (inputs: Record<string, FilterInputState>) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        const filters = buildFilters(inputs);
        onFiltersChangeRef.current(filters);
      }, debounceMs);
    },
    [debounceMs, buildFilters],
  );

  /** Update value for a column's filter */
  const setFilterValue = useCallback(
    (column: string, value: string) => {
      setFilterInputs((prev) => {
        const next = { ...prev };
        const existing = next[column];
        next[column] = {
          operator: existing?.operator ?? "contains",
          value,
        };
        scheduleUpdate(next);
        return next;
      });
    },
    [scheduleUpdate],
  );

  /** Update operator for a column's filter */
  const setFilterOperator = useCallback(
    (column: string, operator: FilterOperator) => {
      setFilterInputs((prev) => {
        const next = { ...prev };
        const existing = next[column];
        next[column] = {
          operator,
          value: existing?.value ?? "",
        };

        // For is_null/is_not_null, fire immediately (no value needed)
        if (operator === "is_null" || operator === "is_not_null") {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          const filters = buildFilters(next);
          // Use setTimeout(0) to avoid state update conflicts
          setTimeout(() => onFiltersChangeRef.current(filters), 0);
        } else {
          scheduleUpdate(next);
        }
        return next;
      });
    },
    [scheduleUpdate, buildFilters],
  );

  /** Clear a specific column's filter */
  const clearFilter = useCallback(
    (column: string) => {
      setFilterInputs((prev) => {
        const next = { ...prev };
        delete next[column];
        scheduleUpdate(next);
        return next;
      });
    },
    [scheduleUpdate],
  );

  /** Clear all filters */
  const clearAllFilters = useCallback(() => {
    setFilterInputs({});
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    onFiltersChangeRef.current([]);
  }, []);

  /** Get the input state for a specific column */
  const getFilterInput = useCallback(
    (column: string): FilterInputState | undefined => {
      return filterInputs[column];
    },
    [filterInputs],
  );

  /** Count active filters (non-empty) */
  const activeFilterCount = useMemo(() => {
    return buildFilters(filterInputs).length;
  }, [filterInputs, buildFilters]);

  return {
    filterInputs,
    setFilterValue,
    setFilterOperator,
    clearFilter,
    clearAllFilters,
    getFilterInput,
    activeFilterCount,
  };
}
