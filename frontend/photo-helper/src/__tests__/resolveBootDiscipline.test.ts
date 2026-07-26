import { describe, it, expect, vi } from 'vitest';
import { resolveBootDiscipline, readPersistedDiscipline } from '../utils/resolveBootDiscipline';

/**
 * The boot-time fallback that stops a precision competition being laid out as
 * a rally when the URL carries no `?discipline=`. Storage is injected rather
 * than module-mocked, matching the DI shape `syncMapPicksOnce` already uses.
 */

type Dir = { path: string };

/** Records how it was probed, so the read-only contract can be asserted. */
class FakeStorage {
  createFlags: (boolean | undefined)[] = [];
  // Plain fields rather than constructor parameter properties: this package
  // compiles with `erasableSyntaxOnly`, which rejects that shorthand.
  private readonly tree: Record<string, unknown>;
  private readonly missing: string | null;

  constructor(tree: Record<string, unknown> = {}, missing: string | null = null) {
    this.tree = tree;
    this.missing = missing;
  }

  async init() { return { root: { path: '/root' } as Dir }; }

  async getDirectoryHandle(parent: Dir, name: string, opts?: { create?: boolean }) {
    this.createFlags.push(opts?.create);
    if (this.missing === name) throw new Error(`no such directory: ${name}`);
    return { path: `${parent.path}/${name}` } as Dir;
  }

  async readJSON<T>(dir: Dir, name: string): Promise<T | null> {
    return (this.tree[`${dir.path}/${name}`] as T) ?? null;
  }
}

const withSession = (competitionId: string, session: unknown) => new FakeStorage({
  [`/root/competitions/${competitionId}/corridors/session.json`]: session,
});

describe('readPersistedDiscipline', () => {
  it('reads the discipline map-corridors persisted for the competition', async () => {
    const storage = withSession('c1', { discipline: 'precision' });
    await expect(readPersistedDiscipline('c1', storage as never)).resolves.toBe('precision');
  });

  it('never creates directories while probing', async () => {
    // A read-only boot probe must not materialise a competition directory for
    // an id that does not exist.
    const storage = withSession('c1', { discipline: 'rally' });
    await readPersistedDiscipline('c1', storage as never);
    expect(storage.createFlags.every((f) => f === false)).toBe(true);
  });

  it('returns null when the competition has no corridors session yet', async () => {
    // Common and expected: the competition was created in the editor and never
    // opened on the map.
    const storage = new FakeStorage({}, 'corridors');
    await expect(readPersistedDiscipline('c1', storage as never)).resolves.toBeNull();
  });

  it('returns null for a corrupt or unknown persisted value', async () => {
    for (const bad of ['Precision', '', 42, null, undefined, {}]) {
      const storage = withSession('c1', { discipline: bad });
      await expect(readPersistedDiscipline('c1', storage as never)).resolves.toBeNull();
    }
  });

  it('returns null when storage is unavailable instead of throwing', async () => {
    // Private browsing / OPFS blocked. The editor must still boot.
    const broken = { init: async () => { throw new Error('no storage'); } };
    await expect(readPersistedDiscipline('c1', broken as never)).resolves.toBeNull();
  });
});

describe('resolveBootDiscipline', () => {
  it('takes a valid URL param without touching storage at all', async () => {
    // The fast path that keeps the desktop build's boot free of extra I/O.
    const storage = withSession('c1', { discipline: 'rally' });
    await expect(
      resolveBootDiscipline('?competitionId=c1&discipline=precision', storage as never),
    ).resolves.toBe('precision');
    expect(storage.createFlags, 'storage must not be probed on the fast path').toEqual([]);
  });

  it('falls back to the persisted session when the param is absent', async () => {
    const storage = withSession('c1', { discipline: 'precision' });
    await expect(resolveBootDiscipline('?competitionId=c1', storage as never)).resolves.toBe('precision');
  });

  it('falls back to the persisted session when the param is INVALID', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = withSession('c1', { discipline: 'precision' });
    await expect(
      resolveBootDiscipline('?competitionId=c1&discipline=Precision', storage as never),
    ).resolves.toBe('precision');
    // The QA signal for launcher drift is preserved.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns null with no competitionId (web standalone — nothing to get wrong)', async () => {
    const storage = withSession('c1', { discipline: 'precision' });
    await expect(resolveBootDiscipline('', storage as never)).resolves.toBeNull();
    expect(storage.createFlags).toEqual([]);
  });
});
