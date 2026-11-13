# Security policy

## Supported code

Security fixes target the current `main` branch. Older snapshots have no separate support
commitment. Use a maintained Node.js release and install the committed lockfile with `npm ci`.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/doctorlai/health-checks/security/advisories/new)
if it is enabled. If that option is unavailable, open an issue asking for a private reporting
channel **without describing the vulnerability**.

Include affected versions or commits, impact, prerequisites, and a minimal reproduction in
the private report. Do not include production passwords, tokens, personal data, or sensitive
response bodies. There is no guaranteed response time or paid support agreement.

## Operating safely

- Run the monitor as an unprivileged user and restrict access to `config.json`.
- Use only endpoints you own or are authorized to monitor.
- Keep credentials out of Git and rotate any credentials that have been exposed.
- Prefer HTTPS and provider-specific app passwords. Do not disable TLS certificate validation.
- Treat URLs, logs, and notification contents as potentially sensitive.
- Protect authorization headers and webhook URLs like SMTP credentials. Custom headers may be
  forwarded on redirects, so only use trusted endpoints and redirect destinations.
- Review dependency updates and run `npm audit` periodically.

The monitor makes requests to URLs from its configuration and sends alerts through the
configured mail provider or webhook. Do not accept configuration from untrusted users or expose it as
a public URL-fetching service. See [PRIVACY.md](PRIVACY.md) for data handling.
