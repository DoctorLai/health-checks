# Support

## Usage questions and bugs

Search [existing issues](https://github.com/doctorlai/health-checks/issues), then open a new
issue if needed. Include:

- The application version (`npm start -- --version`) and `node --version`.
- The command you ran, operating system, and expected versus actual behavior.
- Sanitized logs and the smallest configuration that reproduces the problem.
- Whether `npm run config:check` succeeds.

Replace real endpoints, email addresses, passwords, and response contents with placeholders.
Do not upload `config.json` or screenshots containing credentials.

## Common checks

- **Missing configuration:** copy `config.json.sample` to `config.json`, then edit the copy.
- **No immediate requests:** normal mode waits for each target's first interval. Use
  `npm start -- --immediate` to start checking now and keep monitoring, or
  `npm start -- --once` for one immediate check that exits.
- **Authenticated endpoint returns 401 or 403:** set the target's `headers` as needed, for
  example an `Authorization` header. Verify the credential privately and do not paste it
  into issues or logs. Header values must be strings and cannot contain line breaks.
- **No startup or status logs:** `warn`, `error`, and `silent` hide routine monitoring output.
  Run `npm start -- --log-level info` for normal output or use `debug` for response-status
  diagnostics. The CLI option overrides the configured `logLevel`.
- **No email:** confirm `email.enabled` is `true`, validate the configuration, check SMTP
  error logs, and verify your provider's app-password requirements.
- **No webhook message:** confirm `webhook.url` is the incoming-webhook URL from your chat
  service and `webhook.enabled` is not `false`. Delivery errors such as
  `Request failed with status code 404` are logged; redirects are not followed.
- **Unexpected "responded too slowly" alerts:** raise or remove `maxResponseTime`. Run with
  `--log-level debug` to see measured response times.
- **Repeated failures but no new alert:** `ignore_period` suppresses repeated notifications.
  Failures remain in the error log unless the log level is `silent`.
- **No recovery alert:** set `notifyRecovery` to `true` on the target and use continuous
  monitoring. The target must fail, then pass both checks. Separate `--once` runs do not
  share failure state. Alerts still wait for the notification delivery interval.
- **No ZIP build:** install development dependencies with `npm ci` in a full source checkout,
  then run `npm run build`. The Node CLI ZIP is created in `dist/`; it is not a Chrome
  Web Store package. Successful CI runs also offer a runtime ZIP artifact for 14 days.
- **Missing JavaScript badge:** check the Language badge workflow and its write permission.
  Its first successful run creates the `badges` branch.

Run `npm ci` to install development dependencies before using `npm run check`. Coverage HTML
is available at `coverage/index.html` after `npm run coverage`. CI enforces minimum coverage
but does not upload reports or post coverage comments.

## Security and service limits

Follow [SECURITY.md](SECURITY.md) for vulnerability reports. This project has no guaranteed
support response time or monitoring uptime agreement. It is not a substitute for redundant
monitoring when availability is critical.
