import { spawnSync } from 'node:child_process';

export function verifyReleaseCommit(root, tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag || ''))
    throw new Error('Expected a version tag');
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const target = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (target.status !== 0)
    throw new Error('An existing Git tag is required; a branch is insufficient');
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0 || head.stdout.trim() !== target.stdout.trim())
    throw new Error('The release tag must point to the checked-out commit');
  if (git(['diff', '--exit-code', 'HEAD', '--']).status !== 0)
    throw new Error('Tracked release sources must be clean');
  return target.stdout.trim();
}
