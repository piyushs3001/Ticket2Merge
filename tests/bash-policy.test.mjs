import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBash } from '../scripts/lib/bash-policy.mjs';

const HOME = '/home/u/.claude/ticket2merge';
const check = (cmd) => checkBash(cmd, { t2mHome: HOME });

const ALLOWED = [
  'git status',
  'git status --porcelain',
  'git diff',
  'git diff --cached',
  'git diff --stat HEAD~1',
  'git log --oneline -20',
  'git log --since="2026-09-01" --oneline -- src/app.php',
  'git show HEAD:src/app.php',
  'git branch --show-current',
  'git branch --list',
  'git branch -a',
  'git branch -vv',
  'git branch --list "feature/*"',
  'git rev-parse --show-toplevel',
  'git ls-files',
  'git remote -v',
  'git remote',
  'git remote get-url origin',
  'git grep -n "foo(" -- src',
  'git blame -L 10,20 src/a.php',
  'git merge-base HEAD origin/main',
  'git cat-file -p HEAD',
  'git ls-tree -r HEAD --name-only',
  'git -C /var/www/repo status',
  'git --no-pager log -1',
  'git --version',
  'git status && git diff --cached',
  'git log --oneline | head -5',
  'cd /repo && git status',
  'echo "$(git rev-parse --show-toplevel)"',
  'grep -rn "git commit" docs/',
  'grep -rn git src/',
  'ls .git',
  'cat .git/HEAD',
  'npm test',
  'npx playwright test tests/e2e/login.spec.ts',
  'php artisan test --filter=Coupon',
  `node /plugins/t2m/scripts/t2m.mjs status --run abc`,
  `cat ${HOME}/runs/abc.json`,
  'echo git add is blocked here',
  'mkdir -p build && cd build',
  `mkdir -p ${HOME}/reports/proj && cat > ${HOME}/reports/proj/report.md`,
];

const BLOCKED = [
  'git add .',
  'git add -A',
  'git commit -m "x"',
  'git push',
  'git push origin HEAD',
  'git pull',
  'git fetch origin',
  'git merge feature',
  'git rebase main',
  'git cherry-pick abc',
  'git revert HEAD',
  'git reset --hard',
  'git switch main',
  'git checkout -b new',
  'git checkout -- file.php',
  'git tag v1',
  'git clean -fd',
  'git restore file.php',
  'git rm file.php',
  'git mv a b',
  'git am patch',
  'git apply fix.patch',
  'git stash',
  'git stash push -- config/app.php',
  'git config user.name x',
  'git worktree add /tmp/x',
  'git branch new-feature',
  'git branch -D old',
  'git branch -m a b',
  'git remote add up url',
  'git remote set-url origin url',
  'git update-ref HEAD abc',
  'git notes add -m x',
  'git st',
  'git -c alias.st=commit st',
  'git -c core.hooksPath=/tmp status',
  'git diff --output=/tmp/x',
  'git status && git add .',
  'git diff; git commit -m x',
  'git push || git status',
  'git status & git push',
  'git log | git commit -F -',
  'echo ok\ngit commit -m x',
  'echo $(git commit -m x)',
  'echo `git push`',
  'echo "$(git add .)"',
  'bash -c "git commit -m x"',
  "sh -c 'git status; git push'",
  'eval "git commit -m x"',
  'sudo git push',
  'env GIT_DIR=.git git commit -m x',
  'GIT_AUTHOR_NAME=x git commit -m y',
  'command git add .',
  '/usr/bin/git commit -m x',
  'xargs git add < files.txt',
  'find . -name "*.php" -exec git add {} \\;',
  'timeout 10 git push',
  'nohup git push &',
  'if git diff --quiet; then git commit -m x; fi',
  'for f in a b; do git add $f; done',
  '(git add . && git commit -m x)',
  'bash <<EOF\ngit commit -m x\nEOF',
  'hub push',
  'rm -rf .git',
  'echo ref > .git/HEAD',
  'sed -i s/a/b/ .git/config',
  'cp hooks/pre-commit .git/hooks/pre-commit',
  `node -e "require('child_process').execSync('git commit -m x')"`,
  `python3 -c "import subprocess; subprocess.run(['git','push'])"`,
  `python3 -c "import git; git.Repo('.').index.commit('x')"`,
  `node -e "require('simple-git')().commit('x')"`,
  'gh pr merge 12 --squash',
  'gh pr review 12 --approve',
  'glab mr merge 12',
  'glab mr approve 12',
  'curl -s -X PUT -H "PRIVATE-TOKEN: t" https://gl.example/api/v4/projects/1/merge_requests/5/merge',
  'curl -s --request POST https://gl.example/api/v4/projects/1/merge_requests/5/approve',
  'curl -s -X POST -d @body.json https://gl.example/api/v4/projects/1/repository/commits',
  'curl -s --data \'{"branch":"x"}\' https://gl.example/api/v4/projects/1/repository/branches',
  'curl -X PUT https://api.github.com/repos/o/r/pulls/3/merge',
  'curl -X PUT https://api.github.com/repos/o/r/contents/a.txt -d @b.json',
  `echo '{}' > ${HOME}/runs/abc.json`,
  `sed -i 's/false/true/' ${HOME}/runs/abc.json`,
  `python3 -c "open('${HOME}/runs/abc.json','w').write('{}')"`,
  'claude -p "commit everything"',
];

for (const cmd of ALLOWED) {
  test(`allows: ${JSON.stringify(cmd)}`, () => {
    const r = check(cmd);
    assert.equal(r.allow, true, r.reason);
  });
}

for (const cmd of BLOCKED) {
  test(`blocks: ${JSON.stringify(cmd)}`, () => {
    const r = check(cmd);
    assert.equal(r.allow, false, `expected block for ${cmd}`);
    assert.match(r.reason, /Ticket2Merge/);
  });
}

test('curl GET on merge_requests is allowed (read-only API)', () => {
  const r = check('curl -s -H "PRIVATE-TOKEN: $T" https://gl.example/api/v4/projects/1/merge_requests/5/changes');
  assert.equal(r.allow, true, r.reason);
});

test('curl PUT of an MR description is allowed (not a git state change)', () => {
  const r = check('curl -s --request PUT --data @body.json https://gl.example/api/v4/projects/1/merge_requests/5');
  assert.equal(r.allow, true, r.reason);
});

test('block reason tells Claude to hand the command to the user', () => {
  const r = check('git commit -m x');
  assert.match(r.reason, /ask the user to run it/i);
});
