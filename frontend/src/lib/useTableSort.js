import React, { useMemo, useState } from "react";
import { CaretUp, CaretDown } from "@phosphor-icons/react";

/**
 * useTableSort — minimal sort-state + sort-helper for plain HTML tables.
 *
 * Drop-in companion for the many bespoke tables across the dashboard that
 * weren't built on the shared `<SortableTable>` component. Gives us a
 * three-state click pattern (asc → desc → off) and a small accessor-based
 * comparator that respects numbers, strings, and null values.
 *
 * Pair with the exported `<SortableTh>` helper to render clickable
 * headers with a chevron indicator next to the active column.
 *
 *   const { sort, toggleSort, sortRows } = useTableSort();
 *   const accessors = { units: r => r.units_sold, location: r => r.channel };
 *   const visible = sortRows(rows, accessors);
 *   <SortableTh sortKey="units" sort={sort} onSort={toggleSort} numeric>
 *     Units
 *   </SortableTh>
 */
export const useTableSort = (initialSort = null) => {
  const [sort, setSort] = useState(initialSort);

  const toggleSort = (key, opts = {}) => {
    setSort((s) => {
      if (!s || s.key !== key) {
        return { key, dir: opts.numeric ? "desc" : "asc" };
      }
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const sortRows = useMemo(() => (rows, accessors = {}) => {
    if (!sort || !rows?.length) return rows || [];
    const acc = accessors[sort.key] || ((r) => r?.[sort.key]);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [sort]);

  return { sort, toggleSort, sortRows };
};

/**
 * SortableTh — clickable <th> with a chevron indicator. Re-uses Tailwind
 * utilities already in the codebase (`text-right`, `cursor-pointer`,
 * `hover:text-brand`) so the visual treatment matches the shared
 * `<SortableTable>` exactly.
 */
export const SortableTh = ({
  sortKey,
  sort,
  onSort,
  numeric = false,
  align,
  className = "",
  title,
  children,
  testId,
  ...rest
}) => {
  const isActive = sort && sort.key === sortKey;
  const isRight = align === "right" || numeric;
  const justify = isRight ? "justify-end" : "";
  return (
    <th
      className={`${isRight ? "text-right" : "text-left"} cursor-pointer select-none hover:text-brand ${className}`}
      onClick={() => onSort(sortKey, { numeric })}
      title={title}
      data-testid={testId}
      {...rest}
    >
      <span className={`inline-flex items-center gap-1 ${justify}`}>
        {children}
        {isActive && (sort.dir === "asc" ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />)}
      </span>
    </th>
  );
};

export default useTableSort;
