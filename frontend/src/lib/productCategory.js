/**
 * Single source of truth for product subcategory → high-level category
 * mapping AND for the merchandise-only exclusion rule.
 *
 * Business rule (mandated by the user, matches BigQuery `all_products_clean`
 * view which excludes `category NOT IN ('Accessories', 'Sale')`):
 *   Inventory, stock-to-sales and replenishment views must only consider
 *   merchandise — apparel & footwear — and must exclude Accessories, Sample
 *   & Sale items, and any row whose subcategory/category is null / empty.
 */

// Subcategory strings (product_type) that must be filtered out of every
// inventory-related chart, table and KPI across the app.
export const NON_MERCHANDISE_SUBCATS = new Set([
  "Accessories",
  "Belts",
  "Scarves",
  "Fragrances",
  "Bags",
  "Jewellery",
  "Jewelry",
  "Sample & Sale Items",
  "Sale",
]);

// High-level category buckets that are considered non-merchandise.
export const NON_MERCHANDISE_CATEGORIES = new Set(["Accessories", "Sale", "Other"]);

export function categoryFor(subcat) {
  if (!subcat) return null;
  const s = String(subcat).toLowerCase();
  if (/sample|sale/.test(s)) return "Sale";
  if (/bag|wallet|purse|clutch|belt|scarf|accessor|jewel|fragrance|perfume/.test(s)) return "Accessories";
  if (/dress|jumpsuit|playsuit|gown|kaftan/.test(s)) return "Dresses";
  if (/top|blouse|shirt|tee|tunic|cami|bodysuit/.test(s)) return "Tops";
  if (/trouser|pant|short|skort|skirt|jean|legging/.test(s)) return "Bottoms";
  if (/jacket|blazer|coat|cardigan|sweater|poncho|hoodie|waterfall|kimono|outerwear/.test(s)) return "Outerwear";
  if (/shoe|sandal|heel|sneaker|boot|footwear/.test(s)) return "Footwear";
  if (/swim|beach|lingerie|nightwear|underwear|intimate/.test(s)) return "Intimates & Swim";
  return "Other";
}

/**
 * True when a subcategory/category pair represents MERCHANDISE that should
 * appear in inventory / stock-to-sales / replenishment views.
 *
 * Pass either the subcategory alone (most common) or both.
 */
export function isMerchandise(subcat, category) {
  if (subcat == null || String(subcat).trim() === "") return false;
  if (NON_MERCHANDISE_SUBCATS.has(subcat)) return false;
  const cat = category || categoryFor(subcat);
  if (!cat) return false;
  if (NON_MERCHANDISE_CATEGORIES.has(cat)) return false;
  return true;
}
