const SESSION_STORAGE_KEY = 'airq-corridors-session-id'

export type OPFSHandles = {
  root: FileSystemDirectoryHandle
  sessions: FileSystemDirectoryHandle
}

export async function detectOPFSWriteSupport(): Promise<boolean> {
  try {
    const storage: any = (navigator as any).storage
    if (!storage || typeof storage.getDirectory !== 'function') return false
    const root: any = await storage.getDirectory?.()
    if (!root?.getFileHandle || !root?.getDirectoryHandle) return false
    const test = await root.getFileHandle('opfs-test.tmp', { create: true })
    if (!test?.createWritable) return false
    const w = await test.createWritable()
    await w.write(new Blob([new Uint8Array([1, 2, 3])]))
    await w.close()
    try {
      await root.removeEntry('opfs-test.tmp')
    } catch {}
    return true
  } catch {
    return false
  }
}

export async function initOPFS(): Promise<OPFSHandles> {
  const storage: any = (navigator as any).storage
  if (!storage || typeof storage.getDirectory !== 'function') {
    throw new Error('OPFS not supported')
  }
  const root: FileSystemDirectoryHandle = await storage.getDirectory()
  const sessions = await root.getDirectoryHandle('sessions', { create: true })
  return { root, sessions }
}

export async function ensureSessionDir(
  handles: OPFSHandles,
  sessionId: string
): Promise<{ dir: FileSystemDirectoryHandle }> {
  const dir = await handles.sessions.getDirectoryHandle(sessionId, { create: true })
  return { dir }
}

export async function writeJSON(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: any
) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  await w.close()
}

export async function readJSON<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try {
    const fh = await dir.getFileHandle(name, { create: false })
    const file = await fh.getFile()
    const text = await file.text()
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
  mime: string = 'text/plain'
) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(new Blob([text], { type: mime }))
  await w.close()
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(name, { create: false })
    const file = await fh.getFile()
    return await file.text()
  } catch {
    return null
  }
}

export function loadOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY)
  if (existing) return existing
  const id = `corridors-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  localStorage.setItem(SESSION_STORAGE_KEY, id)
  return id
}

export async function deleteSessionDir(
  sessionsDir: FileSystemDirectoryHandle,
  sessionId: string
) {
  const anyDir: any = sessionsDir as any
  if (typeof anyDir.removeEntry === 'function') {
    await anyDir.removeEntry(sessionId, { recursive: true })
  } else {
    await (sessionsDir as any).removeEntry(sessionId)
  }
}


