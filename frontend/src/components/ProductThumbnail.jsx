import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { invalidateThumbnail, primeThumbnail } from "@/lib/useThumbnails";
import { toast } from "sonner";
import { Camera, Pencil, Trash, X } from "@phosphor-icons/react";

// ─── deterministic placeholder ────────────────────────────────────────
// Hash the style name once, pick a colour from the Vivo palette, and
// show the first two meaningful characters. Prevents the "AI slop"
// generic-grey-box look while staying on-brand.
const PALETTE = [
  // orange / amber family (brand)
  "#F97316", "#FB923C", "#F59E0B",
  // green family (brand accent)
  "#16A34A", "#059669", "#10B981",
  // supportive neutrals / jewel tones
  "#7C3AED", "#DB2777", "#0EA5E9", "#EF4444",
  "#8B5CF6", "#0891B2", "#CA8A04",
];

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const initialsFor = (s) => {
  const cleaned = (s || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length === 0) return "?";
  if (cleaned.length === 1) return cleaned[0].slice(0, 2).toUpperCase();
  return (cleaned[0][0] + cleaned[1][0]).toUpperCase();
};

const Placeholder = ({ style, size }) => {
  const h = hash(style || "");
  const bg = PALETTE[h % PALETTE.length];
  const letters = initialsFor(style);
  const fontSize = Math.round(size * 0.38);
  return (
    <div
      className="flex items-center justify-center font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bg} 0%, ${bg}dd 100%)`,
        fontSize,
        lineHeight: 1,
        letterSpacing: "-0.02em",
      }}
      aria-label={`Placeholder for ${style}`}
    >
      {letters}
    </div>
  );
};

// ─── admin editor ─────────────────────────────────────────────────────
const Editor = ({ style, currentUrl, onClose, onChanged }) => {
  const [url, setUrl] = useState(currentUrl || "");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(currentUrl || "");

  const save = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("Paste a full https:// URL");
      return;
    }
    setSaving(true);
    try {
      await api.post("/thumbnails", { style_name: style, image_url: trimmed });
      primeThumbnail(style, trimmed);
      toast.success("Thumbnail saved");
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save — check the URL");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!currentUrl) { onClose(); return; }
    setSaving(true);
    try {
      await api.delete(`/thumbnails/${encodeURIComponent(style)}`);
      invalidateThumbnail(style);
      toast.success("Thumbnail removed");
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error("Couldn't remove");
    } finally {
      setSaving(false);
    }
  };

  // esc to close
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      data-testid="thumbnail-editor-backdrop"
    >
      <div
        className="card-white p-5 w-full max-w-md space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted">Product thumbnail</div>
            <div className="font-semibold text-[15px] mt-0.5 break-words">{style}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-panel"
            data-testid="thumbnail-editor-close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="rounded-lg overflow-hidden border border-border" style={{ width: 96, height: 96 }}>
            {preview ? (
              <img
                src={preview}
                alt="preview"
                className="w-full h-full object-cover"
                onError={() => setPreview("")}
              />
            ) : (
              <Placeholder style={style} size={96} />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-muted">Image URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(e.target.value.trim()); }}
              placeholder="https://cdn.example.com/sku.jpg"
              className="w-full border border-border rounded px-2 py-1.5 text-[13px] outline-none focus:border-brand"
              data-testid="thumbnail-editor-url"
              autoFocus
            />
            <p className="text-[10.5px] text-muted">
              Must be a direct https:// link to a web-safe image (JPG/PNG/WebP).
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={remove}
            disabled={saving || !currentUrl}
            className="text-[12px] text-red-700 hover:bg-red-50 px-2 py-1 rounded inline-flex items-center gap-1 disabled:opacity-30"
            data-testid="thumbnail-editor-remove"
          >
            <Trash size={13} /> Remove
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded hover:bg-panel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !url.trim()}
              className="text-[12px] px-3 py-1.5 rounded bg-brand text-white hover:bg-brand-deep disabled:opacity-40"
              data-testid="thumbnail-editor-save"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── main component ──────────────────────────────────────────────────
/**
 * <ProductThumbnail style="Linen Wrap Dress" url={urlFor(style)} />
 *
 * Renders a square thumbnail for a style. If `url` is falsy, a
 * deterministic coloured placeholder with 2-letter monogram is shown.
 * Admins see a small edit affordance on hover to attach / change the
 * image URL.
 */
const ProductThumbnail = ({
  style,
  url,
  size = 40,
  allowEdit = true,
  className = "",
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" && allowEdit;
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const effectiveUrl = !failed ? (url || "") : "";

  const onChanged = useCallback(() => {
    setFailed(false);
  }, []);

  return (
    <>
      <div
        className={`group relative inline-block rounded-md overflow-hidden border border-border shrink-0 align-middle ${className}`}
        style={{ width: size, height: size }}
        data-testid={`product-thumbnail-${style}`}
      >
        {effectiveUrl ? (
          <img
            src={effectiveUrl}
            alt={style}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <Placeholder style={style} size={size} />
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title={effectiveUrl ? "Change thumbnail" : "Add thumbnail"}
            data-testid={`product-thumbnail-edit-${style}`}
          >
            {effectiveUrl ? <Pencil size={Math.max(12, size * 0.35)} /> : <Camera size={Math.max(12, size * 0.35)} />}
          </button>
        )}
      </div>
      {editing && (
        <Editor
          style={style}
          currentUrl={url}
          onClose={() => setEditing(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
};

export default ProductThumbnail;
