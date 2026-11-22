# Tokopedia import reliability audit

Verified on 23 November 2026 in the local `kinetic-ray/nanti` checkout. Live requests used the production import transport with its ordinary Nanti identification, timeouts, DNS pinning, and manual redirect policy. The persistence probe used disposable MySQL 8.4.

## Root causes and before/after results

| Reproduction | Before | After |
| --- | --- | --- |
| JSON-LD Product links to an image, offer, and seller by local `@id` | Title only | Title, Rp199,000, allowed product image, and Lamp Shop |
| An exact WebPage embeds a Product as `mainEntity` without a redundant Product URL | Product identity depended on another metadata source | The exact WebPage URL anchors the embedded Product |
| A malformed sibling query key appears beside the correct normalized PDP cache entry | The entire cache was skipped, losing the Rp1,735,000 price and seller | The exact listing still returns the price and Lenovo Authorized Surabaya |
| HTTP 403, 429, or a short-link 404/410 | `http_failure` | `access_blocked`, `rate_limited`, or `short_link_unavailable` |
| HTTP 200 CAPTCHA, invalid JSON-LD, or ordinary HTML with no product metadata | `metadata_missing` | `captcha_required`, `metadata_malformed`, or `metadata_missing` |
| Connection failure | `request_error` | `request_error`. The client receives no underlying connection details. |

The parser had collected inline Product and Offer objects but treated local graph references as incomplete objects. It now resolves fragment references within the same listing and JSON-LD graph. Duplicate and foreign references are ignored. The existing exact-price rules still withhold variant ranges and conflicting amounts.

The resolver still follows only allowed HTTPS redirects and binds the first product destination to its listing identity. Short links are preserved as entered on saved products. A HTTP 200 short-link interstitial without an HTTP redirect falls back to manual entry. The resolver never executes page scripts or submits challenge forms.

## Live verification

| Original URL | Resolved URL and HTTP evidence | Metadata | Image and persistence |
| --- | --- | --- | --- |
| [Direct Lenovo listing](https://www.tokopedia.com/lenovo-authorized-surabaya/charger-innergie-by-delta-180w-gaming-adaptor-laptop-universal-t18) | Same URL, HTTP 200 without redirects, before and after | Charger INNERGIE BY DELTA 180W Gaming Adaptor Laptop Universal T18, Rp1,735,000, Lenovo Authorized Surabaya, primary image on the Tokopedia CDN | CDN HTTP 200, JPEG 57,921 bytes. The Save API returned `photoStatus: saved`. MySQL stored a 48,600-byte JPEG and the authorized image endpoint returned the same byte count with HTTP 200. The disposable wishlist was removed after the check. |
| [Tokopedia tk short link](https://tk.tokopedia.com/ZSp76BWQL/) | HTTP 302 to the [ByFrags listing](https://www.tokopedia.com/byfrags/byfrags-travel-size-5ml-decant-best-for-explore-1738205440494437853), then HTTP 200 | ByFrags Travel Size 5ml, ByFrags, and a primary CDN image. Exact price was withheld for the variant listing. | Downloaded 40,347 bytes and compressed to a 36,718-byte JPEG. This sample exercised download and compression. Short-link persistence was verified with a fixture. |
| [First tokopedia.link sample](https://tokopedia.link/QLKrMW8G3Ib) | HTTP 404 without a redirect, before and after. No resolved URL. | `http_failure` before, `short_link_unavailable` after. No metadata. | No image request or persistence. |
| [Second tokopedia.link sample](https://tokopedia.link/X2diWTjPvOb) | HTTP 404 without a redirect. No resolved URL. | `short_link_unavailable`. No metadata. | No image request or persistence. |

The HTTP 404 responses establish unavailability from this environment. Their underlying cause is unknown. Live requests exercised one working short-link host and one direct listing. CAPTCHA, rate limiting, unsafe redirects, oversized responses, and missing or malformed metadata were exercised with fixtures. Signed CDN URLs, response bodies, credentials, and product image files were excluded from the audit.

## Changes and verification

- [server/tokopedia-metadata.ts](../server/tokopedia-metadata.ts) updates `extractTokopediaMetadata`, `readHtml`, `parseMetadata`, and `parsePdpCache`, and adds local graph reference resolution and HTTP failure classification.
- [src/forms.tsx](../src/forms.tsx) displays the new diagnostics in Indonesian and English through the existing manual-entry flow.
- [tests/tokopedia-metadata.test.ts](../tests/tokopedia-metadata.test.ts), [tests/tokopedia-import.test.ts](../tests/tokopedia-import.test.ts), and [tests/mysql-product-images.test.ts](../tests/mysql-product-images.test.ts) cover graph data, conflicting identities, short links, diagnostic mapping, and a saved photo loaded from a fresh runtime. The image and wishlist suites also cover download failures and manual photo priority.

TypeScript, the production build, and all 249 tests across 31 files passed. The browser fixture loaded saved photos after refresh and a restart into the normal API process. GitNexus impact rated the Tokopedia parser and resolver high risk. Its full working-tree change analysis rated the combined changes critical and includes existing account and UI changes. The local GitNexus index reported limits on execution-flow coverage.

The existing image downloader, JPEG compression, MySQL persistence, `imageKey` contract, and private image endpoint are reused. Changes to the parser affect Tokopedia. Shopee retains its existing behavior and diagnostic contract. Marketplace markup and access restrictions may still change, and the image byte limit can cause text-only saves. The review should include the GitNexus high-risk parser and resolver callers and isolate this patch from unrelated working-tree changes before a merge.

## Final integration review

- Flattened JSON-LD arrays now resolve image, offer, and seller references within the same script. Duplicate IDs remain ambiguous, and references never trigger network requests.
- An ordinary product heading that resembles a challenge does not suppress exact structured metadata. Explicit challenge headers, forms, and page titles still trigger manual entry.
- A matching `ProductGroup`, a linked variant, or an offer URL with a different query prevents an exact listing price. Missing variant signals remain a limitation, so imported prices still require user review. [Schema.org ProductGroup](https://schema.org/ProductGroup)
- The pinned HTTPS transport validates every returned IPv4 address and connects to a validated address while preserving the retailer hostname for TLS and HTTP. The resolver revalidates every redirect and preserves listing identity. The image downloader enforces separate host and byte limits and rejects redirects. [Node.js HTTPS API](https://nodejs.org/api/https.html)
- The image attachment and initial price write share the product transaction. The read endpoint checks wishlist ownership and binds the BLOB to the item. Images above the input limit and pages with unsupported markup can still fall back to manual entry. Production egress policy and legacy bucket behavior require separate environment verification.
