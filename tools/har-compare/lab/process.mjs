import { execFile, spawnSync } from 'node:child_process';

const allowedEnvironment = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP', 'PLAYWRIGHT_BROWSERS_PATH'];

/** Runtime children need public paths/locales, never owner auth, proxy or Node injection. */
export function childEnvironment(source = process.env) {
  return Object.fromEntries(allowedEnvironment.filter(name => typeof source[name] === 'string').map(name => [name, source[name]]));
}

/** Synchronous fixture tests/report checks use the same boundary as async CLI runs. */
export function runNodeSync(args, options = {}) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, ...options, env: childEnvironment(options.env ?? process.env) });
}

/** Async invocation keeps the same-process fixture responsive; every child is bounded. */
export function runNode(args, options = {}) {
  return new Promise(resolve => {
    execFile(process.execPath, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, ...options, env: childEnvironment(options.env ?? process.env) }, (error, stdout, stderr) => {
      const status = error ? typeof error.code === 'number' ? error.code : null : 0;
      resolve({ status, stdout, stderr, ...(error && typeof error.code !== 'number' ? { error } : {}) });
    });
  });
}
