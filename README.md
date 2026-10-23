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

Sign in as the configured owner on the backend, open `manage.html`, connect Google Drive with read-only access, and run the resumable catalog sync. Files are fetched only from the two configured library roots. The sync does not migrate the former site's user list or history. Book metadata is inferred from file names; review categories after syncing. Separate answer-file relationships from the old backend are not imported automatically.

The same sync button automatically builds indexes for new or changed PDFs. Keep the management page open until it reports completion: an isolated browser Web Worker downloads the source through an owner-only endpoint, verifies its size and MD5, and builds each page with PDF-LIB. Source PDFs and Google credentials are never exposed to ordinary readers. The browser sends bounded, compressed page indexes back to D1; each page advances a persistent cursor atomically. Closing or pausing the page is safe; a later sync resumes completed page uploads (the source PDF is downloaded again). A header is published only after every page is present and Drive metadata has been rechecked. Identical content can reuse an existing index, and same-ID file replacements select only checksum-matched indexes.

Automatic indexing supports unencrypted PDFs up to 256 MiB, at most 10,000 pages, and bounded per-page complexity. Errors are shown per file without granting broader reader access; split or recompress oversized files and sync again. Cloudflare's existing D1 daily allowance still applies; after a quota reset the same sync resumes. This runs in the administrator's open browser and does not require a local Python installation, a continuously running computer agent, or a separate paid processing service. Apply migration `0003.sql` before deploying this feature.

The website's owner-only user-management panel adds named Google accounts and sets category scope, viewing, download allowance and daily limits. Keep global access disabled for an allowlist-only library. Changes are checked on every protected request; blocking an account also revokes its sessions. Only the owner can inspect operation records and PDF trace identifiers.

The catalog lists each PDF separately, including files inside nested folders and answer PDFs. Each entry carries its original parent book ID plus the selected asset ID, so category and folder authorization still apply. The connection page reports PDF and index coverage separately. Full-file responses include the expected byte count; the frontend refuses incomplete transfers instead of saving a truncated PDF.

`scripts/import-indexes.py` converts existing concatenated gzip PDF indexes to bounded SQL batches for `pdf_headers` and `pdf_pages`. Generated imports and source PDFs must remain outside the repository. Viewing retrieves only indexed page ranges. Full-file access requires download permission and uses the daily quota. Trace identifiers support attribution but do not prevent screenshots or redistribution.

For a PDF without an existing index, install `pypdf==6.1.3` in an isolated Python environment and run `python scripts/build-pdf-index.py SOURCE.pdf DRIVE_ID OUTPUT.json.gz`. The builder validates page reconstruction and the full-document trace trailer without modifying the source. Import the resulting gzip file with `scripts/import-indexes.py`. Files copied within Drive may reuse an imported index only when their size and MD5 checksum both match; access is still checked against the requested file and its current library location.

Browser-facing OAuth failures render a Chinese explanation with a link back to the GitHub website. API failures retain structured JSON for the application. An account denied by the allowlist is not automatically granted access when it signs in.

If Google OAuth publishing status is Testing, add the owner as a test user. Drive refresh tokens issued in Testing expire after seven days, requiring reauthorization. Production publishing and any applicable Google verification are separate from site permissions.

PDF.js is distributed under the Apache License 2.0; see PDFJS-LICENSE.
