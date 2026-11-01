# Design system

All styling lives in `src/styles/global.css`. Colours are tokens on `:root`; `tests/uiRedesign.test.ts` fails if a hex colour appears anywhere else in the stylesheet (white excepted).

## Colour

| Role | Token | Value |
|---|---|---|
| Navigation | `--ink`, `--ink-2` | `#0F172A`, `#1E293B` |
| App background | `--paper` | `#F5F6F8` |
| Surfaces | `--surface`, `--surface-2`, `--surface-3` | `#FFFFFF`, `#F8FAFC`, `#F1F5F9` |
| Borders | `--line`, `--line-strong` | `#E2E8F0`, `#CBD5E1` |
| Text | `--text`, `--muted`, `--faint` | `#0F172A`, `#475569`, `#5E6E82` |
| Action and focus | `--primary`, `--focus` | `#0F766E` |
| Brand accent | `--haul` | `#D9A21B`, only on the brand mark, money-flow line and payable rule |
| Status | `--ok`, `--warn`, `--danger`, `--info` | each has `-soft`, `-line` and `-text` shades |

Status always carries words as well as colour. Every text and status pair was calculated at 4.5:1 or better, including `--faint` on `--paper`.

## Type

IBM Plex Sans, with Plex Sans Condensed for large figures (both free, already loaded from Google Fonts). All numbers use tabular numerals. Scale: 12, 13, 14, 16, 18 and 22px through `--fs-*`.

**Amounts are never truncated.** A figure too wide for its cell wraps. Only text columns may ellipsize, and they keep the full value in `title`; touch screens show the full text instead.

## Spacing and shape

4px scale (`--s-1` to `--s-8`). Radii 6, 8 and 12px. Controls are 36px, or 44px on touch screens through `@media (pointer: coarse)`.

## Components

Use `src/components/ui.tsx` and `DataTable`, `DateFilter`, `BarList`, `SummaryBand`. Button variants are default, primary, danger and ghost.

- One primary action per page, top right.
- Writes to live data that nothing else guards get a `ConfirmDialog`.
- Don't show a control that doesn't work.

## Responsive

| Width | Layout |
|---|---|
| Over 900px | Sidebar, top search bar |
| 900px and under | Top bar with mark, search, lock and sign out; bottom tab bar; More sheet |
| 640px and under | Dialogs become bottom sheets; figures go to two columns; form grids to one |

Financial tables keep every column and scroll inside `.table-wrap`. The page itself must not scroll sideways.

## Motion

Short transitions (140ms) on hover and focus; dialogs, sheets and toasts enter in under 200ms. All of it is disabled by `prefers-reduced-motion`.

## Dark mode

Not implemented. Tokens make it possible later, but the status, chart and print states would each need their own contrast check.

## UI UX Pro Max

The skill's search supplied the starting point: the "Minimalism & Swiss Style" direction, dense dials, IBM Plex ("Financial Trust" pairing), the B2B slate neutrals and the teal action colour. Its top recommendation was overridden in three places: its dark default palette, because the owner asked for a light app; Fira fonts, because Plex was already loaded and also matched; and its "Enterprise Gateway" page pattern, which is for marketing sites.
