import { chromium, firefox } from 'playwright';
import { childEnvironment } from './process.mjs';

/** No fallback may turn off a browser sandbox or change host configuration. */
export async function launchBrowser(name = 'chromium') {
  if (!['chromium', 'firefox'].includes(name)) throw new Error('Browser must be chromium or firefox.');
  return name === 'chromium'
    ? chromium.launch({ headless: true, chromiumSandbox: true, timeout: 10000, env: childEnvironment() })
    : firefox.launch({ headless: true, timeout: 10000, env: childEnvironment() });
}
export function launchLimitation(error) {
  const message = String(error?.message || error);
  if (/No usable sandbox|Chromium sandboxing failed/u.test(message)) return { code: 'BROWSER_SANDBOX_UNAVAILABLE', reason: 'Chromium cannot start with chromiumSandbox:true: no usable sandbox. Host security was not changed.' };
  if (/CanCreateUserNamespace|CLONE_NEWPID|Could not find profile folder/u.test(message)) return { code: 'BROWSER_SANDBOX_OR_PROFILE_UNAVAILABLE', reason: 'Firefox launch reported user-namespace EPERM and profile unavailable. No sandbox-disabling option was used.' };
  if (/Executable doesn't exist/u.test(message)) return { code: 'BROWSER_NOT_INSTALLED', reason: 'Matching pinned browser binary is not installed at the selected PLAYWRIGHT_BROWSERS_PATH.' };
  return { code: 'BROWSER_LAUNCH_FAILED', reason: 'Pinned browser launch failed; no workaround was applied. Reproduce locally to inspect browser-specific diagnostics.' };
}
