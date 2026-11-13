import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let directory;
let server;
let origin;
let requests;
let webhookBodies;
let nextFile = 0;

function startCli(args) {
  const child = spawn(process.execPath, ['health-check.js', ...args], {
    cwd: root,
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (data) => {
    output.stdout += data;
  });
  child.stderr.on('data', (data) => {
    output.stderr += data;
  });
  const completion = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('The health-check CLI did not exit within five seconds.'));
    }, 5000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      children.delete(child);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      children.delete(child);
      resolve({ ...output, code, signal });
    });
  });
  return { child, output, completion };
}

async function writeConfig(route, overrides = {}, settings = {}) {
  const filename = path.join(directory, `config-${nextFile++}.json`);
  await writeFile(
    filename,
    JSON.stringify({
      urls: [
        {
          name: 'Local endpoint',
          url: `${origin}${route}`,
          interval: 0.05,
          expectedStatusCode: 200,
          expectedContent: 'healthy',
          timeout: 1000,
          ...overrides,
        },
      ],
      email: { enabled: false, interval: 0.05 },
      ...settings,
    }),
  );
  return filename;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'health-checks-integration-'));
  server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/webhook' && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        webhookBodies.push({ headers: request.headers, body: JSON.parse(body) });
        response.end('ok');
      });
      return;
    }
    if (request.url === '/slow') {
      return;
    }
    if (request.url === '/missing') {
      response.writeHead(404);
      response.end('not-found');
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/healthy' });
      response.end('redirecting');
      return;
    }
    if (request.url === '/unhealthy') {
      response.writeHead(503);
      response.end('sensitive upstream response');
      return;
    }
    if (request.url === '/authenticated') {
      const authorized =
        request.headers.authorization === 'Bearer test-only-token' &&
        request.headers['x-health-check'] === 'monitor';
      response.writeHead(authorized ? 200 : 401);
      response.end(authorized ? 'healthy' : 'unauthorized');
      return;
    }
    if (request.url === '/recovers') {
      const failed = requests.filter((url) => url === '/recovers').length === 1;
      response.writeHead(failed ? 503 : 200);
      response.end(failed ? 'unavailable' : 'healthy');
      return;
    }
    if (request.url === '/json') {
      response.setHeader('content-type', 'application/json');
      response.end('{"healthy":true}');
      return;
    }
    response.end('healthy');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  requests = [];
  webhookBodies = [];
});

afterEach(async () => {
  const exited = [];
  for (const child of children) {
    exited.push(new Promise((resolve) => child.once('close', resolve)));
    child.kill('SIGTERM');
  }
  await Promise.all(exited);
  server.closeAllConnections();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

describe('real HTTP and CLI behavior', () => {
  it.each([
    ['/healthy', {}],
    ['/missing', { expectedStatusCode: 404, expectedContent: 'not-found' }],
    ['/json', { expectedContent: '"healthy":true' }],
  ])('accepts the configured status and raw content from %s', async (route, overrides) => {
    const config = await writeConfig(route, overrides);
    const result = await startCli(['--config', config, '--once']).completion;
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`${origin}${route} - OK!`);
    expect(result.stdout).not.toContain('monitoring');
    expect(requests).toEqual([route]);
  });

  it('accepts an expected redirect without following its Location', async () => {
    const config = await writeConfig('/redirect', {
      expectedStatusCode: 302,
      expectedContent: 'redirecting',
    });
    const result = await startCli(['--config', config, '--once']).completion;
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`${origin}/redirect - OK!`);
    expect(requests).toEqual(['/redirect']);
  });

  it.each([
    ['test-only-token', 0],
    ['wrong-token', 1],
  ])('sends configured headers without logging the %s credential', async (token, code) => {
    const config = await writeConfig('/authenticated', {
      headers: { Authorization: `Bearer ${token}`, 'X-Health-Check': 'monitor' },
    });
    const result = await startCli(['--config', config, '--once', '--log-level', 'debug'])
      .completion;
    expect(result.code).toBe(code);
    expect(requests).toEqual(['/authenticated']);
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
    expect(`${result.stdout}${result.stderr}`).toContain(`HTTP ${code === 0 ? 200 : 401}`);
  });

  it('rejects invalid headers without echoing their values or contacting endpoints', async () => {
    const config = await writeConfig('/authenticated', {
      headers: { Authorization: 'Bearer private-test-value\r\nInjected: true' },
    });
    const result = await startCli(['--config', config, '--check-config']).completion;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('urls[0].headers');
    expect(result.stderr).not.toContain('private-test-value');
    expect(requests).toEqual([]);
  });

  it('uses the configured threshold and lets the CLI override it', async () => {
    const config = await writeConfig('/healthy', {}, { logLevel: 'error' });
    const quiet = await startCli(['--config', config, '--once']).completion;
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).toBe('');
    expect(quiet.stderr).toBe('');
    const verbose = await startCli(['--config', config, '--once', '--log-level', 'debug'])
      .completion;
    expect(verbose.code).toBe(0);
    expect(verbose.stdout).toMatch(/\[DEBUG\] Local endpoint responded with HTTP 200 in \d+ ms\./);
    expect(verbose.stdout).toContain(`[INFO] ${origin}/healthy - OK!`);
    expect(verbose.stderr).toBe('');
  });

  it('shows only failures at error level', async () => {
    const config = await writeConfig('/unhealthy');
    const result = await startCli(['--config', config, '--once', '--log-level', 'error'])
      .completion;
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[ERROR] Local endpoint returned unexpected status code: 503');
  });

  it('keeps an unhealthy exit code even when logs are silent', async () => {
    const config = await writeConfig('/unhealthy');
    const result = await startCli(['--config', config, '--once', '--log-level', 'silent'])
      .completion;
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('keeps startup validation errors visible in silent mode', async () => {
    const config = await writeConfig('/healthy', { interval: 0 });
    const result = await startCli(['--config', config, '--once', '--log-level', 'silent'])
      .completion;
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[ERROR] health-checks: urls[0].interval');
    expect(requests).toEqual([]);
  });

  it('rejects an invalid CLI level before reading configuration', async () => {
    const result = await startCli([
      '--config',
      path.join(directory, 'missing.json'),
      '--log-level',
      'verbose',
    ]).completion;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--log-level must be one of:');
    expect(result.stderr).not.toContain('Could not read configuration');
    expect(requests).toEqual([]);
  });

  it('posts failure alerts to a configured webhook in once mode', async () => {
    const config = await writeConfig(
      '/unhealthy',
      {},
      { webhook: { url: `${origin}/webhook`, headers: { 'X-Webhook-Token': 'hook-secret' } } },
    );
    const result = await startCli(['--config', config, '--once']).completion;
    expect(result.code).toBe(1);
    expect(requests).toEqual(['/unhealthy', '/webhook']);
    expect(webhookBodies).toHaveLength(1);
    expect(webhookBodies[0].headers['x-webhook-token']).toBe('hook-secret');
    expect(webhookBodies[0].body).toMatchObject({
      event: 'failure',
      subject: 'Health check failed for Local endpoint',
    });
    expect(result.stdout).toContain('Webhook notification sent for Health check failed');
    expect(`${result.stdout}${result.stderr}`).not.toContain('hook-secret');
  });

  it('exits unsuccessfully and prints an alert for an unexpected status', async () => {
    const config = await writeConfig('/unhealthy');
    const result = await startCli(['--config', config, '--once']).completion;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unexpected status code: 503');
    expect(result.stdout).toContain('Notification of Failure Handled:');
    expect(`${result.stdout}${result.stderr}`).not.toContain('sensitive upstream response');
  });

  it('times out a nonresponsive endpoint', async () => {
    const config = await writeConfig('/slow', { timeout: 25 });
    const result = await startCli(['--config', config, '--once']).completion;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('timeout of 25ms exceeded');
    expect(requests).toEqual(['/slow']);
  });

  it('validates configuration without contacting the endpoint', async () => {
    const config = await writeConfig('/healthy');
    const result = await startCli(['--config', config, '--check-config']).completion;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Configuration is valid.\n');
    expect(requests).toEqual([]);
  });

  it('reports startup validation errors without making HTTP requests', async () => {
    const config = await writeConfig('/healthy', { interval: 0 });
    const result = await startCli(['--config', config, '--once']).completion;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('health-checks: urls[0].interval');
    expect(requests).toEqual([]);
  });

  it('reports a missing configuration file with a failing exit code', async () => {
    const result = await startCli(['--config', path.join(directory, 'missing.json'), '--once'])
      .completion;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Could not read configuration');
    expect(requests).toEqual([]);
  });

  it('prints startup status before the first polling interval', async () => {
    const config = await writeConfig('/healthy', { interval: 60 });
    const running = startCli(['--config', config]);
    await vi.waitFor(() => expect(running.output.stdout).toContain('monitoring 1 target(s)'), {
      timeout: 2000,
    });
    expect(running.output.stdout).toContain('First checks run after each configured interval.');
    expect(requests).toEqual([]);
    running.child.kill('SIGTERM');
    const result = await running.completion;
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('can begin continuous monitoring immediately despite a long polling interval', async () => {
    const config = await writeConfig('/healthy', { interval: 60 });
    const running = startCli(['--config', config, '--immediate']);
    await vi.waitFor(() => expect(requests).toContain('/healthy'), { timeout: 2000 });
    expect(running.output.stdout).toContain('Initial checks run immediately.');
    running.child.kill('SIGTERM');
    const result = await running.completion;
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('suppresses startup and healthy-check messages at error level', async () => {
    const config = await writeConfig('/healthy');
    const running = startCli(['--config', config, '--log-level', 'error']);
    await vi.waitFor(() => expect(requests).toContain('/healthy'), { timeout: 2000 });
    running.child.kill('SIGTERM');
    const result = await running.completion;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('stops cleanly on SIGTERM while an HTTP request is in flight', async () => {
    const config = await writeConfig('/slow', { timeout: 10_000 });
    const running = startCli(['--config', config]);
    await vi.waitFor(() => expect(requests).toContain('/slow'), { timeout: 2000 });
    expect(running.output.stdout).toContain('Checking');
    running.child.kill('SIGTERM');
    const result = await running.completion;
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('Notification of Failure Handled:');
  });

  it.each(['SIGINT', 'SIGTERM'])(
    'cancels a once-mode HTTP check cleanly on %s with an unsuccessful exit code',
    async (signal) => {
      const config = await writeConfig('/slow', { timeout: 10_000 });
      const running = startCli(['--config', config, '--once']);
      await vi.waitFor(() => expect(requests).toContain('/slow'), { timeout: 2000 });
      running.child.kill(signal);
      const result = await running.completion;
      expect(result.code).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('Notification of Failure Handled:');
    },
  );

  it('reports an endpoint recovery during continuous monitoring', async () => {
    const config = await writeConfig('/recovers', { notifyRecovery: true, ignore_period: 60 });
    const running = startCli(['--config', config]);
    await vi.waitFor(
      () => expect(running.output.stdout).toContain('Health check recovered for Local endpoint'),
      { timeout: 2000 },
    );
    running.child.kill('SIGTERM');
    const result = await running.completion;
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('unexpected status code: 503');
    expect(result.stdout).toContain(
      'Notification of Failure Handled: subject=Health check failed for Local endpoint',
    );
    expect(result.stdout).toContain(
      'Notification of Recovery Handled: subject=Health check recovered for Local endpoint',
    );
    expect(requests.filter((url) => url === '/recovers').length).toBeGreaterThanOrEqual(2);
  });
});
