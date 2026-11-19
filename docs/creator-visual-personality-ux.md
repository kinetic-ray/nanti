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
- [ ] Extend src/creator-design.ts with layoutPreset, typed recipes, migration and validation.
- [ ] Update src/creator-studio.tsx and CSS for easy/advanced paths, localized card copy, thumbnails, preview and confirmation flow.
- [ ] Update src/creator-storefront.tsx and CSS for per-layout composition and responsive behavior.
- [ ] Test each layout x color combination on 360px and desktop, including persisted legacy drafts, reset, undo, and EN/ID switching.
- [ ] Run typecheck, lint, build and verify no existing creator behavior regresses.

## Acceptance criteria
A novice can choose, preview and save a visual style without entering advanced editor. Each of six layout styles visibly changes composition, typography and card positioning while maintaining legibility. Existing drafts still load. Advanced customization remains available. No false claims of server publication.
