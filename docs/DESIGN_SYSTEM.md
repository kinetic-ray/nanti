# Nanti design system

## Brand and audience

Nanti helps people save products, compare their options, and decide when a purchase fits. The public app speaks to people who plan purchases on a phone and want a clear view of their choices. The tone is warm, direct, and calm.

**Tagline**  
Simpan dulu. Putuskan nanti.  
Save it now. Decide later.

## Visual language

Use a soft lavender canvas, white product cards, an indigo action color, and mint highlights. Use a modern system sans-serif stack with Aptos, Segoe UI, and platform sans-serif fallbacks. Product badges use the first character of the product name as a quiet visual identifier. A product link or photograph must describe the actual saved product.

| Token | Value | Use |
|---|---|---|
| Canvas | `#f6f5fc` | App background |
| Surface | `#ffffff` | Cards, fields, dialogs |
| Ink | `#211b37` | Primary text |
| Muted | `#5b536e` | Secondary text and hints |
| Primary | `#4834b9` | Main actions and selected controls |
| Accent surface | `#eee9ff` | Current selection and wishlist totals |
| Mint surface | `#dff6eb` | Helpful highlights |
| Divider | `#ded9ed` | Surface boundaries |
| Field border | `#958ba9` | Interactive boundaries |
| Danger | `#a12945` | Destructive confirmation and errors |
| Focus | `#2859a7` | Three-pixel visible focus ring |
| Spacing | `.25, .5, .75, 1, 1.5, 2, 3rem` | Rhythm and grouping |
| Radii | `.625, .875, 1.25, 1.75rem` | Fields, cards, and dialogs |
| Elevation | `0 8px 24px #30234e0d` | Surface shadow |
| Motion | `140ms ease-out` | Color and border feedback |

Use a 16px body size with 1.5 line height. Use semibold sans-serif headings and tabular numerals for money and comparisons. Keep form and result copy at a comfortable reading measure.

## Public components and interaction

- Put the wishlist switcher above the active collection on phones and to its left on wide screens. Keep **Tambah produk** easy to reach and show purchase tools in their product or wishlist context.
- Use a compact product card with the product name, price, quantity, and real controls. Empty states should explain how to add the first product or recover a missing selection.
- Use native dialogs with named headings. Focus the heading or the first field on entry, return focus to the trigger on exit, and explicitly place focus when replacing a section or opening inline confirmation.
- Use labeled fields with a nearby optional hint or error. Keep touch targets at least 44 CSS pixels. Preserve semantic table headers, use a focusable horizontal scroll region for wide comparisons, and keep essential content available at narrow widths.
- Verify text contrast at WCAG AA. Use visible focus, accessible names, and live status messages. Pair color with explicit text for statuses. Disable optional animation and transitions when reduced motion is requested.

## Language and UX writing

Default to Indonesian. Offer a visible, keyboard-accessible ID/EN toggle and persist the choice on this device. Store UI translations centrally and fall back to English for a missing key. Use Indonesian `id-ID` and English `en-US` for dates and numbers. Always format money in the wishlist currency using its minor units. Accept the locale’s decimal separator in money fields. Keep brand names, product names, URLs, user-entered text, and published reference titles intact.

Use everyday Indonesian and address readers as **kamu**. Use short, practical sentences with the same approachable tone in English. Describe the action a button takes and explain what is missing. Describe uncertainty without judging the user.

## Purchase intelligence, privacy, and trust

Offer assessments after saving. Show the recommendation and why it follows from the chosen inputs. Keep methodology, research, and algorithm versions one step away. Label incomplete quotes, estimates, and assumptions. Show relevant previous and current inputs during review, require current financial confirmation, and preserve each saved result.

Treat financial information and assessment history as private. Explain the current browser’s access and retention. Provide a clear deletion path and protect financial details from public data boundaries. Keep commercial incentives outside calculations and explanations.

Give waiting, comparing, and closing equal legitimacy. Avoid urgency, pressure, streaks, forced decisions, hidden costs, and default opt-ins for optional products. Separate destructive actions from the primary task and confirm them clearly.

The public UI follows this document in both languages. Future admin screens may use English and a denser operational layout while retaining accessibility, privacy, and design tokens.
