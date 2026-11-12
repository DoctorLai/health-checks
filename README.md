# health-checks

[![CI](https://github.com/doctorlai/health-checks/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/doctorlai/health-checks/actions/workflows/ci.yml)
[![Last commit](https://img.shields.io/github/last-commit/doctorlai/health-checks)](https://github.com/doctorlai/health-checks/commits/main)
[![License: not granted](https://img.shields.io/badge/license-not%20granted-lightgrey)](#license)
[![Stars](https://img.shields.io/github/stars/doctorlai/health-checks)](https://github.com/doctorlai/health-checks/stargazers)
[![Code style: Prettier](https://img.shields.io/badge/code_style-Prettier-f8bc45)](https://prettier.io/)
[![Commit activity](https://img.shields.io/github/commit-activity/m/doctorlai/health-checks)](https://github.com/doctorlai/health-checks/graphs/commit-activity)
[![Watchers](https://img.shields.io/github/watchers/doctorlai/health-checks)](https://github.com/doctorlai/health-checks/watchers)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)
[![JavaScript percentage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdoctorlai%2Fhealth-checks%2Fbadges%2Fjavascript.json)](https://github.com/doctorlai/health-checks/search?l=javascript)
[![Repository size](https://img.shields.io/github/repo-size/doctorlai/health-checks)](https://github.com/doctorlai/health-checks)
[![Top language](https://img.shields.io/github/languages/top/doctorlai/health-checks)](https://github.com/doctorlai/health-checks)
[![Open pull requests](https://img.shields.io/github/issues-pr/doctorlai/health-checks)](https://github.com/doctorlai/health-checks/pulls)
[![Forks](https://img.shields.io/github/forks/doctorlai/health-checks)](https://github.com/doctorlai/health-checks/forks)
[![Open issues](https://img.shields.io/github/issues/doctorlai/health-checks)](https://github.com/doctorlai/health-checks/issues)
[![Node.js](https://img.shields.io/github/package-json/engines/doctorlai/health-checks?filename=package.json)](https://nodejs.org/)
[![Version](https://img.shields.io/github/package-json/v/doctorlai/health-checks)](CHANGELOG.md)
[![Privacy: no telemetry](https://img.shields.io/badge/privacy-no%20telemetry-blue)](PRIVACY.md)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/doctorlai/health-checks)

A lightweight Node.js process that polls HTTP(S) endpoints and queues email or console alerts.
Each target has its own interval, expected status, optional expected text, request timeout, and
notification cooldown. No browser, database, or hosted service is required.
Optional recovery alerts tell you when a failing endpoint becomes healthy again.

## Quick start

Use Node.js 22.13 or newer. Node.js 24 is the default in `.nvmrc`; CI tests Node.js 22, 24, and 26.

```sh
nvm install
nvm use
npm ci --omit=dev
cp config.json.sample config.json
chmod 600 config.json
# Edit config.json for your endpoints and email settings.
npm run config:check
npm start
```

`nvm` is optional if a supported Node.js version is already installed. The sample defaults to
console notifications, so it does not need SMTP credentials. `config.json` is ignored by Git.

The monitor checks each URL after its first configured interval, then repeats on that interval.
Failures are logged immediately. Queued notifications are handled one at a time at the email
interval, including in console-only mode. Slow checks of the same target do not overlap.

## Configuration

Copy [config.json.sample](config.json.sample), then edit your copy. All intervals and cooldowns
are in **seconds**; HTTP `timeout` is in **milliseconds**.

| Field                       | Required   | Behavior                                                                     |
| --------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `urls`                      | Yes        | Non-empty array of HTTP(S) targets.                                          |
| `urls[].name`               | Yes        | Non-empty label used in logs and notifications.                              |
| `urls[].url`                | Yes        | Absolute HTTP or HTTPS URL.                                                  |
| `urls[].interval`           | Yes        | Positive polling interval, up to 2,147,483.647 seconds.                      |
| `urls[].expectedStatusCode` | Yes        | Integer from 100 to 599; non-2xx statuses can be expected too.               |
| `urls[].expectedContent`    | No         | Case-sensitive substring. Empty or omitted disables the body check.          |
| `urls[].ignore_period`      | No         | Notification cooldown per target. Default `0` disables suppression.          |
| `urls[].notifyRecovery`     | No         | Boolean, default `false`. Queue an alert when a failing target recovers.     |
| `urls[].timeout`            | No         | Positive integer request timeout. Default `10000`; maximum 2,147,483,647.    |
| `email.enabled`             | Yes        | `false` prints notifications; `true` sends email.                            |
| `email.interval`            | Yes        | Positive notification interval, with the same limit as the polling interval. |
| `email.service`             | If enabled | Service name supported by Nodemailer, for example `Gmail`.                   |
| `email.auth.user`           | If enabled | SMTP account and sender address.                                             |
| `email.auth.pass`           | If enabled | SMTP password or provider app password.                                      |
| `email.destination`         | If enabled | Recipient address.                                                           |

A failure at or within `ignore_period` seconds of the previous queued alert is suppressed.
Suppressed failures still appear in the error log and do not extend the cooldown.
Checks configured for the same URL have independent cooldowns.

SMTP connection, greeting, and socket timeouts are 10 seconds. Failed email sends are logged
and discarded, not retried. The queue and cooldown state live in memory and are lost on restart.
If failures arrive faster than delivery, the queue can grow; choose suitable cooldowns and
notification intervals.

Use an app password where your mail provider requires one. Restrict access to your configuration
file and never include it in a pull request. See [PRIVACY.md](PRIVACY.md) for what the process logs
and transmits.

### Recovery alerts

Set `notifyRecovery` to `true` on any target in `urls` to receive one notification when it
passes both its status and content checks after a failure. Recovery alerts use the same
email or console queue and delivery interval as failure alerts. An initially healthy
target does not produce a recovery alert.

With recovery alerts enabled, a recovery also clears that target's failure cooldown, so
a new incident can alert immediately. With the option omitted or `false`, failure alerts
and cooldowns behave as before, including across successful checks.

Incident state is held in memory. Recovery alerts require continuous monitoring; separate
`--once` invocations do not share previous failure state.

## Command-line options

```sh
# Check all endpoints once, deliver queued alerts immediately, then exit.
npm start -- --once

# Use a configuration outside the repository.
npm start -- --config /path/to/config.json

# Validate a configuration without making HTTP or SMTP requests.
npm run config:check -- --config config.json.sample

npm start -- --version
npm start -- --help
```

Once mode exits with code `0` when every target passes, or `1` for a failed check or startup
error. Normal monitoring continues after failed checks; use logs and notifications to track
failures. Stop with `Ctrl+C`, `SIGINT`, or `SIGTERM`; timers are cleared and active HTTP checks
are canceled. Normal mode does not flush pending notifications on shutdown.

The default configuration path is `config.json` beside `health-check.js`. An explicit
`--config` path is resolved from the current working directory.

## Running with PM2

Install [PM2](https://pm2.keymetrics.io/) separately if you need process supervision:

```sh
npm install --global pm2
bash start-via-pm2.sh
pm2 logs health-check
pm2 save
```

Run the helper from the repository root. It replaces the existing `health-check.js` process
and restarts it if memory exceeds 200 MB. Configure `pm2 startup` separately if you want the
process restored after a reboot.

## Build a runtime ZIP

From a source checkout with development dependencies installed:

```sh
npm ci
npm run build
```

The build syntax-checks the scripts, validates the sample configuration, and creates
`dist/health-checks-2026.11.12.zip`. It packages the runtime, npm metadata and lockfile, sample
configuration, PM2 helper, and user documentation using an explicit file allowlist.
Your `config.json`, `.env` files, dependencies, Git history, tests, and coverage reports are
not included.

Extract the ZIP into an empty directory, run `npm ci --omit=dev`, copy `config.json.sample`
to `config.json`, edit it, and run `npm start`. Dependencies are installed from the lockfile,
not bundled. Development commands require the full source checkout, not the runtime ZIP.

This is **not a Chrome extension**. There is no Chrome manifest, Web Store listing, user
count, or rating to validate or badge. The ZIP is a Node CLI distribution and cannot be
submitted to the Chrome Web Store.

## Development

Use a full source checkout and install development dependencies with `npm ci`.

| Command                | Purpose                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `npm start`            | Run the monitor.                                                                             |
| `npm run config:check` | Validate local configuration without network calls.                                          |
| `npm run format`       | Format project files with Prettier.                                                          |
| `npm run format:check` | Check formatting without modifying files.                                                    |
| `npm run lint`         | Run ESLint.                                                                                  |
| `npm run build`        | Validate scripts and sample configuration, then create the versioned runtime ZIP in `dist/`. |
| `npm test`             | Run the test suite once.                                                                     |
| `npm run test:watch`   | Run tests in watch mode.                                                                     |
| `npm run coverage`     | Test with enforced minimum 80% lines, statements, functions, and branches per source file.   |
| `npm run check`        | Check formatting, lint, build, and coverage; coverage also runs the tests.                   |
| `npm run ci`           | Run the same full quality gate as `npm run check`; install dependencies with `npm ci` first. |

Coverage reports are written to `coverage/`, including an HTML report at `coverage/index.html`.
Tests use mocked SMTP, fake timers, and local HTTP servers; they do not contact production
endpoints or send real email. See [CONTRIBUTING.md](CONTRIBUTING.md).

## GitHub automation

- **CI** runs all checks on pushes to `main` and on pull requests.
  Coverage minimums are enforced on every supported Node.js version. Coverage reports stay
  on the runner; they are not uploaded or posted as PR comments.
- **Language badge** reads GitHub's language byte counts and writes `javascript.json` only
  to the `badges` branch. It never commits to `main`. It runs after main-branch pushes, weekly,
  and on manual dispatch. The scheduled run also accounts for GitHub's language-data caching.
- **Dependabot** checks npm dependencies and pinned GitHub Actions weekly.

GitHub Actions must be enabled, and repository or organization policy must allow
`contents: write` for the Language badge workflow. CI itself has read-only permissions.
No personal access token is needed. The JavaScript badge becomes available after the first
successful language-badge run on `main`.
This is a command-line tool, so there is no GitHub Pages deployment or UI translation catalog.

## Version and changelog

This repository is not published to npm. The package uses a date-based version, currently
`2026.11.12`; changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Support and security

For usage questions and bug reports, see [SUPPORT.md](SUPPORT.md). Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

If you find the tool useful, you can [buy the maintainer a coffee](https://justyy.com/out/bmc).

## License

No license has been granted in this repository. The package is marked `private` and
`UNLICENSED` to prevent accidental publication; this is not an open-source license.
The owner must choose a license before reuse rights can be stated.

## Acknowledgement

The initial implementation was written with help from
[ChatGPT](https://helloacm.com/chatgpt-designs-a-health-check-tool-in-node-js-to-run-on-free-vps-instance/).
