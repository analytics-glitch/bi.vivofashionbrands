import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

// Module-level cache so multiple tables don't re-fetch the same style.
// Map<style_name, string | null>  — null means "confirmed no custom thumbnail".
const CACHE = new Map();
const IN_FLIGHT = new Map(); // Map<string, Promise>

/**
 * useThumbnails — batch-fetches custom image URLs for a list of styles
 * from the `/api/thumbnails/lookup` endpoint. Results are memoised in a
 * module-level cache so switching pages / tabs doesn't re-trigger the
 * network.
 *
 * Falls back silently — missing styles simply return `null` and the
 * <ProductThumbnail /> component renders its deterministic placeholder.
 */
export const useThumbnails = (styles = []) => {
  const keys = useMemo(() => {
    const out = new Set();
    (styles || []).forEach((s) => {
      if (typeof s === "string" && s.trim()) out.add(s);
    });
    return Array.from(out);
  }, [styles]);

  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const missing = keys.filter((k) => !CACHE.has(k) && !IN_FLIGHT.has(k));
    if (missing.length === 0) return;
    // Chunk at 300 — matches backend upper bound.
    const chunks = [];
    for (let i = 0; i < missing.length; i += 300) {
      chunks.push(missing.slice(i, i + 300));
    }
    chunks.forEach((chunk) => {
      const p = api.post("/thumbnails/lookup", { styles: chunk })
        .then(({ data }) => {
          chunk.forEach((k) => CACHE.set(k, data?.[k] || null));
        })
        .catch(() => {
          // On failure, mark as null so we stop retrying this session.
          chunk.forEach((k) => CACHE.set(k, null));
        })
        .finally(() => {
          chunk.forEach((k) => IN_FLIGHT.delete(k));
          if (mounted.current) setTick((t) => t + 1);
        });
      chunk.forEach((k) => IN_FLIGHT.set(k, p));
    });
  }, [keys]);

  const urlFor = useCallback((style) => CACHE.get(style) || null, [tick]);  // eslint-disable-line react-hooks/exhaustive-deps

  return { urlFor, ready: keys.every((k) => CACHE.has(k)) };
};

/** Invalidate cache entries after admin upload so the new image appears
 *  immediately. */
export const invalidateThumbnail = (style) => {
  if (style) CACHE.delete(style);
};

/** Optimistically push a URL into the cache — used by the admin upload
 *  flow so the new image renders instantly. */
export const primeThumbnail = (style, url) => {
  if (style) CACHE.set(style, url || null);
};
