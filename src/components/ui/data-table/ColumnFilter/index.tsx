import { memo, useCallback, useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Filter, SlidersHorizontal } from "lucide-react";
import {
  type FilterOperator,
  type FilterCategory,
  type OperatorOption,
  getFilterCategory,
  TEXT_OPERATORS,
  NUMERIC_OPERATORS,
  DATE_OPERATORS,
  GENERIC_OPERATORS,
} from "./types";
import styles from "./ColumnFilter.module.css";

interface FilterCellProps {
  column: string;
  pgType: string;
  value: string | undefined;
  operator: FilterOperator | undefined;
  onValueChange: (column: string, value: string) => void;
  onOperatorChange: (column: string, operator: FilterOperator) => void;
  onClear: (column: string) => void;
  /** Enum values for this column, if it's an enum type */
  enumValues?: string[];
}

export const FilterCell = memo(function FilterCell({
  column,
  pgType,
  value,
  operator,
  onValueChange,
  onOperatorChange,
  onClear,
  enumValues,
}: FilterCellProps) {
  const category = getFilterCategory(pgType);
  const isEnum = category === "enum" && enumValues && enumValues.length > 0;

  const resolvedCategory: FilterCategory = isEnum
    ? "enum"
    : category === "enum"
      ? "generic"
      : category;

  const hasValue =
    (value !== undefined && value !== "") ||
    operator === "is_null" ||
    operator === "is_not_null";

  if (resolvedCategory === "boolean") {
    return (
      <BooleanFilter
        column={column}
        value={value}
        operator={operator}
        onValueChange={onValueChange}
        onOperatorChange={onOperatorChange}
        onClear={onClear}
      />
    );
  }

  if (resolvedCategory === "enum") {
    return (
      <EnumFilter
        column={column}
        value={value}
        operator={operator}
        enumValues={enumValues!}
        onValueChange={onValueChange}
        onOperatorChange={onOperatorChange}
        onClear={onClear}
      />
    );
  }

  return (
    <InputFilter
      column={column}
      category={resolvedCategory}
      value={value ?? ""}
      operator={operator}
      hasValue={hasValue}
      onValueChange={onValueChange}
      onOperatorChange={onOperatorChange}
      onClear={onClear}
    />
  );
});

// ── Boolean Filter ──────────────────────────────────────────────

interface BooleanFilterProps {
  column: string;
  value: string | undefined;
  operator: FilterOperator | undefined;
  onValueChange: (column: string, value: string) => void;
  onOperatorChange: (column: string, operator: FilterOperator) => void;
  onClear: (column: string) => void;
}

const BooleanFilter = memo(function BooleanFilter({
  column,
  value,
  operator,
  onValueChange,
  onOperatorChange,
  onClear,
}: BooleanFilterProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === "") {
        onClear(column);
      } else if (val === "null") {
        onOperatorChange(column, "is_null");
      } else if (val === "not_null") {
        onOperatorChange(column, "is_not_null");
      } else {
        onOperatorChange(column, "equals");
        onValueChange(column, val);
      }
    },
    [column, onValueChange, onOperatorChange, onClear],
  );

  let selectValue = "";
  if (operator === "is_null") selectValue = "null";
  else if (operator === "is_not_null") selectValue = "not_null";
  else if (value === "true" || value === "false") selectValue = value;

  return (
    <div className={styles.filterCell}>
      <select
        className={styles.booleanSelect}
        value={selectValue}
        onChange={handleChange}
        title={`Filter ${column}`}
      >
        <option value="">Any</option>
        <option value="true">TRUE</option>
        <option value="false">FALSE</option>
        <option value="null">NULL</option>
        <option value="not_null">NOT NULL</option>
      </select>
    </div>
  );
});

// ── Enum Filter ─────────────────────────────────────────────────

interface EnumFilterProps {
  column: string;
  value: string | undefined;
  operator: FilterOperator | undefined;
  enumValues: string[];
  onValueChange: (column: string, value: string) => void;
  onOperatorChange: (column: string, operator: FilterOperator) => void;
  onClear: (column: string) => void;
}

const EnumFilter = memo(function EnumFilter({
  column,
  value,
  operator,
  enumValues,
  onValueChange,
  onOperatorChange,
  onClear,
}: EnumFilterProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === "") {
        onClear(column);
      } else if (val === "__null__") {
        onOperatorChange(column, "is_null");
      } else if (val === "__not_null__") {
        onOperatorChange(column, "is_not_null");
      } else {
        onOperatorChange(column, "equals");
        onValueChange(column, val);
      }
    },
    [column, onValueChange, onOperatorChange, onClear],
  );

  let selectValue = "";
  if (operator === "is_null") selectValue = "__null__";
  else if (operator === "is_not_null") selectValue = "__not_null__";
  else if (value) selectValue = value;

  return (
    <div className={styles.filterCell}>
      <select
        className={styles.enumSelect}
        value={selectValue}
        onChange={handleChange}
        title={`Filter ${column}`}
      >
        <option value="">Any</option>
        {enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        <option value="__null__">NULL</option>
        <option value="__not_null__">NOT NULL</option>
      </select>
    </div>
  );
});

// ── Input Filter (text, numeric, date, generic) ─────────────────

interface InputFilterProps {
  column: string;
  category: FilterCategory;
  value: string;
  operator: FilterOperator | undefined;
  hasValue: boolean;
  onValueChange: (column: string, value: string) => void;
  onOperatorChange: (column: string, operator: FilterOperator) => void;
  onClear: (column: string) => void;
}

function getOperators(category: FilterCategory): OperatorOption[] {
  switch (category) {
    case "text":
      return TEXT_OPERATORS;
    case "numeric":
      return NUMERIC_OPERATORS;
    case "date":
      return DATE_OPERATORS;
    default:
      return GENERIC_OPERATORS;
  }
}

function getDefaultOperator(category: FilterCategory): FilterOperator {
  switch (category) {
    case "text":
      return "contains";
    case "numeric":
      return "equals";
    case "date":
      return "equals";
    default:
      return "contains";
  }
}

const InputFilter = memo(function InputFilter({
  column,
  category,
  value,
  operator,
  hasValue,
  onValueChange,
  onOperatorChange,
  onClear,
}: InputFilterProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const operators = getOperators(category);
  const currentOp = operator ?? getDefaultOperator(category);
  const currentLabel =
    operators.find((o) => o.value === currentOp)?.label ?? currentOp;

  const isNullOp = currentOp === "is_null" || currentOp === "is_not_null";

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange(column, e.target.value);
    },
    [column, onValueChange],
  );

  const toggleDropdown = useCallback(() => {
    if (dropdownOpen) {
      setDropdownOpen(false);
      return;
    }
    // Calculate position from button
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setDropdownOpen(true);
  }, [dropdownOpen]);

  const handleOperatorSelect = useCallback(
    (op: FilterOperator) => {
      onOperatorChange(column, op);
      setDropdownOpen(false);
      // Focus input after operator change (if not null op)
      if (op !== "is_null" && op !== "is_not_null") {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [column, onOperatorChange],
  );

  const handleClear = useCallback(() => {
    onClear(column);
  }, [column, onClear]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const placeholder = isNullOp
    ? currentOp === "is_null"
      ? "IS NULL"
      : "IS NOT NULL"
    : "";

  return (
    <div className={styles.filterCell}>
      <div className={styles.inputFilter}>
        <div className={styles.operatorToggle}>
          <button
            ref={buttonRef}
            className={styles.operatorBtn}
            onClick={toggleDropdown}
            title="Change filter operator"
            type="button"
          >
            <SlidersHorizontal size={11} />
          </button>
          {dropdownOpen &&
            dropdownPos &&
            createPortal(
              <div
                ref={dropdownRef}
                className={styles.operatorDropdown}
                style={{
                  position: "fixed",
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                }}
              >
                {operators.map((op) => (
                  <button
                    key={op.value}
                    className={`${styles.operatorOption} ${
                      currentOp === op.value ? styles.operatorActive : ""
                    }`}
                    onClick={() => handleOperatorSelect(op.value)}
                    type="button"
                  >
                    {op.label}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>
        {isNullOp ? (
          <span className={styles.nullLabel}>{placeholder}</span>
        ) : (
          <input
            ref={inputRef}
            type="text"
            className={styles.filterInput}
            value={value}
            onChange={handleInputChange}
            placeholder={currentLabel}
            title={`${currentLabel} filter for ${column}`}
          />
        )}
        {hasValue && (
          <button
            className={styles.clearBtn}
            onClick={handleClear}
            title="Clear filter"
            type="button"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
});

// ── Filter Bar ──────────────────────────────────────────────────

interface FilterBarProps {
  visible: boolean;
  activeCount: number;
  onToggle: () => void;
  onClearAll: () => void;
}

export const FilterBar = memo(function FilterBar({
  visible,
  activeCount,
  onToggle,
  onClearAll,
}: FilterBarProps) {
  return (
    <div className={styles.filterBar}>
      <button
        className={`${styles.filterToggle} ${visible ? styles.filterToggleActive : ""}`}
        onClick={onToggle}
        title={visible ? "Hide column filters" : "Show column filters"}
        type="button"
      >
        <Filter size={13} />
        <span>Filter</span>
        {activeCount > 0 && (
          <span className={styles.filterBadge}>{activeCount}</span>
        )}
      </button>
      {activeCount > 0 && (
        <button
          className={styles.clearAllBtn}
          onClick={onClearAll}
          type="button"
        >
          Clear all
        </button>
      )}
    </div>
  );
});

export { useColumnFilters } from "./useColumnFilters";
export type { ColumnFilter } from "./types";
