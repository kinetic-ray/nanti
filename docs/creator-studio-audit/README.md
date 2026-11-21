# Nanti Creator Studio Visual UX Audit

## Executive summary

Creator’s landing page establishes a clear entry into Studio. The editorial headline, violet primary action, framed preview and distinct storefront personalities are worth retaining. The editor’s main usability problem is structural. At 1440 × 900, the desktop preview makes the editor 3,002 px tall and places Next at y=2,923. A creator can inspect the product grid or stay at the controls, but must scroll the document to move between them. The Utility preset also creates unreadable foreground and background combinations, and product details fall short of keyboard dialog behavior.

Address scroll ownership and preview fidelity first. Fix dark palette contrast and product-dialog accessibility in parallel because both can be corrected within the storefront components. Follow with a more compact editor heading, consistent action placement and clearer configuration scopes.

**Priority order.** P1 covers significant workflow or access failures. P2 covers degraded editing, preview fidelity or readability. P3 covers localized polish. No P0 issue was observed.

- **P1** A-01 desktop workflow, D-01 Utility contrast, E-01 preview fidelity, F-01 product dialog, F-02 preset overwrites.
- **P2** B-01 preview toolbar, B-02 close button layering, C-01 editor hierarchy, D-02 product composition, E-02 density feedback, F-03 mobile focus.
- **P3** F-04 localization and reorder controls.

## Evidence and scope

Chromium rendered /creator and Studio from the local working tree at 390, 768, 1024, 1280, 1440 and 1920 CSS px, each 900 px high. The capture set includes landing, Theme, expanded color controls, Layout, Product cards, Typography, Sections, Mobile preview, Desktop preview and product-grid composition at every width. Additional captures cover Utility, product details, keyboard handoff and desktop step actions. The primary matrix uses Indonesian, the default locale, and reduced motion for repeatable captures. Network-loaded sample images can finish after a screenshot. Transparent or empty media at the capture moment is therefore excluded as a finding.

[Screenshots](screenshots/) · [Viewport measurements](measurements.json) · [Interaction measurements](interaction-measurements.json)

Measured document widths matched viewport widths in the captured states. This does not rule out local clipping or intentional horizontal rails. At 390 px in Mobile preview, native wheel input advanced the frame from 0 to 160 px with document scroll held at 0. The measured Desktop preview used document scrolling. This was a scrolling ownership spot check for the audit.

GitNexus traced CreatorDesignStudio to CreatorStorefront and its scroll and locale flows. CodeGraph and route inspection confirmed that the landing page links to Studio and the standalone demo, and that both preview contexts render the same storefront component. The Studio shell and standalone document own different scroll surfaces. Preserve that distinction in implementation. Browser findings and source review used the [Nanti design system](../DESIGN_SYSTEM.md) and [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

## A. Layout architecture

### A-01 · P1 · Desktop preview controls the editor height

**Current behavior.** At 1440 px the editor is 390 × 3,002 px and the desktop preview frame is 978 × 2,839 px. Its scroll height equals its client height. The document carries the scrolling, the settings area stretches to 2,408 px, and Next is y=2,923 even on the shorter Typography step. At 1024 px, Theme’s Next is y=2,538. The lower screenshot shows the actions beside the end of the product catalog and an otherwise blank editor column. [Top of workspace](screenshots/1440-theme.png) · [Bottom of editor](screenshots/1440-step-actions.png)

**Expected and correction.** Step actions should remain near the configuration being edited, and inspecting a product should keep the settings within reach. Define a bounded desktop workspace with explicit editor and preview scroll owners. Keep step actions in the editor shell and let long settings scroll within that shell. Keep the current single-panel mobile pattern.

**Cause and risk.** The grid has a minimum height and a content-sized row. Grid stretch and the flex-growing settings area distribute the preview's height into the editor. This change depends on both shell and storefront scroll logic. Regression-test wheel and keyboard input, sticky search thresholds, tab focus reveal, anchors and modal scroll on both surfaces.

## B. Positioning and alignment

### B-01 · P2 · Preview controls sit apart from the viewport they control

**Current behavior.** At 1920 px the 390 px Mobile frame begins at x=960. The toolbar title starts around x=430 and the mode selector sits against the right workspace inset near x=1,880. The toolbar scrolls away with the document when viewing products in Desktop mode. [Wide Mobile preview](screenshots/1920-mobile-preview.png) · [Wide product inspection](screenshots/1920-products.png)

**Expected and correction.** Keep the toolbar at the edge of the preview scroll surface and group mode and effective viewport size where they are visible while comparing. Use a shared preview-stage container and alignment rules across both widths.

**Cause and risk.** The toolbar spans the workspace while the frame has its own centering and maximum width. Coordinate with A-01. Verify full-page width at 1024 px, enlarged text, focus visibility and that the toolbar leaves enough room for the storefront search.

### B-02 · P2 · Product image obscures the top close control

**Current behavior.** In the 390 px product details capture, the upper-right close button is visually missing in the photo area. The return button at the bottom remains visible. [Product details](screenshots/390-product-detail.png)

**Expected and correction.** Keep the top close control visibly above the image with its existing 44 px hit area. Define modal control and media stacking levels or put the control in a dedicated header.

**Cause and risk.** The close button and the absolutely positioned image both use z-index 1. Later sibling media can paint above the control where their boxes overlap. Fix alongside F-01 and verify hit testing with loaded photos and fallbacks.

## C. Typography and spacing

### C-01 · P2 · Introductory typography displaces editing

**Current behavior.** At 390 px the stepper starts at y=366 and settings at y=509. Only the first row of personality options is fully visible at 900 px. At 1920 px the same 390 px rail gains a two-line title and settings begin at y=525, versus y=458 at 1024 px. Typography uses recognizable font specimens, yet helper text in the 106 × 136 px desktop cards is under 10 px. [390 px Theme](screenshots/390-theme.png) · [1024 px Typography](screenshots/1024-type.png) · [1920 px Typography](screenshots/1920-type.png)

**Expected and correction.** Keep the rail’s workspace heading and intro compact and stable. Give settings labels and explanatory text readable editor sizes. Keep larger type for the storefront and font specimens, where it serves a purpose.

**Cause and risk.** The heading scales against viewport width while its rail width stays fixed. Each step also repeats an intro, progress label, numbered navigation and hint. Establish rail-relative sizing and a shared step header. Retest wrapping in Indonesian and English and at increased text size before reducing spacing.

## D. Visual composition

### D-01 · P1 · Utility palette breaks text contrast

**Current behavior.** The Utility profile description uses RGB 110/100/123 on RGB 23/27/32, approximately 3.11:1. Profile count numerals use RGB 241/242/243 on white pills, approximately 1.12:1. The active product filter uses white on RGB 241/242/243, also approximately 1.12:1. The white product dialog inherits the same light title and price, and its white-on-Utility-accent return button is approximately 2.02:1. [Utility preview](screenshots/390-utility.png) · [Filters and category text](screenshots/390-products.png) · [Utility product dialog](screenshots/390-product-detail.png)

**Expected and correction.** Maintain at least 4.5:1 for normal-size text on each supported preset, including selected controls and dialog text. Define surface and text pairs for muted content, inverse surfaces, selected controls and dialog actions. Use the same pairs in compact search and product cards. Show contrast feedback for custom accent, background and foreground combinations.

**Cause and risk.** The theme changes page foreground and accent while components retain light surfaces, fixed muted colors and white active text. Token changes affect Studio and standalone sample storefront. Test all presets, customized colors, focus indicators and image fallbacks.

### D-02 · P2 · Product cards lose comfortable reading width in the narrow desktop stage

**Current behavior.** At a 1024 px browser width, after selecting Utility and a centered hero, Desktop preview fits four columns of approximately 133 px. Titles and detail actions compete for space under large image blocks. At 390 px the filter rail clips the next chip at its edge and the result count wraps into two lines. Product categories and codes have low emphasis in Utility, compounded by D-01. [1024 px products](screenshots/1024-products.png) · [390 px products](screenshots/390-products.png)

**Expected and correction.** Derive minimum readable card width from a title, price and localized detail action. Preserve aligned price and action rows. Adapt the filter rail and count to available space, with an affordance when more chips are offscreen.

**Cause and risk.** Column count combines the preset, frame sizing and host-responsive CSS. Recipe gaps, title reserves and action padding remain substantial at small card widths. Fix after E-01 establishes a viewport model. Check variable title length, hidden prices and categories, image ratios and keyboard access to clipped filter options.

## E. Responsive behavior

### E-01 · P1 · Desktop mode follows the host browser width

**Current behavior.** With the same selected design and Desktop pressed, frame widths measure 350, 728, 583, 826, 978 and 1,100 px as the host grows through the six tested sizes. At 390 px, Desktop still renders a two-column storefront, while at 768 px it renders four columns and gives more canvas width than at 1024 px. At 390 px, moving from Mobile to Desktop also switches from a 650 px nested scroll frame to a 3,041 px document-flow frame. [390 px Desktop](screenshots/390-desktop-preview.png) · [768 px Desktop](screenshots/768-desktop-preview.png) · [1024 px Desktop](screenshots/1024-desktop-preview.png)

**Expected and correction.** Make Desktop and Mobile represent an explicit effective viewport. Separate stage fit from storefront layout. Use width-aware storefront rules inside the frame and show the effective width or fit state in the toolbar. If the full desktop canvas cannot be represented at a small host width, explain the fit behavior visibly.

**Cause and risk.** The mode toggle switches CSS classes on the same document. The desktop frame fills available width up to its cap, and storefront viewport queries still see the host browser. Coordinate with A-01 before changing rendering boundaries. Test both scopes for scroll anchoring and search, product links, focus, locale and CTA responsiveness.

### E-02 · P2 · Mobile density selection can appear to have no effect

**Current behavior.** Selecting the four-column density stores `--sf-columns: 4`. In the 390 px Mobile preview the computed grid is still `150px 150px`. The configuration presents density as an immediately visible result, with no scope hint. [Density settings](screenshots/390-layout.png) · [Mobile preview after density selection](screenshots/390-dense-mobile.png)

**Expected and correction.** Preserve the legible two-column mobile cap. Label density as a desktop setting and surface the current mobile cap near the control or viewport toggle.

**Cause and risk.** The Mobile frame has a two-column override while the same state feeds the desktop grid. Keep serialized draft and export semantics intact. Verify all three density options against both preview modes.

## F. Interaction and usability

### F-01 · P1 · Product details leave keyboard focus behind

**Current behavior.** Clicking Lihat produk opens an element with dialog semantics. The launching button stays focused behind the overlay. Pressing Escape leaves one dialog on the page. [Dialog overlay](screenshots/390-product-detail.png) · [Focus and Escape measurements](interaction-measurements.json)

**Expected and correction.** Move focus into the dialog on entry, contain tab navigation, dismiss on Escape and return focus to the initiating card. Use an accessible dialog primitive and a labeled close button.

**Cause and risk.** The dialog is rendered conditionally as a fixed backdrop and ARIA section with click dismissal. It has no focus handoff or native Escape behavior. Verify F-01 and B-02 together, including click outside, keyboard-only operation, preview scrolling after close and standalone behavior.

### F-02 · P1 · Palette selection silently replaces unrelated settings

**Current behavior.** Theme labels its second group as a base palette. Switching Editorial to Utility also changed the measured hero from split to compact, card style from minimal to bordered and radius from 18 to 3 px. Preset source also carries font, density, image ratio and visibility flags. Personality and section order are retained by the selection handler. [Palette control](screenshots/390-colors.png) · [Resulting Utility preview](screenshots/390-utility.png) · [Before and after state](interaction-measurements.json)

**Expected and correction.** Make the palette control update color roles only, or relabel the action as a full design preset and make the effects explicit. Keep previously edited values unless the user explicitly chooses to replace them.

**Cause and risk.** The preset handler replaces the whole design with the preset object and then restores two fields. Align theme state, draft migration and export semantics. Verify changes after editing font, layout, imagery, product visibility and custom colors.

### F-03 · P2 · Mobile View result loses focus when it hides the editor

**Current behavior.** Activating the last step’s Lihat hasil with Enter hides the editor. The measured active element becomes body, the document moves 61 px and the next Tab lands on Desktop. There is no focused preview heading or announcement of the handoff. [Keyboard result](screenshots/390-keyboard-result.png) · [Focus trace](interaction-measurements.json)

**Expected and correction.** Transfer focus to the newly visible preview heading or named region after the state commits. Keep enough context visible to return to editing and preserve the preview’s scroll position when switching panels.

**Cause and risk.** The action hides the focused editor and calls scrollIntoView in the same handler, without a destination focus target. Coordinate with A-01 and honor reduced motion. Retest direct preview toggle, last-step action, back to Edit and wheel input once focus lands.

### F-04 · P3 · Localized controls and reorder targets are inconsistent

**Current behavior.** In Indonesian the stepper says Huruf, while the panel title is Typography. Product settings retain Card style and Image ratio, and Sections uses Urutan section plus English accessible move labels. Each move button measures 32 × 44 px. The selected step is visually distinct and the endpoint buttons already expose disabled state. [Product settings](screenshots/390-cards.png) · [Typography](screenshots/390-type.png) · [Sections](screenshots/390-sections.png)

**Expected and correction.** Share a localized step vocabulary across progression, headings, controls and accessible names. Give reorder actions a full 44 × 44 px target and retain their position-specific names and disabled states.

**Cause and risk.** Locale strings and sizing are authored per control. Longer localized names must fit the fixed rail, and enlarged hit targets must leave room for section names. Verify all four list rows with keyboard and touch.

## Design-system corrections

| System rule | Proposed correction | Acceptance check |
| --- | --- | --- |
| Workspace shell | Define editor rail, bounded stage, toolbar, editor actions and scroll ownership in one shell recipe. | At each desktop width, changing steps or preview content does not displace editor actions. |
| Preview sizing | Define viewport width separately from stage width, with an explicit fit rule and density scope. | The same mode renders the same declared layout across host widths that can show it. |
| Theme semantics | Pair each surface with default, muted, selected and action foreground colors. Keep aesthetic presets, palette edits and custom overrides distinct. | Utility’s profile, pills, filters and modal pass contrast checks. Editing a palette preserves unrelated choices. |
| Editor density | Use rail-relative heading and text sizes, a shared step header and compact grouped controls. | At 390 px the editor exposes useful choices in the first viewport. Both locales and larger text remain readable. |
| Overlays | Standardize keyboard focus, dismissal, return focus and controls above media. | Enter, Tab, Shift+Tab, Escape, pointer close and post-close wheel behavior all work in Studio and the standalone demo. |

## Implementation roadmap

1. **Phase 1 · Structural layout corrections.** Implement A-01 and E-01 together. Confirm the actual editor and preview scroll owners before adding sticky elements. Establish an acceptance matrix across the six widths with the existing wheel regression as a gate.
2. **Phase 2 · Component positioning and alignment.** Align the toolbar and frame under B-01. Ship B-02 with the F-01 dialog behavior, which can proceed independently of the shell. Verify overlays paint above media and pointer hits match what is visible.
3. **Phase 3 · Typography and visual composition.** Introduce semantic color pairs and close D-01. Refine rail typography and card sizing under C-01 and D-02. Apply compact editor styling while retaining the violet palette, editorial headline style and distinct storefront personalities.
4. **Phase 4 · Responsive and interaction polish.** Clarify density, preserve palette edit scope, handle the mobile focus handoff and align localized controls under E-02 and F-02 through F-04. Verify draft round trips and export after changes to preset semantics.

## Regression risks and release checks

- Scroll changes can reopen wheel snap-back at the compact search threshold. Check monotonic native wheel input in both directions, keyboard scroll, focus, product rail input, mode switches and independent editor and preview positions. Keep the standalone document anchoring rule in scope for the standalone storefront.
- Height constraints can hide focused controls on short viewports or at increased text size. Verify keyboard focus through all five steps, custom colors, modal open and close, and the final result transition.
- A separate viewport sizing model can affect CSS-dependent personality layouts, section order and angle of product image crops. Compare Editorial, Utility and Gallery in both modes using the same design state.
- Preset and theme changes can alter saved drafts, exported JSON and the demo. Validate retention of manually changed values and ensure the public storefront renders the same selected settings.
- This audit sampled Chromium, one viewport height and the default Indonesian interface. The screenshots include remote photo loading at different points. Physical touch devices, other engines, screen readers and the complete English workflow require follow-up verification before shipping changes.
