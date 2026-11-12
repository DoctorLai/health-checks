# Contributing

Use an issue to describe a bug or a proposed behavior change before starting a large patch.
Small fixes and focused tests can be submitted directly.

## Setup

Use Node.js 22.13 or newer; `.nvmrc` selects Node.js 24.

```sh
nvm install
nvm use
npm ci
npm run config:check -- --config config.json.sample
npm run check
```

Create a branch from `main`. Keep each pull request focused on one change and update the
README, sample configuration, and changelog when behavior changes.

## Checks and tests

Run `npm run format` before submitting, then `npm run check`. The latter runs formatting,
lint, the ZIP build and sample-configuration checks, and tests with coverage. Every source file
must reach 80% in lines, statements, functions, and branches. `npm test` runs the tests
without coverage.

Add regression tests for changed behavior, including the relevant failure path. Prefer
fake timers and mocked SMTP; HTTP integration tests must bind only to a loopback address.
Do not use live services, personal credentials, or real email delivery in tests.

The CI matrix covers Node.js 22, 24, and 26. `npm run ci` is an alias for the complete check;
it does not install dependencies. CI enforces coverage but does not upload reports or post
coverage comments.

`npm run build` creates a runtime ZIP in `dist/`. Keep its allowlist in `scripts/build.cjs`
up to date when adding runtime files. Never package real configuration, credentials, or
development artifacts. Use the full source checkout for development; the runtime ZIP does
not contain the development scripts or tests.

## Configuration and sensitive data

Do not commit `config.json`, passwords, tokens, private URLs, or logs containing sensitive
responses. Use `config.json.sample` for examples and placeholder credentials in tests.
Report security issues using [SECURITY.md](SECURITY.md), not a public issue.

## Dependencies and versioning

Commit `package-lock.json` with dependency changes and verify a clean `npm ci`. Keep Vitest
and `@vitest/coverage-v8` on matching versions. GitHub Actions are pinned to commit SHAs and
updated by Dependabot.

The `minimatch` override keeps ESLint's matcher on a patched version while its dependencies
still request version 10. Review the override when upgrading ESLint; remove it once the
upstream dependency ranges include a version fixing
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).

The application is not published. Use a date-based package version (`YYYY.M.D`) for a new
version and record its changes in [CHANGELOG.md](CHANGELOG.md). Do not publish the package.

## License status

This repository currently has no license. Submitting a contribution does not select or
grant a project-wide open-source license. License selection remains the owner's decision.
