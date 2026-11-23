# Creator Visual Personality — implementation contract

## Goal
A first-time creator can make a good-looking storefront without knowing design terminology or completing five configuration screens. Keep existing five-step advanced editor intact.

## Experience
- Default to **Easy setup**: choose a visual layout by outcome-oriented Indonesian labels, choose color, preview, and apply. Advanced controls are optional.
- Layout choices: simple (Simpel & Rapi), bold (Berani & Beda), elegant (Elegan & Berkelas), dynamic (Seru & Dinamis), magazine (Penuh Cerita), playful (Ceria & Santai).
- Show four initial choices and an accessible "Lihat gaya lainnya" expansion. Each card includes a faithful storefront miniature and a one-line benefit. Selection is keyboard-accessible and visibly selected.
- Use plain Indonesian labels throughout, with English parity. No "brutalist", "grid", "typography", or "hero" in user-facing copy.
- Preview updates immediately, with mobile/desktop toggles, clear Apply/Customize/Undo actions. Never silently discard edits.
- Preserve current theme colors and separate colorPreset from layoutPreset; advanced overrides take precedence and remain editable. Changing a preset must offer a choice to preserve customizations or reset them.
- Keep existing saved drafts compatible via validateDesign, with versioned migration and safe fallbacks.
- Apply presets across storefront hero, headings, product cards, grid, section spacing, buttons, and footer. Make styles structurally distinct, not merely recolors.
- Persist only when user saves/applies; show a truthful local-vs-published status. Avoid claiming published when only localStorage is updated.
- Mobile-first, touch targets >=44px, accessible contrast, visible focus, reduced-motion support, no horizontal overflow, responsive previews.

## Implementation checklist
- [x] Extend the shared design model with `layoutPreset`, typed recipes, version-2 migration and validation.
- [x] Add easy and advanced Studio paths, localized copy, CSS thumbnails, responsive preview, preset confirmation and undo.
- [x] Apply six structurally distinct compositions to the storefront while keeping advanced controls authoritative.
- [x] Add automated coverage for all 18 layout and color combinations at 360px and 1440px, legacy drafts, reset, undo, save, locale switching and accessibility.
- [x] Run typecheck, unit tests and production build.

The standalone browser matrix is `npm run test:browser:creator-design`; it uses a mocked save endpoint and does not require a database. In the implementation environment, Chromium could not start because the container denied its process socket, so the browser matrix could not be executed here. The full database-backed Creator flow remains `npm run test:browser:creator` and requires a migrated local test database.

## Acceptance criteria
A novice can choose, preview and save a visual style without entering advanced editor. Each of six layout styles visibly changes composition, typography and card positioning while maintaining legibility. Existing drafts still load. Advanced customization remains available. No false claims of server publication.
