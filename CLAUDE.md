# Waterfowl — Project Overview & Development Guide

## What is this?

Waterfowl is a **desktop PostgreSQL database manager** built with [Tauri 2](https://tauri.app/). It provides a GUI for managing PostgreSQL connections, browsing schemas/tables/views/functions/sequences, editing data, and running ad-hoc SQL queries.

> **Status:** Work in progress — not production-ready.

---

## Tech Stack

| Layer             | Technology                                         |
| ----------------- | -------------------------------------------------- |
| Desktop shell     | Tauri 2 (`@tauri-apps/api` ^2.11)                  |
| Frontend          | React 19, TypeScript, Vite 8                       |
| Routing           | `react-router-dom` ^7                              |
| UI / styling      | CSS Modules, `clsx`, `lucide-react`                |
| Tables            | `@tanstack/react-table`, `@tanstack/react-virtual` |
| SQL editor        | CodeMirror 6 with `@codemirror/lang-sql`           |
| Local metadata DB | SQLite via `@tauri-apps/plugin-sql`                |
| Remote PostgreSQL | Rust + `sqlx` (Tokio runtime, rustls TLS)          |
| Package manager   | **pnpm**                                           |

---

## Project Structure

```
waterfowl/
├── src/                        # React/TypeScript frontend
│   ├── App.tsx                 # Root — providers + routes
│   ├── main.tsx                # Entry point
│   ├── layouts/
│   │   └── AppLayout.tsx       # Sidebar + <Outlet />
│   ├── pages/
│   │   ├── Welcome.tsx         # Landing / recent connections
│   │   └── connection/
│   │       ├── new/            # Add/edit connection form
│   │       └── details/        # Main workspace (tabs, panels)
│   ├── components/
│   │   ├── ui/                 # Reusable primitives (Button, Input, Modal, Toast, etc.)
│   │   ├── sql-editor/         # CodeMirror-based SQL editor
│   │   └── ui/data-table/      # TanStack Table + virtualisation
│   ├── context/                # React Contexts (no Redux/Zustand)
│   │   ├── ConnectionsContext.tsx
│   │   ├── ToastContext.tsx
│   │   ├── NewConnectionModalContext.tsx
│   │   └── TabContext.tsx
│   ├── services/
│   │   ├── database.ts         # SQLite schema + migrations
│   │   └── connections.ts      # Connection CRUD + usage tracking
│   ├── styles/
│   │   ├── global.css
│   │   └── design-tokens.css   # CSS custom properties / tokens
│   ├── types/
│   └── utils/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs              # Tauri builder, plugin registration, invoke_handler
│   │   ├── state.rs            # AppState — Mutex<HashMap<id, DriverConnection>>
│   │   ├── types.rs            # Shared Rust types (ConnectionConfig, QueryResult, …)
│   │   ├── commands/           # Tauri commands (connections.rs, queries.rs)
│   │   └── drivers/
│   │       ├── mod.rs          # DatabaseDriver trait + DriverConnection enum
│   │       └── postgres/       # PostgreSQL driver + value decoding (decode.rs)
│   ├── capabilities/
│   │   ├── default.json        # core, opener, sql permissions
│   │   └── desktop.json        # window-state permissions
│   └── tauri.conf.json
├── dev/
│   └── seed.ts                 # Faker-powered Postgres seed script
└── public/
```

---

## Routes

| Path                   | Component           | Description                 |
| ---------------------- | ------------------- | --------------------------- |
| `/`                    | `Welcome`           | Recent connections list     |
| `/connection/edit/:id` | `NewConnection`     | Create or edit a connection |
| `/connection/:id`      | `ConnectionDetails` | Main database workspace     |

---

## Data Architecture

### Two-tier persistence

1. **SQLite (local metadata)** — managed entirely in TypeScript via `services/database.ts` and `services/connections.ts`. Stores saved connections and usage history.

2. **PostgreSQL (live connections)** — managed by Rust. The frontend calls `invoke()` to run Tauri commands; Rust opens/holds connections in `AppState` (keyed by connection id) and runs queries via `sqlx`.

### Tauri commands (Rust → frontend bridge)

`test_connection`, `establish_connection`, `close_connection`, `get_schemas`, `get_tables`, `get_table_data`, `get_filtered_table_data`, `get_view_data`, `get_database_info`, `get_schema_objects`, `get_function_info`, `get_sequence_info`, `get_table_structure`, `get_enum_values`, `execute_query`

---

## Development Setup

```bash
# Install dependencies
pnpm install

# Start full desktop app (Tauri dev)
pnpm tauri dev          # Vite starts on http://localhost:1420

# Frontend only (browser, no Tauri)
pnpm dev

# Production build
pnpm tauri build

# Seed a local Postgres instance for testing
pnpm seed               # default row count
pnpm seed:small         # small dataset
pnpm seed:large         # large dataset

# Format
pnpm format
```

> The seed script uses `pg` + `@faker-js/faker`. Configure the target DB via env vars before running.

---

## Coding Conventions

### TypeScript / React

- Performance first, User experience second. Everything else is after that.
- Think about highest amount of optimizations possible, memoisation, caching, reduced re-renders, etc have highest priority.
- Have a clear and concise codebase.
- Keep it simple, it should be readable in 1 glance, avoid overengineering.
- Use the most efficient data structures and algorithms.
- **Strict TypeScript** — `strict`, `noUnusedLocals`, `noUnusedParameters` are all on. Keep it that way.
- **Path aliases** — always use aliases, never relative `../../` for cross-directory imports:
  - `@components/`, `@context/`, `@pages/`, `@services/`, `@types/`, `@utils/`, `@hooks/`, `@assets/`, `@` → `src/`
- **CSS Modules** — every component gets its own `*.module.css`. No inline styles, no global class names.
- **React Context** for shared state — there is no Redux or Zustand. Add new contexts under `src/context/`.
- **Service layer** — all SQLite reads/writes go through `services/`. Never call `@tauri-apps/plugin-sql` directly from components.
- **`invoke()` calls** — call Tauri commands from page-level components or services, not from deep inside UI components.

### Rust

- Use the **driver trait** (`DatabaseDriver`) for all database operations — do not add raw `sqlx` code directly into commands.
- When adding a new database driver, follow the existing pattern in `drivers/postgres/` and register the variant in `DriverConnection`.
- **Always `clone` a connection out of the `Mutex` before `await`ing** — holding a `MutexGuard` across an await point will deadlock.
- **Use `try_get` not `get`** when decoding row values to avoid panicking on malformed data (see `decode.rs` for reference).
- The `schema` parameter should default to `"public"` — use `unwrap_or_else(|| "public".to_string())`.

### General

- Prettier is configured — run `pnpm format` before committing.
- `src-tauri/` is excluded from Prettier (Rust is formatted by `rustfmt`).
- `index.html` title is still the Vite template default ("Tauri + React + Typescript") — update it to "Waterfowl" when polishing.

---
