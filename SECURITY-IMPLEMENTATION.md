# 2026-10-31 security changes

## Production authorization safeguards

- File-ticket creation is limited per account to 30 per sliding minute and 240 per sliding hour. Existing tickets continue to serve normal page navigation. This is an abuse limit, separate from each account's daily download entitlement.
- `checkTicketRate` rejects saturated accounts before requesting Google Drive. `storeLimitedTicket` repeats the check in a conditional SQLite insert; concurrent requests cannot exceed the ceiling. The associated trace event is inserted only for an admitted ticket. Migration 0006 adds the `(email, created_at)` index; no existing user policy or PDF index is rewritten.
- Full-download/fast-read requests preflight their existing daily quota before Drive access. The original atomic download reservation remains at delivery time to prevent concurrent overspending. Repeated retrieval of an already-counted asset retains the existing behavior.
- Google ID tokens explicitly allow RS256 only; issuer, audience, nonce, verified email and existing subject binding remain enforced.
- Regression coverage includes anonymous/stolen/expired/revoked tickets, answer actions, blocked users, management endpoints, CORS/CSRF and attempts that must not reach Drive.

Limits reduce ticket-write amplification; they do not guarantee that D1 cannot be exhausted. Page-event writes, aggregate account activity and database reads still require monitoring. An account-specific rate limit is not a complete scraping defense.

## Opt-in server page watermark prototype

`preparePdf(source, expected, {PDFLib, SparkMD5, pageWatermark:true})` adds an uncompressed, fixed-width barcode form and trace slots while the administrator prepares a test page. The default remains `false`; the management worker is unchanged and does not opt in. No production PDFs or indexes are rebuilt by this release.

The backend replaces validated slots before returning the page, without running a PDF parser. New entries receive `X-PDF-Watermark: server-page-v2`; the updated viewer avoids painting a duplicate barcode. Legacy entries retain their existing front-end watermark behavior. Individualized outputs do not mutate shared templates.

Run `node --test test/page-watermark.test.mjs` for rotated-page, independent-reader, malformed-slot, search-text and legacy-format tests. `scripts/verify-page-watermark.mjs` is an explicit local verification helper that expects the synthetic sample in `work/security-implementation-2026-10-31`; it does not contact production.

This prototype embeds a visible mark in page content. It still preserves extractable source text/images and does not solve raw-object extraction, cropping, screenshots or malicious watermark removal. It must not be described as unbreakable or as a complete fix for the interrupted-download experiment. Worker production CPU/memory under load remains unverified. The five-page visual sample is not a universal compatibility certificate.

## Index and quality-enhancement boundary

Do not start full-library synchronization while Antigravity is modifying the source PDFs. Existing classification, question/answer links, user entitlements and entry URLs remain in place. Once content is stable, prepare indexes that match the actual source size/checksum; a filename alone cannot validate internal PDF byte offsets. New page-prototype indexes require a separate, explicitly reviewed rollout.

## Review of research assumptions

There is no SOL6.1 IdP/PDP in this repository. OPA, Keycloak, Wazuh and commercial DLP were not introduced. Existing server-side session checks were retained. Rebuilding PDF object IDs alone does not establish confidentiality, and Unicode normalization does not universally remove zero-width characters. See RFC 9700 (https://www.rfc-editor.org/rfc/rfc9700.html), UAX 15 (https://unicode.org/reports/tr15/), and Cloudflare DLP scope (https://developers.cloudflare.com/cloudflare-one/data-loss-prevention/).

## Rollback

Keep a deployment-version record before rollout. Revert the Worker to that version if the new ticket limiter rejects legitimate usage unexpectedly. Migration 0006 only adds a query index and can remain during rollback. Do not restore the entire D1 database or roll back user settings, source PDF revisions or unrelated reading indexes as part of a code rollback.
