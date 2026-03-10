import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DataTable,
  PaginationState,
} from "@components/ui/data-table/DataTable";
import { useToast } from "@context/ToastContext";
import { ViewTab } from "@context/TabContext";
import { ColumnInfo, PaginatedTableData } from "./TablePanel"; // Reuse interfaces from TablePanel or define shared types

const DEFAULT_PAGE_SIZE = 100;

interface ViewPanelProps {
  connectionId: string;
  tab: ViewTab;
}

export function ViewPanel({ connectionId, tab }: ViewPanelProps) {
  const toast = useToast();
  const [viewData, setViewData] = useState<any[]>([]);
  const [viewColumnInfo, setViewColumnInfo] = useState<ColumnInfo[]>([]);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const [viewPagination, setViewPagination] = useState<PaginationState>({
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    totalCount: 0,
  });

  const fetchViewData = useCallback(
    async (
      viewName: string,
      schema: string,
      page: number,
      pageSize: number,
    ) => {
      setIsViewLoading(true);
      try {
        const result = await invoke<PaginatedTableData>("get_view_data", {
          id: connectionId,
          view: viewName,
          schema: schema,
          limit: pageSize,
          offset: page * pageSize,
        });
        setViewData(result.rows);
        setViewColumnInfo(result.columns || []);
        setViewPagination((prev) => ({
          ...prev,
          page,
          pageSize,
          totalCount: result.total_count,
        }));
      } catch (e: any) {
        console.error(e);
        toast.error(`Failed to load view data: ${e}`);
      } finally {
        setIsViewLoading(false);
      }
    },
    [connectionId, toast],
  );

  useEffect(() => {
    fetchViewData(tab.viewName, tab.schema, 0, viewPagination.pageSize);
  }, [connectionId, tab.viewName, tab.schema]); // Intentionally not dependent on viewPagination.pageSize inside the effect 

  return (
    <>
      <div style={{ padding: '8px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontWeight: 500, fontSize: '0.85rem' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
          Read-Only View
        </span>
      </div>
      <DataTable
        data={viewData}
        columnInfo={viewColumnInfo}
        isLoading={isViewLoading}
        pagination={viewPagination}
        onPageChange={(newPage) => {
          fetchViewData(
            tab.viewName,
            tab.schema,
            newPage,
            viewPagination.pageSize,
          );
        }}
        onPageSizeChange={(newPageSize) => {
          fetchViewData(
            tab.viewName,
            tab.schema,
            0,
            newPageSize,
          );
        }}
      />
    </>
  );
}
