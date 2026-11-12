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

async function writeConfig(route, overrides = {}) {
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
    }),
  );
  return filename;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'health-checks-integration-'));
  server = createServer((request, response) => {
    requests.push(request.url);
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
    expect(result.stdout).toContain('Configuration is valid.');
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
