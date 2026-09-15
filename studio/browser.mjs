import {spawn} from 'node:child_process';

// Reports dispatch, not proof that a browser rendered the page.
export async function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise(resolveOpen => {
    try {
      const child = spawn(command, args, {stdio: 'ignore', windowsHide: true});
      child.once('error', () => resolveOpen(false));
      child.once('spawn', () => { child.unref(); resolveOpen(true); });
    } catch { resolveOpen(false); }
  });
}
