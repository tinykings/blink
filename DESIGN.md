# Blink Design System

## Product Identity

Blink is a single-page RSS reader built for keyboard-first power users who want a fast, minimal, focused reading experience. It syncs starred items across devices via GitHub Gist.

**Audience**: Developers, tinkerers, information-overload survivors. People who use `j/k` before reaching for a mouse.

**Value**: Zero clutter. Feed items are the only content. No algorithm, no sidebar, no social features, no notifications, no AI.

## Design Principles

1. **Content is king** — Everything else is chrome. Typography, spacing, and color serve readability. Cards exist to frame the content, not compete with it.
2. **Keyboard-first, pointer-welcome** — All functions must be reachable via keyboard. Mouse support is a requirement, never the primary path.
3. **Utilitarian, not spartan** — Beauty comes from precision, not ornament. Every pixel earns its place. No gradients, no glassmorphism, no em dashes, no decorative flourishes.
4. **Error states are designed, not afterthoughts** — Loading, empty, error, and offline states each have specific visual treatment with clear recovery actions.
5. **Theme-aware, not theme-dependent** — Dark and light themes share a single accent hue (137°) and a consistent neutral family. Switching never breaks readability.

## Visual System

### Color

- **Accent**: `oklch(87% 0.16 137)` dark, `oklch(48% 0.1 137)` light. Green hue (137°) across both themes.
- **Neutrals**: Tilted toward accent hue at very low chroma (0.002–0.008) for subtle warmth. No `#000`, no `#fff`.
- **Semantic**: Star (pink/red), Error (red), Success (green). Each has its own custom property.
- **Source dots**: Deterministic OKLCH hue derived from feed name hash. Saturation 0.08, lightness 65%. Pure utility — enables scanning without side-stripe borders.
- **Video background**: Cool-tinted neutral (`oklch(0.14 0.006 190)` dark, `oklch(0.85 0.01 190)` light) distinguishing embedded media areas.

### Typography

- **Font stack**: `ui-sans-serif, system-ui, -apple-system, sans-serif`
- **Monospace**: `ui-monospace, monospace`
- **Headings**: `500` weight, `1.15rem` for item titles
- **Body**: `400` weight, `1rem/1.6`
- **Meta/labels**: `0.8rem–0.9rem`, muted color
- **Line lengths**: `max-width: 800px` on feed container

### Spacing

- **Card padding**: `10px` (`--r`) with `48px` bottom padding for actions
- **Between cards**: `16px`
- **Sections (separators)**: `32px` above, `24px` below
- **Bottom bar**: Fixed at bottom, `min(800px, calc(100vw - 24px))` width, `18px` top border radius
- **Safe areas**: `env(safe-area-inset-*)` used throughout for iOS notch/bar

### Shape

- **Border radius**: `10px` (`--r`) on cards/modals, `6px` on small elements (inputs, buttons), `8px` on buttons
- **Borders**: `1px solid` with `--border` variable
- **Shadows**: Subtle `0 2px 8px` for cards, `0 4px 24px` for modals, `0 -10px 28px` for bottom bar

## Component Vocabulary

### Feed Item (`.item`)
- Card with `border`, `border-radius`, `box-shadow`
- `content-visibility: auto` for performance
- `tabindex="0"` for keyboard focus
- `.focused` class for keyboard navigation highlight (accent border + glow)
- Contains: optional media, `<h2>` with link, meta bar, optional description, actions

### Meta Bar (`.meta`)
- Flex row at bottom of card: expand button, source dot, source name, separator, relative time
- `position: absolute` pinned to bottom of card
- Source dot: inline `<span>` with `color` computed from feed name

### Buttons
- **Standard (`.btn`)**: Border, rounded, surface background, accent text
- **Floating (`.floating-btn`)**: In bottom bar, `50×50px`, SVG icon, elevated shadow
- **Floating link (`.floating-link`)**: Text-only, transparent background, muted color
- **Star (`.star`)**: `50×50px`, heart icon, `.starred` state in pink, pop animation
- **Expand (`.expand-btn`)**: `44×44px`, chevron SVG, toggles description visibility

### Modal (`.modal`)
- Fixed fullscreen overlay with `rgba` backdrop
- Centered `.modal-content` at `min(90vw, 400px)` with scroll
- Focus trap on Tab cycling
- Close on Escape, backdrop click, and explicit close button

### Setup Form (`.setup-content`)
- Fixed fullscreen background (no overlay), centered card
- Icon, heading, description, Gist ID + Token inputs, save button
- Shown only when credentials missing

### Toast (`.toast`)
- Fixed container above bottom bar
- Auto-removes after delay with `animationend` listener
- `.out` class triggers fade-out animation

### Separator (`.sep`)
- Flex row with `::before`/`::after` lines and heart in center
- Divides starred from unstarred items

### Empty State (`.icon .title .sub`)
- Centered column, large checkmark, two lines of text
- Shown when all items are read in "New" view

### Skeleton Loading
- Three placeholder cards with shimmer gradient animation
- `content-visibility: auto` for layout stability

## Interaction Patterns

### Keyboard Navigation
| Key | Action |
|-----|--------|
| `j` | Next item |
| `k` | Previous item |
| `s` | Toggle star |
| `e` | Toggle description |
| `o` / `Enter` | Open link |
| `?` | Toggle help |
| `Escape` | Close modal |
| `Tab` | Cycle focus within modal / feed items |

- `.focused` class tracks keyboard position; synced with Tab via `focusin` event listener
- `highlight()` scrolls to center, applies `.focused`, removes from others

### Star / Sync
- Star toggle is immediate (optimistic); pushes to Gist via `gistSync.pushSoon()` with 1s debounce
- Pull-on-startup fetches remote as source of truth
- Merge resolves last-write-wins on starred status by `starred_changed_at`
- Unstarred items expire per retention days config

### Mark All Read
- Confirm dialog shows unread count; in-place re-render (no page reload)
- Triggered from checkmark button in bottom bar
- Disabled until Gist sync is ready

## Theme System

- **Detection**: `prefers-color-scheme` media query
- **No toggle** — follows system preference exclusively
- **Dark**: `--bg: oklch(22% 0.008 137)`, light text
- **Light**: `--bg: oklch(97% 0.003 137)`, dark text
- **Reduced motion**: `prefers-reduced-motion: reduce` disables all animations/transitions

## CSS Conventions

- Custom properties on `:root` / `@media (prefers-color-scheme: light) :root`
- Class names: lowercase, hyphenated
- Layout: `flex` and `grid` (no float, no clearfix)
- `box-sizing: border-box` universal reset
- `border: 1px solid var(--border)` as default separator style
- Transitions: `150ms` duration, `ease` timing, limited to color, border, box-shadow, transform
- No preprocessor, no CSS-in-JS, no framework dependency

## Code Architecture

- **Vanilla JS ES module** (`type="module"`) — no framework, no build step
- `js/main.js` — entry point: rendering, keyboard nav, event handlers, modals, sync init
- `js/sync.js` — GitHub Gist module: fetch, push, merge, debounce, retry
- `js/storage.js` — utilities: starred items, retention, sanitization, safe URLs
- `js/youtube.js` — YouTube embed player lifecycle
- Inline JSON in `#feed-data` script tag as initial data source
- `localStorage` for credential persistence; in-memory `meta` object for runtime state

## File Organization

```
index.html          Entry point, setup form, settings modal, feed data JSON
css/style.css       All styles (587 lines)
js/main.js          App logic (571 lines)
js/sync.js          Gist sync module (316 lines)
js/storage.js       Storage utilities (115 lines)
js/youtube.js       YouTube player helper
images/icon-192.png PWA icon
manifest.json       PWA manifest
sw.js               Service worker
```

## Future Considerations

- Inline keyboard shortcut hints (improves Recognition, current score: 3)
- Onboarding/intro screen (improves Help, current score: 2)
- Feed update progress indicator (improves Status Visibility, current score: 3)
- Undo for mark-all-read (replaces confirm pattern)
