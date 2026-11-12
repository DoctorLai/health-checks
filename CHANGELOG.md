# Changelog

Changes are recorded by date. This application is not published to npm.

## 2026.11.12 - 2026-11-12

### Added

- Node.js version guidance, a reproducible lockfile, Prettier, ESLint, and npm quality commands.
- Vitest regression tests and an enforced 80% per-file coverage minimum in all four categories.
- CI for Node.js 22, 24, and 26, enforcing coverage without report uploads or PR comments.
- A GitHub language-percentage badge generated on a separate `badges` branch.
- Dependabot, a pull request template, contribution guidance, and security, support, and
  privacy documentation.
- Configuration validation and `--config`, `--check-config`, `--once`, `--version`, and
  `--help` command-line options.
- Configurable HTTP timeouts, SMTP timeouts, and shutdown handlers.
- Opt-in recovery alerts per target, with a fresh failure cooldown for each new incident.
- A versioned Node runtime ZIP from `npm run build`, excluding local configuration,
  credentials, dependencies, and development artifacts.
- An `npm run ci` alias for the full quality gate and a README privacy badge.

### Changed

- Updated Axios and Nodemailer and regenerated the dependency lockfile.
- Overrode ESLint's transitive `minimatch` dependency to use a patched release.
- The sample configuration defaults to console alerts without SMTP credentials.
- Failure messages no longer include entire HTTP response bodies.
- The package is private and explicitly unlicensed; no reuse license has been selected.

### Fixed

- Expected non-2xx statuses are checked normally instead of being treated as network errors.
- Alert queues and cooldowns no longer use undeclared global variables or mutate configuration.
- Checks of the same URL can have independent cooldowns.
- Slow HTTP checks and SMTP sends no longer overlap their next scheduled attempt.
- Startup rejects invalid configuration and unsafe timer values with explicit errors.
- Corrected the README's entry-point command and removed outdated hosting claims.

## Earlier history

Earlier changes were not versioned. See the
[commit history](https://github.com/doctorlai/health-checks/commits/main) for the initial
implementation, PM2 helper, email queue, and notification cooldowns.
