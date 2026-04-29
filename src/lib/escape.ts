// HTML attribute / text escaping. Used by every JS-built fragment that
// interpolates user-controlled strings into innerHTML — gallery thumbs,
// manage-panel photo grid, and any future surface. Centralized so the
// table of replacements lives in exactly one place.

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] ?? c);
}
