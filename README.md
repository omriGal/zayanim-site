# Zayanim weekend

The group's twice-a-year zimmer weekend, on one page (Hebrew, phone-first), following how it is actually run:

1. **Place** - zimmer, dates (Thursday to Saturday), link, check-in.
2. **Who's coming** - each family answers coming / not coming; adults, kids and vegetarians set the quantities.
3. **Roles** - one family each for the grill, alcohol, general shopping and breakfast, each with its shopping list.
4. **Extra gear** - kitchen, grill and fire, general; each item assigned to a family. Plus a personal packing list.
5. **Settling up** - receipts go in as they're paid; split equally per family (with a weight, e.g. ½ for someone alone),
   families can opt out of a category, and the page lists the fewest transfers that settle everyone.
6. **Lessons** - after the weekend each item is marked missing / too much / just right, shown next to it next time.

The starting lists (`public/template.js`) come from the Dec 2022 sheet and the Sep 2026 weekend chat.
A new weekend keeps families, lists, gear and lessons, and resets answers, roles, ticks and expenses.

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
Set `SYNC_ENABLED=true` and `EDIT_CODE_SHA256` (SHA-256 of the group code, at least 15 characters) in the Netlify
environment; keep the code itself out of Git.

Production and each preview deploy get separate Blobs stores; `?test=1` uses a separate test store. The weekend is
saved under `weekend-v5`; the earlier list under `current` is left untouched, and every previous version is kept under
`history/`.

Pushes to `main` publish the live site. On Netlify's credit-based Free plan each production deploy uses credits, so
batch changes into one push.
