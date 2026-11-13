const { readFileSync } = require('node:fs');
const { validateHeaderName, validateHeaderValue } = require('node:http');
const path = require('node:path');
const { parseArgs } = require('node:util');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { version } = require('./package.json');

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
}

function requireInterval(value, field) {
  if (!Number.isFinite(value) || value <= 0 || value * 1000 > MAX_TIMER_MS) {
    throw new TypeError(
      `${field} must be a positive number no greater than ${MAX_TIMER_MS / 1000}.`,
    );
  }
}

function requireHttpUrl(value, field) {
  requireString(value, field);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError(`${field} must use HTTP or HTTPS.`);
  }
}

function requireTimeout(value, field) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_TIMER_MS) {
    throw new TypeError(`${field} must be a positive integer no greater than ${MAX_TIMER_MS}.`);
  }
}

function requireHeaders(headers, field) {
  if (!isObject(headers)) {
    throw new TypeError(`${field} must be an object with string values.`);
  }
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') {
      throw new TypeError(`${field} must be an object with string values.`);
    }
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
    } catch (error) {
      // Never echo header values: they commonly hold credentials.
      throw new TypeError(`${field} contains an invalid HTTP header.`, { cause: error });
    }
  }
}

function requireLogLevel(value, field) {
  if (typeof value !== 'string' || !Object.hasOwn(LOG_LEVELS, value)) {
    throw new TypeError(`${field} must be one of: ${Object.keys(LOG_LEVELS).join(', ')}.`);
  }
}

function createLogger(level = 'info') {
  requireLogLevel(level, 'logLevel');
  const write = (severity, method) => (message) => {
    if (LOG_LEVELS[severity] >= LOG_LEVELS[level]) {
      console[method](`[${severity.toUpperCase()}] ${message}`);
    }
  };
  const info = write('info', 'log');
  return {
    debug: write('debug', 'log'),
    info,
    log: info,
    warn: write('warn', 'warn'),
    error: write('error', 'error'),
  };
}

function validateConfig(config) {
  if (!isObject(config) || !Array.isArray(config.urls) || config.urls.length === 0) {
    throw new TypeError('urls must be a non-empty array.');
  }
  if (config.logLevel !== undefined) {
    requireLogLevel(config.logLevel, 'logLevel');
  }

  config.urls.forEach((target, index) => {
    const field = `urls[${index}]`;
    if (!isObject(target)) {
      throw new TypeError(`${field} must be an object.`);
    }
    requireString(target.name, `${field}.name`);
    requireHttpUrl(target.url, `${field}.url`);
    requireInterval(target.interval, `${field}.interval`);
    if (
      !Number.isInteger(target.expectedStatusCode) ||
      target.expectedStatusCode < 100 ||
      target.expectedStatusCode > 599
    ) {
      throw new TypeError(`${field}.expectedStatusCode must be an integer from 100 to 599.`);
    }
    if (target.expectedContent !== undefined && typeof target.expectedContent !== 'string') {
      throw new TypeError(`${field}.expectedContent must be a string.`);
    }
    if (target.headers !== undefined) {
      requireHeaders(target.headers, `${field}.headers`);
    }
    if (target.notifyRecovery !== undefined && typeof target.notifyRecovery !== 'boolean') {
      throw new TypeError(`${field}.notifyRecovery must be a boolean.`);
    }
    if (
      target.ignore_period !== undefined &&
      (!Number.isFinite(target.ignore_period) || target.ignore_period < 0)
    ) {
      throw new TypeError(`${field}.ignore_period must be a non-negative number.`);
    }
    if (target.timeout !== undefined) {
      requireTimeout(target.timeout, `${field}.timeout`);
    }
    if (target.maxResponseTime !== undefined) {
      requireTimeout(target.maxResponseTime, `${field}.maxResponseTime`);
    }
  });

  if (!isObject(config.email) || typeof config.email.enabled !== 'boolean') {
    throw new TypeError('email.enabled must be a boolean.');
  }
  requireInterval(config.email.interval, 'email.interval');
  if (config.email.enabled) {
    requireString(config.email.service, 'email.service');
    requireString(config.email.auth?.user, 'email.auth.user');
    requireString(config.email.auth?.pass, 'email.auth.pass');
    requireString(config.email.destination, 'email.destination');
  }
  if (config.webhook !== undefined) {
    if (!isObject(config.webhook)) {
      throw new TypeError('webhook must be an object.');
    }
    if (config.webhook.enabled !== undefined && typeof config.webhook.enabled !== 'boolean') {
      throw new TypeError('webhook.enabled must be a boolean.');
    }
    if (config.webhook.enabled !== false) {
      requireHttpUrl(config.webhook.url, 'webhook.url');
      if (config.webhook.headers !== undefined) {
        requireHeaders(config.webhook.headers, 'webhook.headers');
      }
    }
  }
  return config;
}

function loadConfig(filename = path.join(__dirname, 'config.json')) {
  let contents;
  try {
    contents = readFileSync(filename, 'utf8');
  } catch (error) {
    throw new Error(`Could not read configuration at ${filename}: ${error.message}`, {
      cause: error,
    });
  }
  let config;
  try {
    config = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Configuration at ${filename} is not valid JSON.`, { cause: error });
  }
  return validateConfig(config);
}

function createMonitor(config, { logger } = {}) {
  validateConfig(config);
  if (logger === undefined) {
    logger = createLogger(config.logLevel ?? 'info');
  }
  const queue = [];
  const lastHandled = new Map();
  const failedTargets = new Set();
  const inFlight = new Set();
  const timers = [];
  const controller = new AbortController();
  const transporter = config.email.enabled
    ? nodemailer.createTransport({
        service: config.email.service,
        auth: config.email.auth,
        connectionTimeout: DEFAULT_TIMEOUT_MS,
        greetingTimeout: DEFAULT_TIMEOUT_MS,
        socketTimeout: DEFAULT_TIMEOUT_MS,
      })
    : undefined;
  const webhook = config.webhook?.enabled === false ? undefined : config.webhook;
  let sending = false;
  let started = false;

  function reportFailure(target, message) {
    logger.error(message);
    failedTargets.add(target);
    const now = Date.now();
    const last = lastHandled.get(target);
    const cooldown = (target.ignore_period ?? 0) * 1000;
    if (last !== undefined && cooldown > 0 && now - last <= cooldown) {
      logger.log(`Ignoring repeat notification for ${target.url} during its cooldown.`);
      return;
    }
    queue.push({ subject: `Health check failed for ${target.name}`, text: message });
    lastHandled.set(target, now);
  }

  async function checkUrl(target) {
    if (controller.signal.aborted || inFlight.has(target)) {
      return;
    }
    inFlight.add(target);
    logger.log(`${new Date().toISOString()}: Checking ${target.url} ...`);
    try {
      const startedAt = performance.now();
      const response = await axios.get(target.url, {
        headers: target.headers,
        responseType: 'text',
        transformResponse: [(value) => value],
        validateStatus: () => true,
        maxRedirects:
          target.expectedStatusCode >= 300 && target.expectedStatusCode < 400 ? 0 : undefined,
        timeout: target.timeout ?? DEFAULT_TIMEOUT_MS,
        signal: controller.signal,
      });
      const elapsed = Math.round(performance.now() - startedAt);
      if (controller.signal.aborted) {
        return false;
      }
      logger.debug?.(`${target.name} responded with HTTP ${response.status} in ${elapsed} ms.`);
      if (response.status !== target.expectedStatusCode) {
        reportFailure(
          target,
          `${target.name} returned unexpected status code: ${response.status} (expected ${target.expectedStatusCode}).`,
        );
        return false;
      }
      if (target.expectedContent && !response.data.includes(target.expectedContent)) {
        reportFailure(
          target,
          `${target.name} returned unexpected content (expected text not found).`,
        );
        return false;
      }
      if (target.maxResponseTime !== undefined && elapsed > target.maxResponseTime) {
        reportFailure(
          target,
          `${target.name} responded too slowly: ${elapsed} ms (limit ${target.maxResponseTime} ms).`,
        );
        return false;
      }
      logger.log(`${target.url} - OK!`);
      if (failedTargets.delete(target) && target.notifyRecovery) {
        queue.push({
          subject: `Health check recovered for ${target.name}`,
          text: `${target.name} recovered and now passes its health check (status ${response.status}).`,
          recovery: true,
        });
        lastHandled.delete(target);
      }
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        reportFailure(target, `${target.name} could not be reached: ${error.message}`);
      }
      return false;
    } finally {
      inFlight.delete(target);
    }
  }

  async function flushNotification() {
    if (sending || queue.length === 0 || controller.signal.aborted) {
      return;
    }
    sending = true;
    const item = queue.shift();
    try {
      if (!transporter && !webhook) {
        const category = item.recovery ? 'Recovery' : 'Failure';
        logger.log(
          `Notification of ${category} Handled: subject=${item.subject}, text=${item.text}`,
        );
        return true;
      }
      let delivered = true;
      if (transporter) {
        try {
          await transporter.sendMail({
            from: config.email.auth.user,
            to: config.email.destination,
            subject: item.subject,
            text: item.text,
          });
          logger.log(`Email notification sent for ${item.subject}`);
        } catch (error) {
          logger.error(`Failed to send email notification: ${error.message}`);
          delivered = false;
        }
      }
      if (webhook && !controller.signal.aborted) {
        delivered = (await sendWebhook(item)) && delivered;
      }
      return delivered;
    } finally {
      sending = false;
    }
  }

  async function sendWebhook(item) {
    const summary = `${item.subject}\n${item.text}`;
    const payload =
      new URL(webhook.url).hostname === 'chat.googleapis.com'
        ? { text: summary }
        : {
            text: summary,
            content: summary,
            event: item.recovery ? 'recovery' : 'failure',
            subject: item.subject,
            message: item.text,
            timestamp: new Date().toISOString(),
          };
    try {
      await axios.post(webhook.url, payload, {
        headers: webhook.headers,
        maxRedirects: 0,
        timeout: DEFAULT_TIMEOUT_MS,
        signal: controller.signal,
      });
      logger.log(`Webhook notification sent for ${item.subject}`);
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.error(`Failed to send webhook notification: ${error.message}`);
      }
      return false;
    }
  }

  function start({ immediate = false } = {}) {
    if (started || controller.signal.aborted) {
      throw new Error('A monitor cannot be started twice or after stopping.');
    }
    started = true;
    for (const target of config.urls) {
      timers.push(setInterval(() => void checkUrl(target), target.interval * 1000));
      if (immediate) {
        void checkUrl(target);
      }
    }
    timers.push(setInterval(() => void flushNotification(), config.email.interval * 1000));
  }

  async function runOnce() {
    if (started || controller.signal.aborted) {
      throw new Error('Once mode requires a new monitor that has not been stopped.');
    }
    started = true;
    const results = await Promise.all(config.urls.map(checkUrl));
    let successful = results.every(Boolean);
    while (queue.length > 0 && !controller.signal.aborted) {
      successful = (await flushNotification()) && successful;
    }
    return successful;
  }

  function stop() {
    if (controller.signal.aborted) {
      return;
    }
    for (const timer of timers) {
      clearInterval(timer);
    }
    controller.abort();
    transporter?.close();
  }

  return { start, runOnce, stop };
}

async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: 'string', short: 'c' },
      'check-config': { type: 'boolean' },
      once: { type: 'boolean' },
      immediate: { type: 'boolean' },
      'log-level': { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node health-check.js [--config FILE] [--log-level LEVEL] [--immediate | --once | --check-config]\n' +
        '  --config FILE   Read configuration from FILE instead of the default config.json.\n' +
        '  --once          Check every URL once, deliver queued alerts, and exit.\n' +
        '  --immediate     Check immediately, then continue on the configured intervals.\n' +
        '  --check-config  Validate configuration without making network requests.\n' +
        '  --log-level     Minimum level: debug, info, warn, error, silent (default: info).\n' +
        '  --version       Print the application version.',
    );
    return;
  }
  if (values.version) {
    console.log(version);
    return;
  }
  if (values.once && values['check-config']) {
    throw new Error('--once and --check-config cannot be used together.');
  }
  if (values.immediate && (values.once || values['check-config'])) {
    throw new Error('--immediate is only available in continuous monitoring mode.');
  }
  if (values['log-level'] !== undefined) {
    requireLogLevel(values['log-level'], '--log-level');
  }
  const config = loadConfig(values.config);
  if (values['check-config']) {
    console.log('Configuration is valid.');
    return;
  }
  const logger = createLogger(values['log-level'] ?? config.logLevel ?? 'info');
  const monitor = createMonitor(config, { logger });
  function shutdown() {
    monitor.stop();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (values.once) {
    try {
      if (!(await monitor.runOnce())) {
        process.exitCode = 1;
      }
    } finally {
      shutdown();
    }
    return;
  }
  logger.info(`health-checks ${version}: monitoring ${config.urls.length} target(s).`);
  logger.info(
    values.immediate
      ? 'Initial checks run immediately. Press Ctrl+C to stop.'
      : 'First checks run after each configured interval. Press Ctrl+C to stop.',
  );
  monitor.start({ immediate: values.immediate });
}

if (require.main === module) {
  main().catch((error) => {
    createLogger('error').error(`health-checks: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createLogger, createMonitor, loadConfig, main, validateConfig };
