// Builds dist/ and publish/<id>.jpl + publish/<id>.json (required by the Joplin plugin repository) without any bundler.
// Content scripts are loaded by Joplin as standalone files, so the local
// require('./evaluate.js') is replaced by the module's code wrapped in an IIFE.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const publish = path.join(root, 'publish');
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));

const SHARED = "require('./evaluate.js')";
const sharedCode = fs.readFileSync(path.join(src, 'evaluate.js'), 'utf8');
const inlined =
  '(function () {\nconst module = { exports: {} };\n' + sharedCode + '\nreturn module.exports;\n})()';

fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(publish, { recursive: true, force: true });
fs.mkdirSync(dist);
fs.mkdirSync(publish);

for (const file of fs.readdirSync(src)) {
  if (file === 'evaluate.js') continue; // inlined where required
  let content = fs.readFileSync(path.join(src, file), 'utf8');
  if (content.includes(SHARED)) content = content.split(SHARED).join(inlined);
  fs.writeFileSync(path.join(dist, file), content);
}

const jpl = path.join(publish, `${manifest.id}.jpl`);
execFileSync('tar', ['-cf', jpl, '-C', dist, '.'], {
  env: { ...process.env, COPYFILE_DISABLE: '1' },
});
fs.writeFileSync(path.join(publish, `${manifest.id}.json`), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${path.relative(root, jpl)} and ${manifest.id}.json`);
