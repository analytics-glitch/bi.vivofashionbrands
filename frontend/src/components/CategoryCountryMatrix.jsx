import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, buildParams } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";

/**
 * Subcategory × Country sales matrix. Rows = subcategories sorted by total
 * sales across the four buckets (Kenya, Uganda, Rwanda, Online). Each cell
 * shows `KES X (Y%)` where Y% is the subcategory's share of THAT COUNTRY's
 * total sales — lets buyers spot where a subcategory over- or under-indexes
 * vs the rest of the region. A frozen total row at the bottom shows the
 * country totals and grand total.
 */
const CategoryCountryMatrix = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, channels, dataVersion } = applied;
  // Note: country filter is intentionally ignored — the matrix is about
  // comparing across all four buckets. Channel filter still applies.

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = buildParams({ dateFrom, dateTo, channels });
    // Drop country — the matrix needs all four buckets.
    delete params.country;
    api
      .get("/analytics/category-country-matrix", { params })
      .then((r) => {
        if (cancelled) return;
        setData(r.data || null);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(channels), dataVersion]);

  const { rows, countries, country_totals, grand_total_kes } = data || {};

  // Build SortableTable-compatible row shape: flatten cell.{country}.sales_kes
  // and cell.{country}.share_of_country_pct onto the row so each column can
  // sort independently on the absolute KES value.
  const tableRows = useMemo(() => {
    if (!rows) return [];
    return rows.map((r) => {
      const flat = {
        subcategory: r.subcategory,
        row_total_kes: r.row_total_kes,
      };
      (countries || []).forEach((c) => {
        const cell = r.cells?.[c] || { sales_kes: 0, share_of_country_pct: 0 };
        flat[`${c}_sales`] = cell.sales_kes;
        flat[`${c}_share`] = cell.share_of_country_pct;
      });
      return flat;
    });
  }, [rows, countries]);

  const columns = useMemo(() => {
    if (!countries) return [];
    const cols = [
      { key: "subcategory", label: "Subcategory", align: "left",
        render: (r) => <span className="font-medium">{r.subcategory}</span> },
    ];
    countries.forEach((c) => {
      cols.push({
        key: `${c}_sales`,
        label: c,
        numeric: true,
        sortValue: (r) => r[`${c}_sales`] || 0,
        render: (r) => {
          const v = r[`${c}_sales`] || 0;
          const s = r[`${c}_share`] || 0;
          if (!v) return <span className="text-muted">—</span>;
          return (
            <span className="num inline-flex flex-col items-end leading-tight">
              <span className="font-semibold">{fmtKES(v)}</span>
              <span className="text-[10.5px] text-muted">{s.toFixed(1)}% of {c}</span>
            </span>
          );
        },
        csv: (r) => r[`${c}_sales`],
      });
    });
    cols.push({
      key: "row_total_kes",
      label: "Row Total",
      numeric: true,
      render: (r) => <span className="text-brand font-bold num">{fmtKES(r.row_total_kes)}</span>,
      csv: (r) => r.row_total_kes,
    });
    return cols;
  }, [countries]);

  // Footer total row mirrors column structure but always sticks at the
  // bottom (rendered via SortableTable's `footerRow` prop).
  const footerRow = useMemo(() => {
    if (!data) return null;
    const cells = [
      <td key="label" className="px-2 py-2 text-left font-bold text-brand-deep">Country totals</td>,
    ];
    (countries || []).forEach((c) => {
      const v = country_totals?.[c] || 0;
      cells.push(
        <td key={c} className="px-2 py-2 text-right">
          <span className="num font-bold">{fmtKES(v)}</span>
          <span className="block text-[10.5px] text-muted">100% of {c}</span>
        </td>
      );
    });
    cells.push(
      <td key="grand" className="px-2 py-2 text-right">
        <span className="text-brand font-extrabold num">{fmtKES(grand_total_kes || 0)}</span>
      </td>
    );
    return cells;
  }, [data, countries, country_totals, grand_total_kes]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data || !tableRows.length) return <Empty label="No subcategory data for this period." />;

  return (
    <div className="card-white p-5" data-testid="category-country-matrix-card">
      <SectionTitle
        title="Category × Country Matrix"
        subtitle="Each row is a subcategory; each cell shows the KES it generated in that country and the share it represents of THAT country's total sales. Click a column header to sort by absolute KES. Row total = sum across the four buckets. Country totals row pinned at the bottom."
      />
      <SortableTable
        testId="category-country-matrix"
        exportName="category-country-matrix.csv"
        initialSort={{ key: "row_total_kes", dir: "desc" }}
        columns={columns}
        rows={tableRows}
        footerRow={footerRow}
      />
    </div>
  );
};

export default CategoryCountryMatrix;
