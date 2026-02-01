import { useState } from "react";
import {
  Table,
  Eye,
  Code2,
  Hash,
  ChevronRight,
  Search,
  RefreshCw,
  Loader2,
  ChevronDown,
  Layers,
} from "lucide-react";
import styles from "./SchemaSidebar.module.css";

export interface SchemaObject {
  name: string;
  object_type: string;
  row_count: number | null;
  size: string | null;
}

export interface SchemaObjects {
  tables: SchemaObject[];
  views: SchemaObject[];
  functions: SchemaObject[];
  sequences: SchemaObject[];
}

interface SchemaSidebarProps {
  schema: SchemaObjects | null;
  isLoading: boolean;
  selectedItem: { type: string; name: string } | null;
  onSelectItem: (type: string, name: string) => void;
  onRefresh: () => void;
  schemas?: string[];
  activeSchema: string;
  onSchemaChange: (schema: string) => void;
}

export function SchemaSidebar({
  schema,
  isLoading,
  selectedItem,
  onSelectItem,
  onRefresh,
  schemas = [],
  activeSchema,
  onSchemaChange,
}: SchemaSidebarProps) {
  const [filter, setFilter] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["tables"])
  );
  const [isSchemaDropdownOpen, setIsSchemaDropdownOpen] = useState(false);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const filterItems = (items: SchemaObject[]) =>
    items.filter((item) =>
      item.name.toLowerCase().includes(filter.toLowerCase())
    );

  const formatRowCount = (count: number | null) => {
    if (count === null || count < 0) return "~";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  if (isLoading) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.header}>
          <span className={styles.title}>Schema</span>
        </div>
        <div className={styles.loading}>
          <Loader2 size={20} className={styles.spinner} />
          <span>Loading schema...</span>
        </div>
      </div>
    );
  }

  const sections = [
    {
      key: "tables",
      title: "Tables",
      icon: Table,
      items: schema?.tables || [],
      showMeta: true,
    },
    {
      key: "views",
      title: "Views",
      icon: Eye,
      items: schema?.views || [],
      showMeta: false,
    },
    {
      key: "functions",
      title: "Functions",
      icon: Code2,
      items: schema?.functions || [],
      showMeta: false,
    },
    {
      key: "sequences",
      title: "Sequences",
      icon: Hash,
      items: schema?.sequences || [],
      showMeta: false,
    },
  ];

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Schema</span>
        <button
          className={styles.refreshBtn}
          onClick={onRefresh}
          title="Refresh schema"
          data-loading={isLoading}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Schema Selector */}
      <div className={styles.schemaSelector}>
        <div className={styles.schemaSelectorWrapper}>
          <button
            className={styles.schemaSelectorBtn}
            onClick={() => setIsSchemaDropdownOpen(!isSchemaDropdownOpen)}
          >
            <Layers size={14} className={styles.schemaIcon} />
            <span className={styles.schemaName}>{activeSchema}</span>
            <ChevronDown
              size={14}
              className={styles.schemaChevron}
              data-open={isSchemaDropdownOpen}
            />
          </button>
          {isSchemaDropdownOpen && (
            <div className={styles.schemaDropdown}>
              {schemas.length === 0 ? (
                <div className={styles.schemaDropdownEmpty}>
                  No schemas found
                </div>
              ) : (
                schemas.map((s) => (
                  <button
                    key={s}
                    className={styles.schemaDropdownItem}
                    data-active={s === activeSchema}
                    onClick={() => {
                      onSchemaChange(s);
                      setIsSchemaDropdownOpen(false);
                    }}
                  >
                    {s}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles.searchWrapper}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Filter objects..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </div>

      <div className={styles.content}>
        {sections.map((section) => {
          const filteredItems = filterItems(section.items);
          const isExpanded = expandedSections.has(section.key);
          const Icon = section.icon;

          return (
            <div key={section.key} className={styles.section}>
              <button
                className={styles.sectionHeader}
                onClick={() => toggleSection(section.key)}
              >
                <ChevronRight
                  size={12}
                  className={styles.sectionChevron}
                  data-open={isExpanded}
                />
                <Icon size={14} className={styles.sectionIcon} />
                <span className={styles.sectionTitle}>{section.title}</span>
                <span className={styles.sectionCount}>
                  {section.items.length}
                </span>
              </button>

              {isExpanded && (
                <div className={styles.sectionItems}>
                  {filteredItems.length === 0 ? (
                    <div className={styles.emptySection}>
                      {filter
                        ? "No matches"
                        : `No ${section.title.toLowerCase()}`}
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const isSelected =
                        selectedItem?.type === section.key &&
                        selectedItem?.name === item.name;

                      return (
                        <button
                          key={item.name}
                          className={styles.item}
                          data-selected={isSelected}
                          onClick={() => onSelectItem(section.key, item.name)}
                        >
                          <Icon size={14} className={styles.itemIcon} />
                          <span className={styles.itemName}>{item.name}</span>
                          {section.showMeta && item.row_count !== null && (
                            <span className={styles.itemMeta}>
                              {formatRowCount(item.row_count)} rows
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
