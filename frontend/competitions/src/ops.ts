import type {
  CleanupCandidate,
  CompetitionMetadata,
  CompetitionsIndex,
  Discipline,
} from './types';
import {
  DEFAULT_DISCIPLINE,
  MAX_AGE_DAYS,
  MAX_COMPETITIONS,
  VALID_DISCIPLINES,
} from './constants';

export interface CreateMetadataOptions {
  name: string;
  discipline?: Discipline;
  now?: string;
  id?: string;
}

export interface DetectCleanupOptions {
  now?: number;
  maxAgeDays?: number;
  maxCount?: number;
}

export interface TimestampOptions {
  now?: string;
}

function generateId(): string {
  return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidDiscipline(value: unknown): value is Discipline {
  return typeof value === 'string' && (VALID_DISCIPLINES as readonly string[]).indexOf(value) !== -1;
}

export function createMetadata(options: CreateMetadataOptions): CompetitionMetadata {
  const name = options.name;
  const discipline = options.discipline === undefined ? DEFAULT_DISCIPLINE : options.discipline;
  const now = options.now || new Date().toISOString();
  const id = options.id || generateId();

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('createMetadata: name (non-empty string) is required');
  }
  if (!isValidDiscipline(discipline)) {
    throw new Error(
      `createMetadata: invalid discipline "${String(discipline)}" (expected one of: ${VALID_DISCIPLINES.join(', ')})`,
    );
  }

  return {
    id,
    name,
    discipline,
    createdAt: now,
    lastModified: now,
    photoCount: 0,
    isActive: true,
  };
}

export function addCompetition(
  index: CompetitionsIndex,
  metadata: CompetitionMetadata,
): CompetitionsIndex {
  const others = index.competitions.map((c) => ({ ...c, isActive: false }));
  const incoming = { ...metadata, isActive: true };
  return {
    competitions: others.concat([incoming]),
    activeCompetitionId: incoming.id,
    version: index.version,
  };
}

export function removeCompetition(
  index: CompetitionsIndex,
  id: string,
): { index: CompetitionsIndex; newActiveId: string | null } {
  const remaining = index.competitions.filter((c) => c.id !== id);
  let activeCompetitionId: string | null = index.activeCompetitionId;

  if (activeCompetitionId === id) {
    if (remaining.length > 0) {
      activeCompetitionId = remaining[0].id;
      remaining[0] = { ...remaining[0], isActive: true };
    } else {
      activeCompetitionId = null;
    }
  }

  return {
    index: {
      competitions: remaining,
      activeCompetitionId,
      version: index.version,
    },
    newActiveId: activeCompetitionId,
  };
}

export function setActive(index: CompetitionsIndex, id: string): CompetitionsIndex {
  const found = index.competitions.find((c) => c.id === id);
  if (!found) {
    throw new Error(`setActive: competition not found: ${id}`);
  }
  const competitions = index.competitions.map((c) => ({ ...c, isActive: c.id === id }));
  return {
    competitions,
    activeCompetitionId: id,
    version: index.version,
  };
}

export function setDiscipline(
  index: CompetitionsIndex,
  id: string,
  discipline: Discipline,
  options?: TimestampOptions,
): CompetitionsIndex {
  const now = options?.now || new Date().toISOString();

  if (!isValidDiscipline(discipline)) {
    throw new Error(
      `setDiscipline: invalid discipline "${String(discipline)}" (expected one of: ${VALID_DISCIPLINES.join(', ')})`,
    );
  }
  const found = index.competitions.find((c) => c.id === id);
  if (!found) {
    throw new Error(`setDiscipline: competition not found: ${id}`);
  }
  const competitions = index.competitions.map((c) =>
    c.id === id ? { ...c, discipline, lastModified: now } : c,
  );
  return {
    competitions,
    activeCompetitionId: index.activeCompetitionId,
    version: index.version,
  };
}

export function touchCompetition(
  index: CompetitionsIndex,
  id: string,
  patch: Partial<Omit<CompetitionMetadata, 'id' | 'lastModified'>>,
  options?: TimestampOptions,
): CompetitionsIndex {
  const now = options?.now || new Date().toISOString();

  const found = index.competitions.find((c) => c.id === id);
  if (!found) {
    throw new Error(`touchCompetition: competition not found: ${id}`);
  }
  const competitions = index.competitions.map((c) =>
    c.id === id ? { ...c, ...(patch || {}), lastModified: now } : c,
  );
  return {
    competitions,
    activeCompetitionId: index.activeCompetitionId,
    version: index.version,
  };
}

export function detectCleanupCandidates(
  index: CompetitionsIndex,
  options?: DetectCleanupOptions,
): CleanupCandidate[] {
  const nowMs = typeof options?.now === 'number' ? options.now : Date.now();
  const maxAgeDays = typeof options?.maxAgeDays === 'number' ? options.maxAgeDays : MAX_AGE_DAYS;
  const maxCount = typeof options?.maxCount === 'number' ? options.maxCount : MAX_COMPETITIONS;

  const ageThresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const out: CleanupCandidate[] = [];
  const seen = new Set<string>();

  for (const c of index.competitions) {
    const ageMs = nowMs - new Date(c.createdAt).getTime();
    if (ageMs > ageThresholdMs && !seen.has(c.id)) {
      seen.add(c.id);
      out.push({
        competition: c,
        reason: 'age',
        daysOld: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
      });
    }
  }

  if (index.competitions.length > maxCount) {
    const sorted = index.competitions
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const excessCount = index.competitions.length - maxCount;
    const excess = sorted.slice(0, excessCount);
    for (const c of excess) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push({
          competition: c,
          reason: 'excess',
        });
      }
    }
  }

  return out;
}

export function emptyIndex(): CompetitionsIndex {
  return { competitions: [], activeCompetitionId: null, version: 1 };
}

export function validateIndex(raw: unknown): CompetitionsIndex {
  if (!raw || typeof raw !== 'object') {
    return emptyIndex();
  }
  const r = raw as { competitions?: unknown; activeCompetitionId?: unknown; version?: unknown };
  const competitions = Array.isArray(r.competitions)
    ? (r.competitions as CompetitionMetadata[])
    : [];
  const activeCompetitionId =
    typeof r.activeCompetitionId === 'string' ? r.activeCompetitionId : null;
  const version = typeof r.version === 'number' ? r.version : 1;
  return { competitions, activeCompetitionId, version };
}
