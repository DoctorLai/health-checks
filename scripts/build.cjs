const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const { loadConfig } = require('../health-check.js');
const { version } = require('../package.json');

const root = path.join(__dirname, '..');
const files = [
  'health-check.js',
  'package.json',
  'package-lock.json',
  'config.json.sample',
  'start-via-pm2.sh',
  '.nvmrc',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'SUPPORT.md',
  'PRIVACY.md',
];

loadConfig(path.join(root, 'config.json.sample'));
const archive = Object.fromEntries(
  files.map((file) => [file, readFileSync(path.join(root, file))]),
);
const directory = path.join(root, 'dist');
const filename = path.join(directory, `health-checks-${version}.zip`);
mkdirSync(directory, { recursive: true });
writeFileSync(filename, zipSync(archive, { level: 9 }));
console.log(`Created Node CLI release: ${filename}`);
