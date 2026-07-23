# Sendoff design system

**Product world:** the animator's desk. Light tables, the transparency checkerboard behind
every sprite, kraft envelopes and packing slips, the courier run from desk to client.

**Feel:** Swiss, dark, solid. Less but better: black field, white type, one orange. Hairline
rules divide sections; no tints, no shadows, no ornament.

## Tokens (duplicated in `tablet/styles.css` and `laptop/src/renderer/src/styles.css` — keep in sync)

| Token | Value | Meaning |
|---|---|---|
| `--desk` | `#0a0a0a` | canvas background (near-black) |
| `--board` | `#141414` | raised panels/cards |
| `--tray` | `#1a1a1a` | overlays, sheets |
| `--well` | `#000000` | inputs — true black, inset below their surface |
| `--hover` | `rgba(255,255,255,.07)` | hover/press tint |
| `--checker-a/-b` | `#131313` / `#1a1a1a` | transparency checkerboard, barely there |
| `--ink / -dim / -faint / -ghost` | `#ffffff` … `#5c5c5c` | 4-level neutral hierarchy |
| `--edge / -soft / -strong` | `rgba(255,255,255, .14/.08/.26)` | border progression, always rgba |
| `--accent` | `#ff6a00` | THE accent; primary actions, focus, links, success |
| `--accent-ink` | `#000000` | text on an orange fill (7.3:1) |
| `--stamp` | = accent | success is the accent, not a third hue |
| `--warn` / `--alarm` | `#ffffff` / `#ff5a4d` | warnings are white text + orange rule; red only for failures |

**Contrast:** white 19.8:1, `--ink-dim` 9.6:1, `--ink-faint` 5.9:1, accent 6.9:1, and
black-on-accent 7.3:1 — all on `--desk`. `--ink-ghost` (3:1) is for disabled marks only,
never prose. Check any new colour before adding it.

## Rules

- **Depth = borders only** (low-opacity rgba). No shadows anywhere. Elevation via surface
  lightness (desk → board → tray).
- **Spacing base 4px**; common steps 8/12/16/24. Radius 2px everywhere — near-square, Swiss.
- **Type:** Helvetica and nothing else (Arial on Windows; no bundled font files, no second
  family for filenames). Hierarchy comes from size, weight, and colour alone. Headings are
  heavy and tight (-0.02em); section headers are "drawer labels": 11px/700, letter-spacing
  0.14–0.18em, uppercase, `--ink-faint`, with a hairline rule beneath.
- **Signature elements:** hairline rules under every section head; checkerboard behind an
  asset preview *only when an asset is there*; drawer labels (LIGHT TABLE / PACKING SLIP /
  SEALED); orange reserved for the primary action, focus, links, and success;
  `image-rendering: pixelated` on sprites.
- **Layout:** no sidebars, no dashboard furniture. Laptop = one workbench, two zones with a
  single seam (`--edge-soft` border). Tablet = one column, primary button at thumb reach,
  56px+ touch targets.
- Inputs sit on `--well` (true black) with an `--edge` border; focus = accent border + 3px
  tint ring.
- **No tinted boxes.** Warnings and errors are plain text with a 2px coloured rule down the
  left: orange for warnings, red for failures. Never toasts or modals.
- Success = a hairline circle with an orange check. No fills, no rotation.
- History = cards with a sprite thumbnail, not a text list.
