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

The website's owner-only user-management panel adds named Google accounts and sets category scope, viewing, download allowance and daily limits. Keep global access disabled for an allowlist-only library. Changes are checked on every protected request; blocking an account also revokes its sessions. Only the owner can inspect operation records and PDF trace identifiers.

`scripts/import-indexes.py` converts existing concatenated gzip PDF indexes to bounded SQL batches for `pdf_headers` and `pdf_pages`. Generated imports and source PDFs must remain outside the repository. Viewing retrieves only indexed page ranges. Full-file access requires download permission and uses the daily quota. Trace identifiers support attribution but do not prevent screenshots or redistribution.

If Google OAuth publishing status is Testing, add the owner as a test user. Drive refresh tokens issued in Testing expire after seven days, requiring reauthorization. Production publishing and any applicable Google verification are separate from site permissions.

PDF.js is distributed under the Apache License 2.0; see PDFJS-LICENSE.
