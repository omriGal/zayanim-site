# Zayanim shared shopping list

A Hebrew shopping list with public reading and code-gated editing. Editors change a local draft, then choose Save for everyone. Concurrent saves are checked so a stale draft cannot overwrite someone else's update.

## Development

Requires Node 22 or later.

```sh
npm ci
npm test
```

Netlify build command: `node scripts/configure.mjs`
Publish directory: `public`
Functions directory: `netlify/functions`

Set `SYNC_ENABLED=true` and `EDIT_CODE_SHA256` in Netlify environment variables. The latter is the SHA-256 digest of a long random editor code. Keep the editor code and environment values out of Git. The editor code stays in tab memory, not browser storage.

The build separates production and preview storage. `/test.html` uses a separate authenticated test namespace. Tests in `tests/` use in-memory storage; deployment tests are also needed after changing infrastructure.

## Editing and recovery

The page opens read-only. Unlock with the editor code, edit a draft, then save explicitly. If another editor saved first, export your draft before loading the shared list and merging deliberately.

The backup button exports JSON. Imports affect the local draft until explicitly saved. Original browser-only data under `zimmer-list-v5` is not deleted or overwritten. Previous shared versions are stored server-side; restoration requires account access and is separate from reverting the website code.

## Publishing

Pushes to `main` trigger Netlify builds and, when automatic publishing is enabled, update the live website. Collaborators with publishing access can change both the page and server authentication, so grant that access only to trusted publishers.

On Netlify's credit-based Free plan, production publication uses 15 credits, plus metered traffic and compute. Preview deployments have no deployment-credit charge but still use traffic/compute. Exhausting the team's credit balance pauses its sites. Check current Netlify terms and balance before publishing.
