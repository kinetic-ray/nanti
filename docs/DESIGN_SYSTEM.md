# Nanti design system

## Brand and audience

Nanti helps people save products, compare their options, and decide when a purchase fits. The public app speaks to people who plan purchases on a phone and want a clear view of their choices. The tone is warm, direct, and calm.

**Tagline**  
Simpan dulu. Putuskan nanti.  
Save it now. Decide later.

## Visual language

Use a violet and mint palette anchored by a dark plum bookmark. The empty home uses an oversized bookmark composition to identify Nanti. Collections use white surfaces and light violet, leaving product photos, names and prices in the foreground. Reserve mint for the first action on the home screen, neutral result panels, and safe confirmations. Use amber and explicit wording when a saved result needs review.

| Token | Value | Use |
|---|---|---|
| Canvas | `#f8f6fc` | Public app background |
| Surface | `#ffffff` | Cards, fields, dialogs |
| Ink | `#241a3e` | Primary text |
| Muted | `#615774` | Secondary text and hints |
| Primary | `#5335aa` | Main actions and selected controls |
| Plum | `#30214e` | Nanti mark, home feature panel, notices |
| Accent surface | `#efe8fc` | Current selection and wishlist totals |
| Mint surface | `#cef5e1` | Helpful highlights |
| Divider | `#e6dff0` | Surface boundaries |
| Field border | `#897d9d` | Interactive boundaries |
| Danger | `#982440` | Destructive confirmation and errors |
| Focus | `#275db4` | Three-pixel visible focus ring |
| Spacing | `.25, .5, .75, 1, 1.5, 2, 3rem` | Rhythm and grouping |
| Radii | `.75, 1, 1.25rem` | Controls, product cards, dialogs |
| Elevation | `0 6px 24px #30214e0a` | Surface shadow |
| Motion | `150ms ease-out` | Press feedback, photo reveal, notices |

Use Plus Jakarta Sans for the public interface with Aptos and system sans-serif fallbacks. The single local Latin variable font uses `font-display: swap`, and platform fonts supply other characters. Use 16px form input text and a 1.5 body line height. Headings use 750–800 weight. Use tabular numerals for money and evaluations. Public tokens live in the `.consumer` scope in `src/consumer.css`. Shared controls provide semantic primitives and admin compatibility.

## Public components and interaction

- Put a native wishlist selector above the collection below 960px and use a side rail on wider screens. The Add Product button sits near the thumb on phones with clearance for safe areas and focused elements. The shelf changes from compact horizontal cards on phones to two columns at 650px and three at 1160px.
- Give each card a consistent 5:4 media frame, the actual product name and price, a quantity or unit price, one details action, and labeled edit and removal controls. Use verified retailer photos when the supported listing provides one. Show the first character of the saved name as a fallback. Reserve space before photos load and load them lazily.
- Use native dialogs with named headings and one inset scroll area below the heading. On phones they appear as bottom sheets with safe-area padding and stay within the visible viewport. Keep actions in the content flow. Focus the heading or first field on entry, return focus to the trigger on exit, and explicitly place focus after a step change or when opening inline confirmation.
- Use primary buttons for the next action, secondary controls for navigation and alternatives, and danger buttons inside explicit confirmation. Keep practical touch targets at least 44 CSS pixels. Preserve semantic table headers and a named, focusable horizontal scroll region for wide comparisons.
- Use skeletons for loading content, timed live notices for success, and inline live alerts with a recovery action for errors. Pair status colors with explicit text. Disable optional motion when reduced motion is requested.
- In price history, show the current unit price and source first. Keep target editing and manual updates one action away. Give charts an equivalent readable list with exact values and dates, and explain the empty state until a second price is recorded. Keep user-entered and unverified listing prices labeled wherever they appear, including alerts.

## Language and UX writing

Default to Indonesian. Offer a visible, keyboard-accessible ID/EN toggle and persist the choice on this device. Store UI translations centrally and fall back to English for a missing key. Use Indonesian `id-ID` and English `en-US` for dates and numbers. Always format money in the wishlist currency using its minor units. Accept the locale’s decimal separator in money fields. Keep brand names, product names, URLs, user-entered text, and published reference titles intact.

Use everyday Indonesian and address readers as **kamu**. Use short, practical sentences with the same approachable tone in English. Describe the action a button takes and explain what is missing. Describe uncertainty without judging the user.

## Purchase intelligence, privacy, and trust

Offer checks from a saved product or wishlist. Use a progress indicator where the tool has a defined sequence. The buying-reasons check advances one question at a time and offers an optional review date. Readiness starts with a single self-reported answer. Budget figures and wishlist selection controls sit under an optional disclosure. Priority comparisons start from the user’s own wishlists and show the reasons for the order. Keep research and scoring details one step away. Label incomplete totals, estimates, and assumptions. Keep previous decisions in a secondary disclosure with the last-checked date and a clear way to check again. Confirm current finances when revisiting a detailed budget check and preserve each saved result.

Treat financial information and assessment history as private. Explain the current browser’s access and retention. Provide a clear deletion path and protect financial details from public data boundaries. Keep commercial incentives outside calculations and explanations.

Give waiting, comparing, and closing equal legitimacy. Avoid urgency, pressure, streaks, forced decisions, hidden costs, and default opt-ins for optional products. Separate destructive actions from the primary task and confirm them clearly.

The public UI follows this document in both languages. Future admin screens may use English and a denser operational layout while retaining accessibility, privacy, and design tokens.
