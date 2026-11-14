import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const windows = process.platform === 'win32'
const python = join(root, '.venv', windows ? 'Scripts/python.exe' : 'bin/python')
const vite = join(root, 'frontend/node_modules/vite/bin/vite.js')
const children = new Set()
let stopping = false

function stopChild(child) {
  if (!child.pid) return Promise.resolve()
  if (windows) {
    // Uvicorn's reload process also owns a Python worker. Stop the whole tree.
    return new Promise((resolve) => {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    })
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already stopped. */ }
      resolve()
    }, 5000)
    child.once('exit', () => { clearTimeout(timeout); resolve() })
    try { process.kill(-child.pid, 'SIGTERM') } catch { clearTimeout(timeout); resolve() }
  })
}

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  await Promise.all([...children].map(stopChild))
  process.exit(code)
}

process.on('SIGINT', () => { void stop() })
process.on('SIGTERM', () => { void stop() })

function start(name, executable, args, cwd = root) {
  const child = spawn(executable, args, {
    cwd, stdio: 'inherit', detached: !windows,
  })
  children.add(child)
  child.once('error', (error) => {
    if (!stopping) {
      console.error(`${name}: ${error.message}`)
      void stop(1)
    }
  })
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${name} stopped (${signal || code}). Stopping the other server.`)
      // Keep the child until shutdown so a reloader's descendants are cleaned up.
      void stop(code || 1)
    }
  })
  return child
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', () => reject(new Error(
      `Port ${port} is unavailable. Stop the existing server and run npm run dev again.`,
    )))
    server.listen(port, '127.0.0.1', () => server.close(resolve))
  })
}

async function waitForBackend() {
  const deadline = Date.now() + 60000
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:8000/health', {
        signal: AbortSignal.timeout(1000),
      })
      if (response.ok && (await response.json()).service === 'terra-signal') return
    } catch { /* The backend is still starting. */ }
    await delay(250)
  }
  if (!stopping) throw new Error('The backend did not become ready within 60 seconds.')
}

try {
  if (!existsSync(python)) throw new Error('Missing .venv. Follow the installation steps in README.md.')
  if (!existsSync(vite)) throw new Error('Missing frontend dependencies. Run npm --prefix frontend ci.')
  await Promise.all([checkPort(8000), checkPort(5173)])
  if (!stopping) {
    console.log('Starting TerraSignal backend...')
    const backendArgs = ['-m', 'uvicorn', 'backend.app.main:app', '--host', '127.0.0.1', '--port', '8000']
    // Uvicorn's Windows reload broadcasts console interrupts. A dedicated
    // watcher restarts only the backend tree and forwards its output instead.
    start('Backend', python, windows
      ? [join(root, 'scripts/dev_backend.py'), ...backendArgs]
      : [...backendArgs, '--reload', '--reload-dir', 'backend/app'])
    await waitForBackend()
    if (!stopping) {
      console.log('\nBackend ready. Starting frontend at http://127.0.0.1:5173/\nPress Ctrl+C to stop both servers.\n')
      start('Frontend', process.execPath, [vite], join(root, 'frontend'))
    }
  }
} catch (error) {
  if (!stopping) {
    console.error(error.message)
    await stop(1)
  }
}
