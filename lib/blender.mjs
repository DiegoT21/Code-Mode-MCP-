// Blender in batch mode: runs a Python script on a .blend without opening the interface and returns only
// what the script prints (Blender's own log is filtered out). Uses "blenderPath" from settings.json, the
// BLENDER_EXE variable, or Blender found in the usual places.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export function findBlender(settings = {}) {
  if (settings.blenderPath && fs.existsSync(settings.blenderPath)) return settings.blenderPath
  if (process.env.BLENDER_EXE && fs.existsSync(process.env.BLENDER_EXE)) return process.env.BLENDER_EXE
  const candidates = []
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const dir = path.join(base, 'Blender Foundation')
      try {
        for (const v of fs.readdirSync(dir).sort().reverse()) candidates.push(path.join(dir, v, 'blender.exe'))
      } catch {}
    }
    const dl = path.join(os.homedir(), 'Downloads')
    try {
      for (const d of fs.readdirSync(dl).filter((x) => x.toLowerCase().startsWith('blender')).sort().reverse()) {
        candidates.push(path.join(dl, d, 'blender.exe'))
        try {
          for (const sub of fs.readdirSync(path.join(dl, d))) candidates.push(path.join(dl, d, sub, 'blender.exe'))
        } catch {}
      }
    } catch {}
  } else if (process.platform === 'darwin') candidates.push('/Applications/Blender.app/Contents/MacOS/Blender')
  else candidates.push('/usr/bin/blender', '/snap/bin/blender', '/usr/local/bin/blender')
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

const NOISE = /^(Blender \d|Read blend|Blender quit|Warning: |\s*$)|^\d+:\d+\.\d+\s/

export function runBlender(scene, python, settings = {}, { timeoutMs = 300000 } = {}) {
  const exe = findBlender(settings)
  if (!exe) return Promise.reject(new Error('Blender not found. Set its path in Setup (settings.json → blenderPath).'))
  const file = path.isAbsolute(scene) ? scene : path.join(settings.blenderScenes ?? process.cwd(), scene)
  if (!fs.existsSync(file)) return Promise.reject(new Error(`Scene not found: ${file}`))
  const tmp = path.join(os.tmpdir(), `code-mode-${process.pid}-${Date.now()}.py`)
  fs.writeFileSync(tmp, python)
  return new Promise((resolve, reject) => {
    const p = spawn(exe, ['-b', file, '--python-exit-code', '1', '--python', tmp], { windowsHide: true })
    let out = ''
    const timer = setTimeout(() => p.kill(), timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('error', reject)
    p.on('close', (code) => {
      clearTimeout(timer)
      fs.rmSync(tmp, { force: true })
      const lines = out.split(/\r?\n/).filter((l) => !NOISE.test(l) || /ERROR/.test(l))
      const text = lines.join('\n').trim()
      if (code !== 0) return reject(new Error(`Blender exited with ${code}:\n${text.slice(-1500)}`))
      const lastJson = [...lines].reverse().find((l) => /^\s*[[{]/.test(l))
      try {
        resolve(lastJson ? JSON.parse(lastJson) : text)
      } catch {
        resolve(text)
      }
    })
  })
}

export function listScenes(settings = {}) {
  try {
    return fs.readdirSync(settings.blenderScenes ?? '').filter((f) => f.endsWith('.blend'))
  } catch {
    return []
  }
}
