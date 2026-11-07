import { spawn, execFileSync } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const stateDir = join(root, '.studio');
const portFile = join(stateDir, 'desktop-port');

async function isOurStudio(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/writing`, { signal: AbortSignal.timeout(800) });
    if (!response.ok || !(await response.text()).includes('writing.js')) return false;
    const pids = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 20000 }).trim().split('\n');
    return pids.some(pid => {
      const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: 20000 });
      return cwd.split('\n').includes(`n${resolve(root)}`);
    });
  } catch { return false; }
}

async function main() {
  await mkdir(stateDir, { recursive: true });
  const savedPort = Number(await readFile(portFile, 'utf8').catch(() => '4382'));
  let port;
  for (const candidate of [...new Set([savedPort, 4382, 4380, 4381, 4383, 4384, 4385, 4386, 4387, 4388, 4389, 4390])]) {
    if (candidate >= 4380 && candidate <= 4390 && await isOurStudio(candidate)) { port = candidate; break; }
  }
  if (!port) {
    if (process.argv.includes('--check')) throw new Error('No running Studio found.');
    const log = await open(join(stateDir, 'desktop-server.log'), 'w');
    const child = spawn(process.execPath, [join(root, 'studio/server.mjs')], { cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd] });
    child.unref();
    await log.close();
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const output = await readFile(join(stateDir, 'desktop-server.log'), 'utf8');
      const match = output.match(/Rolin Studio: http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match && await isOurStudio(Number(match[1]))) { port = Number(match[1]); break; }
    }
    if (!port) throw new Error('Studio could not start. See .studio/desktop-server.log.');
  }
  await writeFile(portFile, String(port));
  const url = `http://127.0.0.1:${port}/writing`;
  if (process.argv.includes('--check')) console.log(url);
  else execFileSync('/usr/bin/open', [url]);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
