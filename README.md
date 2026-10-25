# Bibliotheca

Bibliotheca uses GitHub Pages for its public interface, Cloudflare Workers and D1 for authentication, permissions and audit records, and the owner's Google Drive for PDFs. No PDF content, user records, OAuth secrets or database exports are published in this repository.

- Website: https://yao98r.github.io/bibliotheca/
- Backend: https://bibliotheca-backend.bibliotheca-cloudflare.workers.dev
- Drive connection and sync: https://bibliotheca-backend.bibliotheca-cloudflare.workers.dev/manage.html

## Build and deploy

Use Node.js 22 or newer. Run `npm ci`, then `npm test`.

`node scripts/build.mjs --github` creates `dist-pages`, which contains only the six public pages and PDF.js assets. Publish the contents of this directory to the `gh-pages` branch; repository Pages uses that branch's root. Source updates on main require rebuilding and publishing the static branch. The root HTML files are preserved source templates; the build replaces the legacy backend, login flow and asset paths.

`npm run deploy` builds the same-origin frontend in `dist` and deploys the Worker using `wrangler.jsonc`. This requires Cloudflare access to the configured account. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a random 32-byte base64url `TOKEN_ENCRYPTION_KEY` using Cloudflare Secrets. Never commit these values. Run D1 migrations before deploying a new database.

Google OAuth redirects only to the backend's `/auth/callback`. The Worker permits login return URLs only at its own root and the exact configured `FRONTEND_URL`; cross-origin APIs allow only the configured GitHub origin. Auth codes are single-use and bound to the initiating browser through a cookie and PKCE.

## Library and access management

Sign in as the configured owner on the backend, open `manage.html`, connect Google Drive with read-only access, and run the resumable catalog sync. Files are fetched only from the two configured library roots. The sync does not migrate the former site's user list or history. Recovered books use the exact source IDs and question/answer relationships in `src/restored-catalog.mjs`; unknown PDFs use metadata inferred from file names.

The recovered catalog retains all 449 entries from Tianyan v22 (289 mock exams and 160 reference books). Original stable book IDs resolve to their registered source files inside the controlled library. Copies use explicit replacement IDs; similar names are never paired automatically. The owner-only catalog restoration button repairs unambiguous category assignments. Separate answer buttons appear only when the answer source has a complete matching PDF index. The source list grants no additional account, category, file or download permissions.

The same sync button automatically builds indexes for new or changed PDFs. Keep the management page open until it reports completion: an isolated browser Web Worker downloads the source through an owner-only endpoint, verifies its size and MD5, and builds each page with PDF-LIB. Source PDFs and Google credentials are never exposed to ordinary readers. The browser sends bounded, compressed page indexes back to D1; each page advances a persistent cursor atomically. Closing or pausing the page is safe; a later sync resumes completed page uploads (the source PDF is downloaded again). A header is published only after every page is present and Drive metadata has been rechecked. Identical content can reuse an existing index, and same-ID file replacements select only checksum-matched indexes.

Automatic indexing supports unencrypted PDFs up to 256 MiB, at most 10,000 pages, and bounded per-page complexity. Errors are shown per file without granting broader reader access; split or recompress oversized files and sync again. Cloudflare's existing D1 daily allowance still applies; after a quota reset the same sync resumes. This runs in the administrator's open browser and does not require a local Python installation, a continuously running computer agent, or a separate paid processing service. Apply migration `0003.sql` before deploying this feature.

The website's owner-only user-management panel adds named Google accounts and sets category scope, viewing, download allowance and daily limits. Keep global access disabled for an allowlist-only library. Changes are checked on every protected request; blocking an account also revokes its sessions. Only the owner can inspect operation records and PDF trace identifiers.

The catalog groups recovered question and answer files into their original book entry and preserves folder-based volumes. PDFs outside those exact mappings remain separate entries. Each action carries the actual parent book ID and selected question or answer asset ID, so category and folder authorization still apply. The connection page reports PDF and index coverage separately. Full-file responses include the expected byte count; the frontend refuses incomplete transfers instead of saving a truncated PDF.

`scripts/import-indexes.py` converts existing concatenated gzip PDF indexes to bounded SQL batches for `pdf_headers` and `pdf_pages`. Generated imports and source PDFs must remain outside the repository. Viewing retrieves only indexed page ranges. Full-file access requires download permission and uses the daily quota. Trace identifiers support attribution but do not prevent screenshots or redistribution.

For a PDF without an existing index, install `pypdf==6.1.3` in an isolated Python environment and run `python scripts/build-pdf-index.py SOURCE.pdf DRIVE_ID OUTPUT.json.gz`. The builder validates page reconstruction and the full-document trace trailer without modifying the source. Import the resulting gzip file with `scripts/import-indexes.py`. Files copied within Drive may reuse an imported index only when their size and MD5 checksum both match; access is still checked against the requested file and its current library location.

Browser-facing OAuth failures render a Chinese explanation with a link back to the GitHub website. API failures retain structured JSON for the application. An account denied by the allowlist is not automatically granted access when it signs in.

If Google OAuth publishing status is Testing, add the owner as a test user. Drive refresh tokens issued in Testing expire after seven days, requiring reauthorization. Production publishing and any applicable Google verification are separate from site permissions.

PDF.js is distributed under the Apache License 2.0; see PDFJS-LICENSE.

## TSEA interface and trace update (2026-10-23)

The homepage retains the original `Bibliotheca` name, `LIBRI · STUDIUM` subtitle and Ω emblem. Its collapsible update log records released changes; the mock-exam code guide preserves the original Tianyan series mappings and explicitly limits its year ranges to the recovered catalog.

New ordinary accounts explicitly start at rank E (求諭者). Inherited-policy accounts also default to E internally; existing individually configured ranks and the owner's authority are preserved. Rank labels do not grant view, download, category or administration permissions.

The viewer and website download use a light gray, 1.3-point-wide barcode just inside the existing page edge, with positions that vary by page. Page dimensions, crop boxes, rotations and original text placement are preserved; the mark has no visible alphanumeric label. Prepared full-file responses are personalized by the backend. The download page saves these responses unchanged and does not load a client PDF library. During rollout it remains compatible with the previous backend; protected single-page reading still adds its visual mark in the reader. The source Drive file is unchanged. PDF markers can be removed by editing the document; this is an audit aid, not DRM or proof of redistribution. The deliberately small mark is not guaranteed to survive screenshots, printing, cropping or image compression. Auxiliary zero-width metadata does not promise that copied text or OCR will retain it.

## Full-document backend watermarks

The owner-only preparation worker parses each source PDF once and creates a bounded composition template. It serializes a new PDF catalog, page objects, resources, content overlays and cross-reference table, while identifying reusable binary streams in the private Drive source. A common Form XObject holds a fixed-width barcode slot. Every page and the document Info dictionary contain the opaque authorization code; the document also receives a source-bound HMAC signature using a key derived through HKDF from the existing encryption secret. Names, email addresses and secrets are not written into the watermark.

At download time the Cloudflare Worker reads one small template row, personalizes fixed-width slots, and streams the selected binary ranges from one sequential Drive response into the new PDF structure. It neither parses the entire PDF nor buffers the full source. It does not append a removable incremental trailer to a clean original PDF. `/file` and `/api/fast-file` use the same composition path, authorization checks and daily download quota. A source-length failure withholds the final cross-reference/EOF bytes and aborts the response. The client checks the expected output size. The previous experimental 8 MiB / 64-page composition limit is removed; the existing 256 MiB source, 10,000-page and bounded-template preparation limits remain.

Preparation stores one compressed row per distinct source size/checksum in `pdf_watermarks`, with an atomic 100 MiB application budget for template data. It does not rewrite existing `pdf_pages`. Completed files and identical copies are reused; pause/resume is safe. Hitting the application budget returns an actionable error and does not upgrade a plan. Source parsing and template upload endpoints require the existing owner session and CSRF protection. Templates, source PDFs, personal records and credentials remain outside this public repository.

Roll out in this order:

1. Apply migrations through `0005.sql` to the existing D1 database. No new Cloudflare service or billing plan is required.
2. For the initial migration only, deploy the new backend with `PDF_WATERMARK_ROLLOUT=prepare`. This retains the previous full-file behavior only for files still awaiting preparation. Do not describe this temporary mode as complete backend protection.
3. Sign in as the owner on `/manage.html` and run **準備整本 PDF 保護**. Keep the page open. This reads existing PDFs once and uploads only composition templates. Review per-file failures and the `watermarked` count from `/api/drive/status`. New catalog/index sync also prepares missing full-file templates.
4. Verify representative prepared downloads, including a large scanned PDF and rotated pages, and inspect actual Cloudflare CPU/error metrics. Local tests and local workerd do not verify the Free plan's production CPU budget.
5. After all eligible files are prepared, remove `PDF_WATERMARK_ROLLOUT=prepare` and deploy. The default is strict: an absent/stale template returns 409 for full-file access and leaves existing protected single-page reading available. `/api/health` must report `watermarkVersion: 2` and `watermarkMode: required`. Confirm `/file` and `/api/fast-file` return `X-PDF-Watermark: server-v2` with the actual composed byte count. Publish the rebuilt public frontend to `gh-pages` as well.

Validation includes PDF.js/PDF-LIB parsing of a 70-page document larger than 8 MiB, preserved text/page geometry, per-reader signature isolation, malformed templates, source truncation/cancellation, owner-only preparation, unchanged page-index counts and byte-for-byte frontend saving. `scripts/verify-large-stream.mjs` exercises the bundled production Worker with a synthetic 136 MiB source in a local workerd isolate and records chunk sizes and Drive request count; run it after `wrangler deploy --dry-run --outdir ../watermark-v2-dryrun`. Its local compatibility date is recorded in the result and may precede the production date. No result from that script is a production CPU measurement.

New tickets atomically record the source filename and MD5 in the owner-only audit events. Page delivery and browser display reports are separately deduplicated per ticket/page. Display reports come from the browser and can be forged; delivery means the server began responding, not that a user read or saved the content. The trace panel shows these limitations, never places names/emails in visible marks, and reads selected PDF trace information locally without uploading PDF contents. Legacy tickets lack a historical source snapshot.

Both builds package `trace-watermark.mjs`, `pdf-render.mjs` and the local PDF-LIB ES module. The Ω emblem is rendered as text. The Cloudflare deployment does not publish the separate GitHub Pages branch; publish the rebuilt `dist-pages` contents to that branch separately and verify the deployed asset hashes.

The homepage update log also includes a collapsible legacy development history reconstructed from 22 recovered Git snapshots dated 2026-10-15 through 2026-10-21 and the original handover reports. It separates dated milestones from the undated independent-answer preparation record and preserves the historical pending status of 49 books. Snapshot counts are not presented as proof of 22 successful deployments.

PDF.js decoder, CMap and standard-font directory URLs are resolved absolutely against the frontend page URL. Relative paths can resolve under the nested worker's `/assets/` directory a second time, breaking CCITT/JBIG2 image decoding and silently producing blank pages. The reader uses the software image path for browser compatibility and checks decoded image resources before declaring success. An image decode failure hides the page and offers retry. The fast-reading note refers to the current PDF, so an independent answer file is not described as the entire source book.

The UI calls the per-delivery identifier an authorization code (授權碼); internal trace keys and existing PDF metadata remain compatible. A code identifies an audit record and is not an access credential. Actual rank assignments are omitted from ordinary `/api/me` responses. Rank labels are delivered only to the authenticated owner, and ordinary account/viewer interfaces do not display rank badges or privileged-reader banners. Existing account permissions, labels and download allowances remain intact.
