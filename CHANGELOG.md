# Changelog

Changes are recorded by date. This application is not published to npm.

## Unreleased

### Added

- Configurable `debug`, `info`, `warn`, `error`, and `silent` log levels through the
  `logLevel` configuration field and `--log-level` CLI override.
- Severity labels and debug response-status diagnostics, with warnings and errors routed
  to stderr. Log filtering does not disable monitoring or email alerts.
- Per-target HTTP request headers for authenticated endpoints and content negotiation,
  validated without echoing credential values in validation errors.
- Opt-in `--immediate` startup checks that preserve recurring intervals and notification pacing.
- Webhook notifications (`webhook.url`, optional `headers` and `enabled`) with a JSON payload
  compatible with Slack, Discord, Mattermost, and Google Chat. Webhooks can be combined with
  email, and their URLs are never logged.
- Optional per-target `maxResponseTime` that fails otherwise-passing checks that respond too
  slowly, plus response times in `debug` diagnostics.
- GitHub issue templates for bug reports and feature requests.
- CI smoke tests for the extracted runtime ZIP and downloadable ZIP artifacts retained for
  14 days, without uploading coverage reports.

### Changed

- Grouped README badges and added request-header, startup-mode, and build-download guidance.
- Ignore alternate local configuration files in Git and Prettier to protect private settings.
- `start-via-pm2.sh` works from any directory, names the process `health-check`, and no longer
  prints an error when no previous process exists.

### Fixed

- Print startup status immediately in normal monitoring mode instead of remaining silent
  until the first configured polling interval.
- Cancel once-mode HTTP requests cleanly on `SIGINT` and `SIGTERM`, return an unsuccessful
  exit code for interrupted checks, and remove shutdown listeners on completion.
- Close the SMTP transport only once when signal handling and finalization both stop the monitor.

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
