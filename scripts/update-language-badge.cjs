const BADGE_BRANCH = 'badges';
const BADGE_PATH = 'javascript.json';
const COMMIT_MESSAGE = 'chore: update JavaScript percentage badge';

function createLanguageBadge(languages) {
  if (languages === null || typeof languages !== 'object' || Array.isArray(languages)) {
    throw new TypeError('The languages response must be an object.');
  }
  const counts = Object.values(languages);
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new TypeError('Language byte counts must be non-negative integers.');
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  const percentage = total === 0 ? 0 : ((languages.JavaScript ?? 0) / total) * 100;
  return {
    schemaVersion: 1,
    label: 'JavaScript',
    message: `${percentage.toFixed(2)}%`,
    color: 'f1e05a',
    namedLogo: 'javascript',
    logoColor: 'black',
  };
}

async function updateLanguageBadge({ github, context, core }) {
  const repository = context.repo;
  const { data: languages } = await github.rest.repos.listLanguages(repository);
  const content = `${JSON.stringify(createLanguageBadge(languages), null, 2)}\n`;
  let branchExists = true;
  try {
    await github.rest.git.getRef({ ...repository, ref: `heads/${BADGE_BRANCH}` });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
    branchExists = false;
  }

  if (!branchExists) {
    const { data: tree } = await github.rest.git.createTree({
      ...repository,
      tree: [{ path: BADGE_PATH, mode: '100644', type: 'blob', content }],
    });
    const { data: commit } = await github.rest.git.createCommit({
      ...repository,
      message: COMMIT_MESSAGE,
      tree: tree.sha,
      parents: [],
    });
    await github.rest.git.createRef({
      ...repository,
      ref: `refs/heads/${BADGE_BRANCH}`,
      sha: commit.sha,
    });
    core.info('Created the badges branch with the JavaScript percentage badge.');
    return;
  }

  let file;
  try {
    const response = await github.rest.repos.getContent({
      ...repository,
      path: BADGE_PATH,
      ref: BADGE_BRANCH,
    });
    file = response.data;
    if (file.type !== 'file' || file.encoding !== 'base64') {
      throw new Error('The language badge path must be a base64-encoded file.');
    }
    if (Buffer.from(file.content, 'base64').toString('utf8') === content) {
      core.info('The JavaScript percentage badge is unchanged.');
      return;
    }
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }
  await github.rest.repos.createOrUpdateFileContents({
    ...repository,
    branch: BADGE_BRANCH,
    path: BADGE_PATH,
    message: COMMIT_MESSAGE,
    content: Buffer.from(content).toString('base64'),
    ...(file ? { sha: file.sha } : {}),
  });
  core.info('Updated the JavaScript percentage badge on the badges branch.');
}

module.exports = { createLanguageBadge, updateLanguageBadge };
