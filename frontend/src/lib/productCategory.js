/**
 * Single source of truth for product subcategory → category mapping.
 *
 * Taxonomy provided by Vivo merchandising team on 2026-04-24; must stay in
 * lock-step with the `SUBCATEGORY_TO_CATEGORY` dict in /app/backend/server.py.
 * If the merchandising team adds a new subcategory, update BOTH this file
 * and the backend dict.
 *
 * Business rule (mandated by the user, matches BigQuery `all_products_clean`
 * view which excludes `category NOT IN ('Accessories', 'Sale')`):
 *   Inventory, stock-to-sales and replenishment views must only consider
 *   merchandise (apparel) and must exclude Accessories, Sample & Sale, and
 *   anything whose subcategory is null/unknown.
 */

export const SUBCATEGORY_TO_CATEGORY = {
  // Accessories
  "Accessories": "Accessories",
  "Bangles & Bracelets": "Accessories",
  "Belts": "Accessories",
  "Body Mists & Fragrances": "Accessories",
  "Earrings": "Accessories",
  "Necklaces": "Accessories",
  "Rings": "Accessories",
  "Scarves": "Accessories",
  // Bottoms
  "Culottes & Capri Pants": "Bottoms",
  "Full Length Pants": "Bottoms",
  "Jumpsuits & Playsuits": "Bottoms",
  "Leggings": "Bottoms",
  "Shorts & Skorts": "Bottoms",
  // Dresses
  "Knee Length Dresses": "Dresses",
  "Maxi Dresses": "Dresses",
  "Midi & Capri Dresses": "Dresses",
  "Short & Mini Dresses": "Dresses",
  // Mens
  "Men's Bottoms": "Mens",
  "Men's Tops": "Mens",
  // Outerwear
  "Hoodies & Sweatshirts": "Outerwear",
  "Jackets & Coats": "Outerwear",
  "Sweaters & Ponchos": "Outerwear",
  "Waterfalls & Kimonos": "Outerwear",
  // Sale
  "Sample & Sale Items": "Sale",
  // Skirts
  "Knee Length Skirts": "Skirts",
  "Maxi Skirts": "Skirts",
  "Midi & Capri Skirts": "Skirts",
  "Short & Mini Skirts": "Skirts",
  // Tops
  "Bodysuits": "Tops",
  "Fitted Tops": "Tops",
  "Loose Tops": "Tops",
  "Midriff & Crop Tops": "Tops",
  "T-shirts & Tank Tops": "Tops",
  // Two-Piece Sets
  "Pants & Top Set": "Two-Piece Sets",
  "Pants & Waterfall Set": "Two-Piece Sets",
  "Skirts & Top Set": "Two-Piece Sets",
};

// High-level category buckets that are considered non-merchandise.
export const NON_MERCHANDISE_CATEGORIES = new Set(["Accessories", "Sale", "Other"]);

export function categoryFor(subcat) {
  if (!subcat) return null;
  return SUBCATEGORY_TO_CATEGORY[subcat] || "Other";
}

/**
 * True when a subcategory represents MERCHANDISE that should appear in
 * inventory / stock-to-sales / replenishment views. Anything mapped to
 * Accessories, Sale, or Other is excluded.
 */
export function isMerchandise(subcat) {
  if (subcat == null || String(subcat).trim() === "") return false;
  const cat = SUBCATEGORY_TO_CATEGORY[subcat];
  if (!cat) return false; // unknown subcategory → exclude
  return !NON_MERCHANDISE_CATEGORIES.has(cat);
}
