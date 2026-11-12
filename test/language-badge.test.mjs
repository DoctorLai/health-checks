import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createLanguageBadge,
  updateLanguageBadge,
} = require('../scripts/update-language-badge.cjs');

describe('language badge', () => {
  it('calculates the JavaScript share from GitHub language byte counts', () => {
    expect(createLanguageBadge({ JavaScript: 3, Shell: 1 }).message).toBe('75.00%');
  });

  it('handles repositories without JavaScript or without language data', () => {
    expect(createLanguageBadge({ Shell: 1 }).message).toBe('0.00%');
    expect(createLanguageBadge({}).message).toBe('0.00%');
  });

  it.each([null, [], { JavaScript: -1 }, { JavaScript: '10' }, { JavaScript: NaN }])(
    'rejects malformed language data: %j',
    (languages) => {
      expect(() => createLanguageBadge(languages)).toThrow(TypeError);
    },
  );
});

describe('badge branch publishing', () => {
  let github;
  let context;
  let core;

  beforeEach(() => {
    github = {
      rest: {
        repos: {
          listLanguages: vi.fn().mockResolvedValue({ data: { JavaScript: 3, Shell: 1 } }),
          getContent: vi.fn().mockRejectedValue({ status: 404 }),
          createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
        },
        git: {
          getRef: vi.fn().mockResolvedValue({}),
          createTree: vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } }),
          createCommit: vi.fn().mockResolvedValue({ data: { sha: 'commit-sha' } }),
          createRef: vi.fn().mockResolvedValue({}),
        },
      },
    };
    context = { repo: { owner: 'doctorlai', repo: 'health-checks' } };
    core = { info: vi.fn() };
  });

  it('creates an orphan badges branch without touching main', async () => {
    github.rest.git.getRef.mockRejectedValue({ status: 404 });
    await updateLanguageBadge({ github, context, core });
    expect(github.rest.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ parents: [], tree: 'tree-sha' }),
    );
    expect(github.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/badges', sha: 'commit-sha' }),
    );
    const file = github.rest.git.createTree.mock.calls[0][0].tree[0];
    expect(file.path).toBe('javascript.json');
    expect(JSON.parse(file.content).message).toBe('75.00%');
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('creates a missing badge file only on the existing badges branch', async () => {
    await updateLanguageBadge({ github, context, core });
    const request = github.rest.repos.createOrUpdateFileContents.mock.calls[0][0];
    expect(request.branch).toBe('badges');
    expect(request).not.toHaveProperty('sha');
    expect(JSON.parse(Buffer.from(request.content, 'base64').toString()).message).toBe('75.00%');
    expect(github.rest.git.createRef).not.toHaveBeenCalled();
  });

  it('updates the existing file using its SHA', async () => {
    github.rest.repos.getContent.mockResolvedValue({
      data: { type: 'file', encoding: 'base64', content: 'e30K', sha: 'old-file-sha' },
    });
    await updateLanguageBadge({ github, context, core });
    expect(github.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'badges', sha: 'old-file-sha' }),
    );
  });

  it('does not create empty commits when the percentage is unchanged', async () => {
    github.rest.repos.getContent.mockResolvedValue({
      data: {
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(
          `${JSON.stringify(createLanguageBadge({ JavaScript: 3, Shell: 1 }), null, 2)}\n`,
        ).toString('base64'),
        sha: 'existing-file-sha',
      },
    });
    await updateLanguageBadge({ github, context, core });
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('unchanged'));
  });

  it('fails explicitly when the badge path is not a regular file', async () => {
    github.rest.repos.getContent.mockResolvedValue({ data: { type: 'dir' } });
    await expect(updateLanguageBadge({ github, context, core })).rejects.toThrow(
      'must be a base64-encoded file',
    );
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('does not mistake permission or API errors for a missing branch', async () => {
    const error = Object.assign(new Error('Forbidden'), { status: 403 });
    github.rest.git.getRef.mockRejectedValue(error);
    await expect(updateLanguageBadge({ github, context, core })).rejects.toThrow('Forbidden');
    expect(github.rest.git.createRef).not.toHaveBeenCalled();
  });

  it('does not overwrite a file when reading it fails', async () => {
    const error = Object.assign(new Error('GitHub unavailable'), { status: 503 });
    github.rest.repos.getContent.mockRejectedValue(error);
    await expect(updateLanguageBadge({ github, context, core })).rejects.toThrow(
      'GitHub unavailable',
    );
    expect(github.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('propagates publishing failures', async () => {
    github.rest.repos.createOrUpdateFileContents.mockRejectedValue(new Error('Write denied'));
    await expect(updateLanguageBadge({ github, context, core })).rejects.toThrow('Write denied');
  });
});
