# Waterfowl

A fast, native desktop client for PostgreSQL — browse your schema, run queries,
edit data, and export results, without a browser tab in sight.

> **Work in progress.** Waterfowl is usable but still early. Don't point it at a
> production database you care about yet.

![Waterfowl](/dev/1.png)
![Waterfowl](/dev/2.png)
![Waterfowl](/dev/3.png)

## Features

- **Connections** — save and manage multiple PostgreSQL connections, test them before connecting.
- **Schema browser** — tables, views, functions, sequences and enums for every schema in the database.
- **Data grid** — page through table and view data, filter by column, hide columns you don't need, and edit cells in place.
- **Query editor** — run single queries or whole scripts, with per-statement results.
- **Export** — write tables, views or a filtered selection out as CSV, JSON (array or NDJSON) or SQL `INSERT` statements. Exports stream to disk, so table size isn't limited by available memory.
- **Auto-updates** — new releases are picked up in the background.

## Installing

Grab the latest build for your platform from the
[releases page](https://github.com/fosslife/waterfowl/releases):

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `.dmg` |
| Windows | `.msi` or `.exe` |
| Linux | `.AppImage`, `.deb` or `.rpm` |

macOS and Windows will warn that the app is from an unidentified developer —
the builds aren't code-signed yet.

## Building from source

You'll need [Node.js](https://nodejs.org) 24, [pnpm](https://pnpm.io) and a
[Rust toolchain](https://rustup.rs). On Debian/Ubuntu you'll also need the
system libraries Tauri builds against:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

Then:

```bash
pnpm install
pnpm tauri dev      # run in development mode
pnpm tauri build    # produce a release binary for your platform
```

## Development

Most of the interesting code talks to a live PostgreSQL server, so there's a
seeded test database to develop against:

```bash
podman compose -f dev/compose.yaml up -d   # or `docker compose`
pnpm seed
```

That gives you `postgresql://postgres:postgres@localhost:5432/waterfowl_test`,
populated with tables covering a wide range of PostgreSQL types.

Running the tests:

```bash
pnpm test                       # frontend
cd src-tauri && cargo test      # backend
```

The backend tests that need a database **skip themselves** when it isn't
running, and still report success — so bring the database up first, or you'll
be looking at a green suite that tested nothing.

Tear it down with `podman compose -f dev/compose.yaml down -v`.

## Contributing

Issues and pull requests are welcome. If you're picking up something larger,
open an issue first so we can talk it through — `TODO.md` tracks what's
planned and what's known to be broken.
