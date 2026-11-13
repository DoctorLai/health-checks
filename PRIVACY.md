# Privacy and data handling

## Runtime data

The monitor runs on your machine or server. It reads a JSON configuration containing
endpoint URLs, expected content, timing settings, optional HTTP headers, SMTP credentials,
and an optional webhook URL. It does not send analytics or telemetry to the project maintainer.

Each configured endpoint receives an HTTP(S) GET request from your host. Responses are read
into memory to compare status codes and optional text. HTTP proxies configured in the
environment may also handle that traffic. Configured headers are sent with the request and
may be forwarded on redirects; use only trusted endpoints and redirect destinations.

When email is enabled, Nodemailer authenticates with your configured mail provider and
sends alerts to the configured destination. The provider handles the sender, recipient,
authentication data, and notification contents under its own policies. Console-only mode
does not create an SMTP transport.

When a webhook is enabled, each notification is sent as a JSON `POST` to the configured URL
with any configured webhook headers. The receiving service (for example Slack or Discord)
handles that content under its own policies. Webhook URLs are not written to logs.

## Logs and retention

Logs include timestamps, target URLs and names, check results, cooldown messages, and network,
SMTP, or webhook delivery errors. Alerts include the target name and a failure or recovery description.
Unexpected-content errors do not include the full response body. URLs and error messages
may still contain sensitive information, so protect logs and avoid embedding secrets in URLs.
Additional `debug` messages include HTTP status codes and response times, not response bodies.
The monitor does not add configured header values to its logs or notification contents.
An upstream server can still echo request data in its own responses or errors.

The notification queue, incident state, and cooldown timestamps exist only in process memory
and are lost on restart. The application does not maintain a database, browser storage, or a
persistent notification history. Your shell, process supervisor, mail provider, or hosting
platform may retain logs or emails separately; configure retention there.

## Your controls

- Monitor only endpoints you are authorized to access.
- Limit access to the configuration file and use an unprivileged process account.
- Disable email with `email.enabled: false` and omit `webhook` when console notifications are
  sufficient.
- Reduce monitoring output with `logLevel: "warn"`, `"error"`, or `"silent"`. This does not
  disable email or webhook delivery; explicit CLI results and fatal startup errors remain visible.
- Delete configuration files, supervisor logs, and emails according to your retention needs.
- Sanitize configuration and logs before sharing them in issues or pull requests.

The runtime ZIP build uses an explicit allowlist and excludes local configuration, `.env`
files, dependencies, Git history, tests, and coverage reports. Review archives before
sharing a customized build.

GitHub hosts the source, issues, and workflow logs. Coverage reports are not uploaded by CI.
README badge images are served by GitHub, Shields.io, and DeepWiki. Those services have their
own privacy policies; they are not used by the running monitor. See [SUPPORT.md](SUPPORT.md)
for reporting questions.
