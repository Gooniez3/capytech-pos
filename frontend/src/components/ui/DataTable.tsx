import type { ReactNode } from 'react';
import { Fragment } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;

  onRowClick?: (row: T) => void;

  emptyState?: ReactNode;
  loading?: boolean;
  skeleton?: ReactNode;
  minWidth?: string;

  isRowExpanded?: (row: T) => boolean;
  /** Extra `<tr>` nodes shown under an expanded parent row. */
  renderExpandedRow?: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  emptyState,
  loading,
  skeleton,
  minWidth = '800px',
  isRowExpanded,
  renderExpandedRow,
}: DataTableProps<T>) {
  const alignClass = (align?: string) =>
    align === 'right'
      ? 'text-right'
      : align === 'center'
      ? 'text-center'
      : 'text-left';

  return (
    <div className="w-full overflow-x-auto scrollbar-thin rounded-xl border border-slate-200 bg-white shadow-card">
      <table
        className="w-full table-fixed"
        style={{
          minWidth:
            minWidth === '0px'
              ? undefined
              : minWidth,
        }}
      >
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${alignClass(
                  col.align
                )}`}
                style={{
                  width: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {loading && skeleton}

          {!loading &&
            data.length === 0 &&
            !emptyState && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-slate-400"
                >
                  No data available
                </td>
              </tr>
            )}

          {!loading &&
            data.length === 0 &&
            emptyState && (
              <tr>
                <td colSpan={columns.length}>
                  {emptyState}
                </td>
              </tr>
            )}

          {!loading &&
            data.map((row) => {
              const key = rowKey(row);

              const expanded =
                isRowExpanded?.(row) ??
                false;

              return (
                <Fragment key={key}>
                  <tr
                    onClick={() =>
                      onRowClick?.(row)
                    }
                    className={`transition-colors ${
                      onRowClick
                        ? 'cursor-pointer hover:bg-slate-50'
                        : 'hover:bg-slate-50/50'
                    }`}
                  >
                    {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3.5 align-top text-sm text-slate-700 ${alignClass(
                      col.align
                    )}`}
                  >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>

                  {expanded && renderExpandedRow
                    ? renderExpandedRow(row)
                    : null}
                </Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export {
  ArrowUpRight,
  ArrowDownRight,
};