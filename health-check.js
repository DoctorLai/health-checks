const { readFileSync } = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { version } = require('./package.json');

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;

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

function validateConfig(config) {
  if (!isObject(config) || !Array.isArray(config.urls) || config.urls.length === 0) {
    throw new TypeError('urls must be a non-empty array.');
  }

  config.urls.forEach((target, index) => {
    const field = `urls[${index}]`;
    if (!isObject(target)) {
      throw new TypeError(`${field} must be an object.`);
    }
    requireString(target.name, `${field}.name`);
    requireString(target.url, `${field}.url`);
    let url;
    try {
      url = new URL(target.url);
    } catch {
      throw new TypeError(`${field}.url must be a valid HTTP(S) URL.`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new TypeError(`${field}.url must use HTTP or HTTPS.`);
    }
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
    if (target.notifyRecovery !== undefined && typeof target.notifyRecovery !== 'boolean') {
      throw new TypeError(`${field}.notifyRecovery must be a boolean.`);
    }
    if (
      target.ignore_period !== undefined &&
      (!Number.isFinite(target.ignore_period) || target.ignore_period < 0)
    ) {
      throw new TypeError(`${field}.ignore_period must be a non-negative number.`);
    }
    if (
      target.timeout !== undefined &&
      (!Number.isInteger(target.timeout) || target.timeout <= 0 || target.timeout > MAX_TIMER_MS)
    ) {
      throw new TypeError(
        `${field}.timeout must be a positive integer no greater than ${MAX_TIMER_MS}.`,
      );
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

function createMonitor(config, { logger = console } = {}) {
  validateConfig(config);
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
      const response = await axios.get(target.url, {
        responseType: 'text',
        transformResponse: [(value) => value],
        validateStatus: () => true,
        maxRedirects:
          target.expectedStatusCode >= 300 && target.expectedStatusCode < 400 ? 0 : undefined,
        timeout: target.timeout ?? DEFAULT_TIMEOUT_MS,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return false;
      }
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
      if (transporter) {
        await transporter.sendMail({
          from: config.email.auth.user,
          to: config.email.destination,
          subject: item.subject,
          text: item.text,
        });
        logger.log(`Email notification sent for ${item.subject}`);
      } else {
        const category = item.recovery ? 'Recovery' : 'Failure';
        logger.log(
          `Notification of ${category} Handled: subject=${item.subject}, text=${item.text}`,
        );
      }
      return true;
    } catch (error) {
      logger.error(`Failed to send email notification: ${error.message}`);
      return false;
    } finally {
      sending = false;
    }
  }

  function start() {
    if (started || controller.signal.aborted) {
      throw new Error('A monitor cannot be started twice or after stopping.');
    }
    started = true;
    for (const target of config.urls) {
      timers.push(setInterval(() => void checkUrl(target), target.interval * 1000));
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
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node health-check.js [--config FILE] [--once | --check-config]\n' +
        '  --once          Check every URL once, deliver queued alerts, and exit.\n' +
        '  --check-config  Validate configuration without making network requests.\n' +
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
  const config = loadConfig(values.config);
  if (values['check-config']) {
    console.log('Configuration is valid.');
    return;
  }
  const monitor = createMonitor(config);
  if (values.once) {
    try {
      if (!(await monitor.runOnce())) {
        process.exitCode = 1;
      }
    } finally {
      monitor.stop();
    }
    return;
  }
  function shutdown() {
    monitor.stop();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  monitor.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`health-checks: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createMonitor, loadConfig, main, validateConfig };
