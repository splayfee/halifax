# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.3]

### Fixed

- **ESM output now uses fully-specified relative import paths** (e.g. `./HalifaxClient.js`).
  The package is `"type": "module"`, but the build previously emitted extensionless
  specifiers, which Node's native ESM resolver rejects with `ERR_MODULE_NOT_FOUND`.
  Bundlers (Vite, webpack) tolerated this, so browser builds worked, but Node consumers —
  SSR, scripts, and test runners such as Vitest that resolve `node_modules` natively —
  failed to import the package. The build now targets `NodeNext` module resolution, so both
  source and emitted imports carry the `.js` extension and resolve in plain Node. No public
  API changes.

## [2.2.2]

### Fixed

- Removed the `preinstall` script that enforced pnpm inside the monorepo. The script
  had no value for package consumers but caused npm (v7+) to prompt with an "approve
  build scripts" confirmation on every install. End-users no longer need to approve
  anything to install `@edium/halifax-client`.

## [2.2.1]

### Added

- `README.md` is now included in the published npm tarball.

## [2.2.0]

### Added

- **Initial release** of `@edium/halifax-client` — a typed browser/Node client for
  Halifax auto-CRUD APIs. Zero runtime dependencies; bring your own HTTP client
  (native `fetch`, axios, ky, ofetch, or superagent — each ships a ready-made
  transport adapter).
  - Typed CRUD methods (`getMany`, `getOne`, `create`, `update`, `upsert`, `delete`,
    `query`) that mirror every Halifax REST operation.
  - Fluent `QueryBuilder` that compiles to the Halifax server-side query AST.
  - **TanStack Query integration** — `ResourceClient` exposes `queryOptions()`,
    `infiniteQueryOptions()`, and `mutationOptions()` (with auto-invalidation) via
    the `@edium/halifax-client/tanstack` sub-path export; TanStack Query itself is an
    optional peer dependency and is never required when unused.
  - Full support for envelope unwrapping, custom base URLs, and per-request auth
    token injection.
  - See [README.md](./README.md) for full documentation and usage examples.
