// The little glyphs for menus. A contributed plugin may instead give raw SVG
// markup in its `icon`, or nothing at all, in which case its initial is used.
import { svg } from "./dom.js"

const ICONS = {
  text: `<path d="M3 4h10M8 4v9M6 13h4"/>`,
  h1: `<path d="M3 3v10M9 3v10M3 8h6"/><path d="M11.5 7l1.5-1v7"/>`,
  h2: `<path d="M3 3v10M9 3v10M3 8h6"/><path d="M11.5 7.5a1.5 1.5 0 113 0c0 1.5-3 2-3 4.5h3"/>`,
  h3: `<path d="M3 3v10M9 3v10M3 8h6"/><path d="M11.5 6.5h3l-2 2.5a1.75 1.75 0 11-1.25 3"/>`,
  bullet: `<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="3" cy="4" r=".8" fill="currentColor"/><circle cx="3" cy="8" r=".8" fill="currentColor"/><circle cx="3" cy="12" r=".8" fill="currentColor"/>`,
  ordered: `<path d="M6 4h8M6 8h8M6 12h8M2 3.5l1-.5v3M2 11h2l-2 2h2"/>`,
  quote: `<path d="M6 4H3v4h3l-1 4M13 4h-3v4h3l-1 4"/>`,
  code: `<path d="M6 4L2 8l4 4M10 4l4 4-4 4"/>`,
  image: `<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1"/><path d="M3 11.5l3-3 2.5 2.5 2-1.5L13 12"/>`,
  link: `<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1"/>`,
  columns: `<rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/>`,
  columns3: `<rect x="1.5" y="3" width="3.5" height="10" rx="1"/><rect x="6.25" y="3" width="3.5" height="10" rx="1"/><rect x="11" y="3" width="3.5" height="10" rx="1"/>`,
  table: `<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.5h12M2 10h12M6.5 6.5V13M10 6.5V13"/>`,
  plugins: `<path d="M6 2v3M10 2v3M4 5h8v4a4 4 0 01-8 0z"/><path d="M8 13v2"/>`,
  clock: `<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>`,
  todo: `<rect x="2" y="2.5" width="5" height="5" rx="1"/><rect x="2" y="8.5" width="5" height="5" rx="1"/><path d="M3.2 5l1 1 1.6-1.8M9.5 5H14M9.5 11H14"/>`,
  underline: `<path d="M4 3v5a4 4 0 008 0V3M3 14h10"/>`,
  strikethrough: `<path d="M3 8h10M11.5 5c-.6-1.3-2-2-3.5-2-2 0-3.2 1-3.2 2.3 0 1 .6 1.7 1.7 2.2M4.5 11c.6 1.3 2 2 3.5 2 2.2 0 3.4-1 3.4-2.4 0-.8-.4-1.5-1.2-2"/>`,
  superscript: `<path d="M2 12l5-7M7 12L2 5M11 6.5c0-1.6 2.5-1.6 2.5 0 0 1-2.5 1.6-2.5 3h2.6"/>`,
  subscript: `<path d="M2 10l5-7M7 10L2 3M11 13c0-1.6 2.5-1.6 2.5 0 0 1-2.5 1.6-2.5 3h2.6"/>`,
}

// A built-in icon name, raw SVG markup from a contributed plugin, or the
// plugin's initial as a last resort.
export function icon(item) {
  if (ICONS[item.icon]) return svg(ICONS[item.icon])
  if (typeof item.icon === "string" && item.icon.includes("<")) return svg(item.icon)
  return item.name.slice(0, 1).toUpperCase()
}
