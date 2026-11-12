// Builds the app and publishes the result to the `gh-pages` branch, which
// GitHub Pages serves. Run with: npm run deploy
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });
const out = (cmd, cwd = root) => execSync(cmd, { cwd }).toString().trim();

const remote = out('git remote get-url origin');
const name = out('git config user.name');
const email = out('git config user.email');
const version = out('git rev-parse --short HEAD');

run('npm run build');
fs.writeFileSync(path.join(dist, '.nojekyll'), ''); // serve the files exactly as built
fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });

// A throwaway repository holding only the built files, pushed over gh-pages.
run('git init -q -b gh-pages', dist);
run('git add -A', dist);
run(`git -c user.name="${name}" -c user.email="${email}" commit -q -m "Publish ${version}"`, dist);
run(`git push -q -f "${remote}" gh-pages`, dist);
fs.rmSync(path.join(dist, '.git'), { recursive: true, force: true });
console.log(`Published ${version}. The site updates within a minute or two.`);
