# Zayanim weekend

The group's twice-a-year zimmer weekend, on one page (Hebrew, phone-first):

- **Meat, alcohol, general food** - one shopping list each, with the one person who buys it.
- **Gear** - things brought from home, and who brings each.
- **Settlement** - receipts go in as they're paid; the page splits them by headcount (a couple counts as two),
  lets people opt out of a category (e.g. non-drinkers skip alcohol), and lists the fewest transfers that settle everyone.
- **New weekend** - closes the current one into history and starts the next with the same friends and lists.

Every edit is sent as a small operation that the server applies to the latest saved list, so two people editing
at once never overwrite each other. Reading and editing both need the group code; the menu's share link carries
the code in the URL fragment, so opening it once logs that phone in.

## Development

Requires Node 22 or later.

```sh
npm ci
npm test
node scripts/dev.mjs
```

`scripts/dev.mjs` serves the site on http://localhost:8888 with in-memory storage (code: `local-dev-code-1234567890`).

`public/model.js` holds the data model, validation, edit operations and settlement math, and is shared by the page
and the server (`lib/api.mjs`, exposed by `netlify/functions/list.mjs` at `/api/list`).

## Netlify

Build command `node scripts/configure.mjs`, publish directory `public`, functions directory `netlify/functions`.
Set `SYNC_ENABLED=true` and `EDIT_CODE_SHA256` (SHA-256 of the group code, at least 20 characters) in the Netlify
environment; keep the code itself out of Git.

Production and each preview deploy get separate Blobs stores; `?test=1` uses a separate test store. The weekend is
saved under `weekend-v3`; the earlier list under `current` is left untouched, and every previous version is kept under
`history/`.

Pushes to `main` publish the live site. On Netlify's credit-based Free plan each production deploy uses credits, so
batch changes into one push.
