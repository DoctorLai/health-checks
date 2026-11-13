import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const axios = require('axios');
const nodemailer = require('nodemailer');
const {
  createLogger,
  createMonitor,
  loadConfig,
  main,
  validateConfig,
} = require('../health-check.js');

function configuration() {
  return {
    urls: [
      {
        name: 'Example',
        url: 'https://example.com',
        interval: 1,
        expectedStatusCode: 200,
        expectedContent: 'online',
        ignore_period: 2,
      },
    ],
    email: {
      enabled: false,
      interval: 0.25,
    },
  };
}

describe('configuration', () => {
  it('accepts console-only configuration without SMTP credentials', () => {
    const config = configuration();
    expect(() => validateConfig(config)).not.toThrow();
  });

  it.each([
    [null, 'urls must be a non-empty array'],
    [{ urls: [] }, 'urls must be a non-empty array'],
    [{ urls: [null] }, 'urls[0] must be an object'],
  ])('rejects invalid configuration structure: %j', (config, message) => {
    expect(() => validateConfig(config)).toThrow(message);
  });

  it.each(['verbose', null, 1, 'constructor'])('rejects invalid logLevel %j', (logLevel) => {
    expect(() => validateConfig({ ...configuration(), logLevel })).toThrow(
      'logLevel must be one of: debug, info, warn, error, silent.',
    );
  });

  it.each([
    ['name', ' ', 'name'],
    ['url', null, 'url'],
    ['url', 'not-a-url', 'valid HTTP(S) URL'],
    ['url', 'file:///etc/hosts', 'HTTP or HTTPS'],
    ['interval', 0, 'interval'],
    ['interval', '60', 'interval'],
    ['interval', 2_147_484, 'interval'],
    ['expectedStatusCode', 99, 'expectedStatusCode'],
    ['expectedStatusCode', 600, 'expectedStatusCode'],
    ['expectedStatusCode', 200.5, 'expectedStatusCode'],
    ['expectedContent', false, 'expectedContent'],
    ['headers', null, 'headers'],
    ['headers', [], 'headers'],
    ['headers', 'Authorization: token', 'headers'],
    ['headers', { Authorization: 123 }, 'headers'],
    ['headers', { 'Invalid Header': 'value' }, 'headers'],
    ['headers', { Authorization: 'Bearer test-token\r\nInjected: true' }, 'headers'],
    ['notifyRecovery', 'true', 'notifyRecovery'],
    ['ignore_period', -1, 'ignore_period'],
    ['ignore_period', Infinity, 'ignore_period'],
    ['timeout', 0, 'timeout'],
    ['timeout', 2_147_483_648, 'timeout'],
    ['timeout', 1.5, 'timeout'],
    ['maxResponseTime', 0, 'maxResponseTime'],
    ['maxResponseTime', '500', 'maxResponseTime'],
    ['maxResponseTime', 2.5, 'maxResponseTime'],
  ])('rejects invalid %s value %j', (key, value, message) => {
    const config = configuration();
    config.urls[0][key] = value;
    expect(() => validateConfig(config)).toThrow(message);
  });

  it('validates email settings only when delivery is enabled', () => {
    const config = configuration();
    config.email.enabled = 'false';
    expect(() => validateConfig(config)).toThrow('email.enabled');
    config.email.enabled = false;
    config.email.interval = -1;
    expect(() => validateConfig(config)).toThrow('email.interval');
    config.email.interval = 1;
    config.email.enabled = true;
    expect(() => validateConfig(config)).toThrow('email.service');
    config.email.service = 'Gmail';
    expect(() => validateConfig(config)).toThrow('email.auth.user');
    config.email.auth = { user: 'sender@example.com' };
    expect(() => validateConfig(config)).toThrow('email.auth.pass');
    config.email.auth.pass = 'test-password';
    expect(() => validateConfig(config)).toThrow('email.destination');
    config.email.destination = 'recipient@example.com';
    expect(() => validateConfig(config)).not.toThrow();
  });

  it.each([
    [null, 'webhook must be an object'],
    [{ url: 'https://hooks.example.com', enabled: 'yes' }, 'webhook.enabled'],
    [{}, 'webhook.url'],
    [{ url: 'ftp://hooks.example.com/secret-path' }, 'webhook.url must use HTTP or HTTPS'],
    [{ url: 'https://hooks.example.com', headers: { 'Bad Header': 'x' } }, 'webhook.headers'],
  ])('rejects invalid webhook settings %j', (webhook, message) => {
    expect(() => validateConfig({ ...configuration(), webhook })).toThrow(message);
  });

  it('does not echo webhook URLs in validation errors', () => {
    expect(() =>
      validateConfig({ ...configuration(), webhook: { url: 'not a url secret-token' } }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('secret-token') }));
  });

  it('accepts a disabled webhook without a URL', () => {
    expect(() => validateConfig({ ...configuration(), webhook: { enabled: false } })).not.toThrow();
  });

  it('reports unreadable files and malformed JSON without echoing configuration secrets', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'health-checks-config-'));
    try {
      const filename = path.join(directory, 'config.json');
      expect(() => loadConfig(filename)).toThrow('Could not read configuration');
      writeFileSync(filename, '{"password":"test-private-value"');
      expect(() => loadConfig(filename)).toThrow('not valid JSON');
      try {
        loadConfig(filename);
      } catch (error) {
        expect(error.message).not.toContain('test-private-value');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('log levels', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    ['debug', ['[DEBUG] details', '[INFO] progress'], ['[WARN] warning'], ['[ERROR] failure']],
    ['info', ['[INFO] progress'], ['[WARN] warning'], ['[ERROR] failure']],
    ['warn', [], ['[WARN] warning'], ['[ERROR] failure']],
    ['error', [], [], ['[ERROR] failure']],
    ['silent', [], [], []],
  ])(
    'filters %s logs and routes messages to the correct streams',
    (level, info, warnings, errors) => {
      const logger = createLogger(level);
      logger.debug('details');
      logger.info('progress');
      logger.warn('warning');
      logger.error('failure');
      expect(console.log.mock.calls).toEqual(info.map((message) => [message]));
      expect(console.warn.mock.calls).toEqual(warnings.map((message) => [message]));
      expect(console.error.mock.calls).toEqual(errors.map((message) => [message]));
    },
  );

  it('rejects an unsupported logging threshold instead of falling back silently', () => {
    expect(() => createLogger('verbose')).toThrow('logLevel must be one of:');
  });
});

describe('monitor', () => {
  let logger;
  let transport;
  let monitors;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    logger = { log: vi.fn(), error: vi.fn() };
    transport = { sendMail: vi.fn().mockResolvedValue({}), close: vi.fn() };
    monitors = [];
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: 'service online' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue(transport);
  });

  afterEach(() => {
    for (const monitor of monitors) {
      monitor.stop();
    }
    vi.useRealTimers();
  });

  function monitorFor(config = configuration()) {
    const monitor = createMonitor(config, { logger });
    monitors.push(monitor);
    return monitor;
  }

  it('checks status and content successfully without creating an SMTP transport in console mode', async () => {
    expect(await monitorFor().runOnce()).toBe(true);
    expect(logger.log).toHaveBeenCalledWith('https://example.com - OK!');
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses the configured log level when no custom logger is supplied', async () => {
    const config = configuration();
    config.logLevel = 'debug';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const monitor = createMonitor(config);
    monitors.push(monitor);
    expect(await monitor.runOnce()).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[DEBUG\] Example responded with HTTP 200 in \d+ ms\.$/),
    );
    expect(console.log).toHaveBeenCalledWith('[INFO] https://example.com - OK!');
  });

  it('keeps sending alerts when monitoring logs are silent', async () => {
    const config = configuration();
    config.logLevel = 'silent';
    config.email = {
      ...config.email,
      enabled: true,
      service: 'Gmail',
      auth: { user: 'sender@example.com', pass: 'test-password' },
      destination: 'recipient@example.com',
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    axios.get.mockRejectedValue(new Error('connection refused'));
    const monitor = createMonitor(config);
    monitors.push(monitor);
    expect(await monitor.runOnce()).toBe(false);
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('reports unexpected statuses and drains console notifications in once mode', async () => {
    axios.get.mockResolvedValue({ status: 503, data: 'unavailable' });
    expect(await monitorFor().runOnce()).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Example returned unexpected status code: 503 (expected 200).',
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'Notification of Failure Handled: subject=Health check failed for Example',
      ),
    );
  });

  it('reports missing expected content without logging the response body', async () => {
    logger.debug = vi.fn();
    axios.get.mockResolvedValue({ status: 200, data: 'sensitive-response-body' });
    expect(await monitorFor().runOnce()).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('unexpected content'));
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('sensitive-response-body');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sensitive-response-body');
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('sensitive-response-body');
  });

  it('allows an empty or omitted content expectation', async () => {
    const config = configuration();
    config.urls[0].expectedContent = '';
    axios.get.mockResolvedValue({ status: 200, data: '' });
    expect(await monitorFor(config).runOnce()).toBe(true);
    delete config.urls[0].expectedContent;
    expect(await monitorFor(config).runOnce()).toBe(true);
  });

  it('reports network errors and applies the configured request timeout', async () => {
    const config = configuration();
    config.urls[0].timeout = 2500;
    axios.get.mockRejectedValue(new Error('timeout of 2500ms exceeded'));
    expect(await monitorFor(config).runOnce()).toBe(false);
    expect(axios.get).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ timeout: 2500, responseType: 'text' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Example could not be reached: timeout of 2500ms exceeded',
    );
  });

  it('preserves the first-check interval and suppresses repeat alerts through the cooldown boundary', async () => {
    const config = configuration();
    const original = structuredClone(config);
    axios.get.mockResolvedValue({ status: 500, data: '' });
    monitorFor(config).start();
    await vi.advanceTimersByTimeAsync(999);
    expect(axios.get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3501);
    expect(axios.get).toHaveBeenCalledTimes(4);
    const notifications = logger.log.mock.calls.filter(([text]) =>
      text.startsWith('Notification of Failure Handled:'),
    );
    expect(notifications).toHaveLength(2);
    expect(config).toEqual(original);
  });

  it('keeps cooldowns independent for two checks of the same URL', async () => {
    const config = configuration();
    config.urls.push({ ...config.urls[0], name: 'Second check' });
    axios.get.mockResolvedValue({ status: 500, data: '' });
    expect(await monitorFor(config).runOnce()).toBe(false);
    const notifications = logger.log.mock.calls.filter(([text]) =>
      text.startsWith('Notification of Failure Handled:'),
    );
    expect(notifications).toHaveLength(2);
    expect(notifications[1][0]).toContain('Second check');
  });

  it('can check every target immediately without changing their recurring intervals', async () => {
    const config = configuration();
    config.urls.push({ ...config.urls[0], name: 'Second check', interval: 2 });
    monitorFor(config).start({ immediate: true });
    expect(axios.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(axios.get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(axios.get).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(axios.get).toHaveBeenCalledTimes(5);
  });

  it('paces notifications independently of URL checks and permits zero cooldown', async () => {
    const config = configuration();
    config.urls[0].ignore_period = 0;
    config.email.interval = 3;
    axios.get.mockResolvedValue({ status: 500, data: '' });
    monitorFor(config).start();
    await vi.advanceTimersByTimeAsync(6500);
    expect(axios.get).toHaveBeenCalledTimes(6);
    expect(
      logger.log.mock.calls.filter(([text]) => text.startsWith('Notification of Failure Handled:')),
    ).toHaveLength(2);
  });

  it.each([undefined, false])(
    'preserves failure-only notifications and cooldowns when notifyRecovery is %s',
    async (notifyRecovery) => {
      const config = configuration();
      config.urls[0].notifyRecovery = notifyRecovery;
      config.urls[0].ignore_period = 60;
      axios.get
        .mockResolvedValueOnce({ status: 500, data: '' })
        .mockResolvedValueOnce({ status: 200, data: 'online' })
        .mockResolvedValue({ status: 500, data: '' });
      monitorFor(config).start();
      await vi.advanceTimersByTimeAsync(3500);
      const notifications = logger.log.mock.calls.filter(([text]) =>
        text.startsWith('Notification of'),
      );
      expect(notifications).toHaveLength(1);
      expect(notifications[0][0]).toContain('Health check failed for Example');
    },
  );

  it('does not send a recovery notification for an initially healthy target', async () => {
    const config = configuration();
    config.urls[0].notifyRecovery = true;
    expect(await monitorFor(config).runOnce()).toBe(true);
    expect(logger.log.mock.calls.some(([text]) => text.startsWith('Notification of'))).toBe(false);
  });

  it('notifies once after full recovery and alerts immediately for a new incident', async () => {
    const config = configuration();
    config.urls[0].notifyRecovery = true;
    config.urls[0].ignore_period = 60;
    axios.get
      .mockResolvedValueOnce({ status: 500, data: '' })
      .mockResolvedValueOnce({ status: 200, data: 'wrong content' })
      .mockResolvedValueOnce({ status: 200, data: 'online' })
      .mockResolvedValueOnce({ status: 200, data: 'online' })
      .mockResolvedValue({ status: 500, data: '' });
    monitorFor(config).start();
    await vi.advanceTimersByTimeAsync(4500);
    const notifications = () =>
      logger.log.mock.calls.filter(([text]) => text.startsWith('Notification of'));
    expect(notifications()).toHaveLength(2);
    expect(notifications()[0][0]).toContain('Health check failed for Example');
    expect(notifications()[1][0]).toContain(
      'Notification of Recovery Handled: subject=Health check recovered for Example',
    );
    expect(logger.error).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(notifications()).toHaveLength(3);
    expect(notifications()[2][0]).toContain('Health check failed for Example');
  });

  it('sends recovery emails through the normal notification queue without internal metadata', async () => {
    const config = configuration();
    config.urls[0].notifyRecovery = true;
    config.email = {
      ...config.email,
      enabled: true,
      service: 'Gmail',
      auth: { user: 'sender@example.com', pass: 'test-password' },
      destination: 'recipient@example.com',
    };
    axios.get.mockRejectedValueOnce(new Error('connection refused'));
    monitorFor(config).start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(transport.sendMail).toHaveBeenCalledTimes(2);
    expect(transport.sendMail).toHaveBeenNthCalledWith(2, {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Health check recovered for Example',
      text: 'Example recovered and now passes its health check (status 200).',
    });
  });

  it('does not overlap slow checks and aborts in-flight requests on stop', async () => {
    let rejectRequest;
    axios.get.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const monitor = monitorFor();
    monitor.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(axios.get).toHaveBeenCalledTimes(1);
    const signal = axios.get.mock.calls[0][1].signal;
    monitor.stop();
    expect(signal.aborted).toBe(true);
    rejectRequest(new Error('canceled'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a response that arrives after shutdown', async () => {
    let resolveRequest;
    axios.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const monitor = monitorFor();
    const result = monitor.runOnce();
    monitor.stop();
    resolveRequest({ status: 200, data: 'online' });
    expect(await result).toBe(false);
    expect(logger.log).not.toHaveBeenCalledWith('https://example.com - OK!');
  });

  it('sends email alerts using the configured sender and destination', async () => {
    const config = configuration();
    config.email = {
      ...config.email,
      enabled: true,
      service: 'Gmail',
      auth: { user: 'sender@example.com', pass: 'test-password' },
      destination: 'recipient@example.com',
    };
    axios.get.mockRejectedValue(new Error('connection refused'));
    expect(await monitorFor(config).runOnce()).toBe(false);
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Health check failed for Example',
      text: 'Example could not be reached: connection refused',
    });
    expect(logger.log).toHaveBeenCalledWith(
      'Email notification sent for Health check failed for Example',
    );
  });

  it('logs SMTP failures and does not send overlapping email requests', async () => {
    const config = configuration();
    config.urls[0].ignore_period = 0;
    config.email = {
      enabled: true,
      interval: 1,
      service: 'Gmail',
      auth: { user: 'sender@example.com', pass: 'test-password' },
      destination: 'recipient@example.com',
    };
    let rejectEmail;
    transport.sendMail.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          rejectEmail = reject;
        }),
    );
    axios.get.mockResolvedValue({ status: 500, data: '' });
    monitorFor(config).start();
    await vi.advanceTimersByTimeAsync(3500);
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    rejectEmail(new Error('SMTP unavailable'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to send email notification: SMTP unavailable',
    );
    expect(transport.sendMail).toHaveBeenCalledTimes(2);
  });

  it('closes the SMTP transport only once when shutdown is repeated', () => {
    const config = configuration();
    config.email = {
      ...config.email,
      enabled: true,
      service: 'Gmail',
      auth: { user: 'sender@example.com', pass: 'test-password' },
      destination: 'recipient@example.com',
    };
    const monitor = monitorFor(config);
    monitor.stop();
    monitor.stop();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    [750, false],
    [500, true],
  ])('enforces maxResponseTime of 500 ms for a %i ms response', async (elapsed, healthy) => {
    const config = configuration();
    config.urls[0].maxResponseTime = 500;
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000 + elapsed);
    expect(await monitorFor(config).runOnce()).toBe(healthy);
    if (healthy) {
      expect(logger.error).not.toHaveBeenCalled();
    } else {
      expect(logger.error).toHaveBeenCalledWith(
        'Example responded too slowly: 750 ms (limit 500 ms).',
      );
    }
  });

  describe('webhook notifications', () => {
    const webhookUrl = 'https://hooks.example.com/services/secret-token';

    beforeEach(() => {
      vi.spyOn(axios, 'post').mockResolvedValue({ status: 200 });
      axios.get.mockRejectedValue(new Error('connection refused'));
    });

    it('posts a chat-compatible JSON payload with configured headers', async () => {
      const config = configuration();
      config.webhook = { url: webhookUrl, headers: { 'X-Token': 'webhook-secret' } };
      expect(await monitorFor(config).runOnce()).toBe(false);
      expect(axios.post).toHaveBeenCalledWith(
        webhookUrl,
        {
          text: 'Health check failed for Example\nExample could not be reached: connection refused',
          content:
            'Health check failed for Example\nExample could not be reached: connection refused',
          event: 'failure',
          subject: 'Health check failed for Example',
          message: 'Example could not be reached: connection refused',
          timestamp: '2026-11-12T12:00:00.000Z',
        },
        expect.objectContaining({
          headers: { 'X-Token': 'webhook-secret' },
          maxRedirects: 0,
          timeout: 10_000,
        }),
      );
      expect(logger.log).toHaveBeenCalledWith(
        'Webhook notification sent for Health check failed for Example',
      );
      expect(logger.log.mock.calls.some(([text]) => text.startsWith('Notification of'))).toBe(
        false,
      );
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain('secret-token');
    });

    it('sends only the text field to Google Chat', async () => {
      const googleChatUrl =
        'https://chat.googleapis.com/v1/spaces/space/messages?key=test-key&token=test-token';
      axios.post.mockImplementation(async (url, payload) => {
        if (
          new URL(url).hostname === 'chat.googleapis.com' &&
          Object.keys(payload).some((field) => field !== 'text')
        ) {
          throw new Error('Google Chat rejects unknown message fields');
        }
        return { status: 200 };
      });
      const config = configuration();
      config.webhook = { url: googleChatUrl };

      expect(await monitorFor(config).runOnce()).toBe(false);
      expect(axios.post).toHaveBeenCalledWith(
        googleChatUrl,
        {
          text: 'Health check failed for Example\nExample could not be reached: connection refused',
        },
        expect.objectContaining({ timeout: 10_000 }),
      );
      expect(logger.log).toHaveBeenCalledWith(
        'Webhook notification sent for Health check failed for Example',
      );
    });

    it('marks recovery events', async () => {
      const config = configuration();
      config.urls[0].notifyRecovery = true;
      config.webhook = { url: webhookUrl };
      axios.get.mockReset().mockRejectedValueOnce(new Error('down'));
      axios.get.mockResolvedValue({ status: 200, data: 'online' });
      monitorFor(config).start();
      await vi.advanceTimersByTimeAsync(2500);
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post.mock.calls[1][1]).toMatchObject({
        event: 'recovery',
        subject: 'Health check recovered for Example',
      });
    });

    it('delivers to both email and webhook and reports a webhook failure', async () => {
      const config = configuration();
      config.email = {
        ...config.email,
        enabled: true,
        service: 'Gmail',
        auth: { user: 'sender@example.com', pass: 'test-password' },
        destination: 'recipient@example.com',
      };
      config.webhook = { url: webhookUrl };
      axios.post.mockRejectedValue(new Error('Request failed with status code 404'));
      expect(await monitorFor(config).runOnce()).toBe(false);
      expect(transport.sendMail).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send webhook notification: Request failed with status code 404',
      );
    });

    it('still posts the webhook when email delivery fails', async () => {
      const config = configuration();
      config.email = {
        ...config.email,
        enabled: true,
        service: 'Gmail',
        auth: { user: 'sender@example.com', pass: 'test-password' },
        destination: 'recipient@example.com',
      };
      config.webhook = { url: webhookUrl };
      transport.sendMail.mockRejectedValue(new Error('SMTP unavailable'));
      expect(await monitorFor(config).runOnce()).toBe(false);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send email notification: SMTP unavailable',
      );
    });

    it('falls back to console notifications when the webhook is disabled', async () => {
      const config = configuration();
      config.webhook = { enabled: false, url: webhookUrl };
      expect(await monitorFor(config).runOnce()).toBe(false);
      expect(axios.post).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Notification of Failure Handled:'),
      );
    });

    it('does not log a webhook error after shutdown aborts delivery', async () => {
      const config = configuration();
      config.webhook = { url: webhookUrl };
      let rejectPost;
      axios.post.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            rejectPost = reject;
          }),
      );
      const monitor = monitorFor(config);
      const result = monitor.runOnce();
      await vi.waitFor(() => expect(axios.post).toHaveBeenCalled());
      monitor.stop();
      rejectPost(new Error('canceled'));
      expect(await result).toBe(false);
      expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('webhook'));
    });
  });

  it('does not permit restarting a running or stopped monitor', () => {
    const monitor = monitorFor();
    monitor.start();
    expect(() => monitor.start()).toThrow('cannot be started twice');
    monitor.stop();
    expect(() => monitor.start()).toThrow('after stopping');
  });

  it('rejects once mode on an active, completed, or stopped monitor', async () => {
    const active = monitorFor();
    active.start();
    await expect(active.runOnce()).rejects.toThrow('Once mode requires a new');
    const completed = monitorFor();
    expect(await completed.runOnce()).toBe(true);
    await expect(completed.runOnce()).rejects.toThrow('Once mode requires a new');
    const stopped = monitorFor();
    stopped.stop();
    await expect(stopped.runOnce()).rejects.toThrow('Once mode requires a new');
  });
});

describe('command-line entry point', () => {
  let directory;
  let filename;
  let previousExitCode;

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'health-checks-cli-'));
    filename = path.join(directory, 'config.json');
    writeFileSync(filename, JSON.stringify(configuration()));
    previousExitCode = process.exitCode;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
    rmSync(directory, { recursive: true, force: true });
  });

  it('prints help and version without requiring configuration', async () => {
    await main(['--help']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    await main(['--version']);
    expect(console.log).toHaveBeenCalledWith(require('../package.json').version);
  });

  it('validates an explicit configuration without making network requests', async () => {
    vi.spyOn(axios, 'get');
    await main(['--config', filename, '--check-config']);
    expect(console.log).toHaveBeenCalledWith('Configuration is valid.');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('keeps configuration-check output visible in silent mode', async () => {
    vi.spyOn(axios, 'get');
    await main(['--config', filename, '--check-config', '--log-level', 'silent']);
    expect(console.log).toHaveBeenCalledWith('Configuration is valid.');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('sets a failing exit code for an unhealthy once-mode check', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 503, data: '' });
    await main(['-c', filename, '--once']);
    expect(process.exitCode).toBe(1);
  });

  it('leaves the exit code unchanged for healthy once-mode checks', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: 'online' });
    await main(['-c', filename, '--once']);
    expect(process.exitCode).toBe(previousExitCode);
  });

  it('registers shutdown handlers and removes them after stopping', async () => {
    vi.useFakeTimers();
    const previousHandlers = new Set(process.listeners('SIGTERM'));
    try {
      await main(['--config', filename]);
      const shutdown = process
        .listeners('SIGTERM')
        .find((handler) => !previousHandlers.has(handler));
      expect(shutdown).toBeTypeOf('function');
      expect(vi.getTimerCount()).toBe(2);
      shutdown();
      expect(vi.getTimerCount()).toBe(0);
      expect(process.listeners('SIGTERM')).not.toContain(shutdown);
      expect(process.listeners('SIGINT')).not.toContain(shutdown);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects unknown command-line options', async () => {
    await expect(main(['--unknown-option'])).rejects.toThrow('Unknown option');
  });

  it('rejects conflicting modes instead of silently ignoring an option', async () => {
    vi.spyOn(axios, 'get');
    await expect(main(['--once', '--check-config'])).rejects.toThrow('cannot be used together');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it.each(['--once', '--check-config'])(
    'rejects --immediate with %s before making network requests',
    async (mode) => {
      vi.spyOn(axios, 'get');
      await expect(main(['--immediate', mode])).rejects.toThrow(
        '--immediate is only available in continuous monitoring mode.',
      );
      expect(axios.get).not.toHaveBeenCalled();
    },
  );
});
