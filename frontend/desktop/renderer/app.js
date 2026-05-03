// Translations
const translations = {
  cs: {
    title: 'Nástroje pro navigační soutěže',
    subtitle: 'Vyberte soutěž a aplikaci',
    'corridors.title': 'Umístění fotek',
    'corridors.desc': 'Určení polohy soutěžních fotek na trati',
    'helper.title': 'Foto editor',
    'helper.desc': 'Organizace a označování soutěžních fotek',
    'competition.label': 'Soutěž',
    'competition.new': '+ Nová soutěž',
    'competition.loading': 'Načítání...',
    'competition.empty': 'Žádné soutěže – vytvořte novou',
    'competition.promptName': 'Název nové soutěže:',
    'competition.defaultName': 'Soutěž',
    'competition.selectFirst': 'Nejdříve vyberte soutěž',
    'competition.deleteBtn': 'Smazat',
    'competition.confirmDelete': 'Smazat',
    'competition.cancelDelete': 'Zrušit',
    'competition.deleteConfirmText': 'Opravdu smazat "{name}"? Toto nelze vrátit.',
    'competition.cleanupAction': 'Vyčistit',
    'competition.cleanupMsg': '{count} soutěží je starších než 30 dní. Chcete je smazat?',
    'competition.cleanupExcess': 'Máte {count} soutěží (max 10). Zvažte smazání starších.',
    'discipline.precision': 'Precision',
    'discipline.rally': 'Rally',
    'competition.createTitle': 'Nová soutěž',
    'competition.folderLabel': 'Složka:',
    'competition.folderHint': '(vybere se po stisku Enter)',
    'competition.changeFolder': 'Změnit',
    'competition.createConfirm': 'Vytvořit a vybrat složku',
    'competition.createConfirmReady': 'Vytvořit',
    'competition.createConfirmNoFolder': 'Vytvořit bez složky',
    'competition.pickFolder': 'Vybrat složku',
    'competition.noFolder': '(žádná složka)',
    'competition.folderSet': '{path}',
    'competition.folderRejected': 'Složku se nepodařilo nastavit. Síťové cesty (\\\\server\\sdílené) ani systémové cesty (\\\\?\\…) nejsou podporovány — vyberte prosím lokální složku.',
    'competition.folderPickFailed': 'Otevření dialogu se nezdařilo: {error}',
    'competition.createFailed': 'Vytvoření soutěže selhalo: {error}',
    'competition.workingDirDropped': 'Soutěž byla vytvořena, ale vybranou složku se nepodařilo uložit (neplatná cesta). Použijte nabídku „Pracovní složka" pro nový pokus.'
  },
  en: {
    title: 'Navigation Flying Tools',
    subtitle: 'Select a competition and application',
    'corridors.title': 'Photo Placement',
    'corridors.desc': 'Locate competition photos on the track',
    'helper.title': 'Photo Editor',
    'helper.desc': 'Organize and label competition photos',
    'competition.label': 'Competition',
    'competition.new': '+ New Competition',
    'competition.loading': 'Loading...',
    'competition.empty': 'No competitions \u2013 create one',
    'competition.promptName': 'New competition name:',
    'competition.defaultName': 'Competition',
    'competition.selectFirst': 'Select a competition first',
    'competition.deleteBtn': 'Delete',
    'competition.confirmDelete': 'Delete',
    'competition.cancelDelete': 'Cancel',
    'competition.deleteConfirmText': 'Delete "{name}"? This cannot be undone.',
    'competition.cleanupAction': 'Clean up',
    'competition.cleanupMsg': '{count} competitions are older than 30 days. Delete them?',
    'competition.cleanupExcess': 'You have {count} competitions (max 10). Consider deleting older ones.',
    'discipline.precision': 'Precision',
    'discipline.rally': 'Rally',
    'competition.createTitle': 'New competition',
    'competition.folderLabel': 'Folder:',
    'competition.folderHint': '(chosen after pressing Enter)',
    'competition.changeFolder': 'Change',
    'competition.createConfirm': 'Create & pick folder',
    'competition.createConfirmReady': 'Create',
    'competition.createConfirmNoFolder': 'Create without folder',
    'competition.pickFolder': 'Pick folder',
    'competition.noFolder': '(no folder)',
    'competition.folderSet': '{path}',
    'competition.folderRejected': 'That folder could not be used. Network paths (\\\\server\\share) and device paths (\\\\?\\…) are not supported — please pick a local folder.',
    'competition.folderPickFailed': 'Folder picker failed: {error}',
    'competition.createFailed': 'Failed to create competition: {error}',
    'competition.workingDirDropped': 'Competition was created, but the chosen folder could not be saved (invalid path). Use the "Working folder" menu to try again.'
  }
};

// Language handling - uses Electron config in desktop, localStorage in browser
const LOCALE_KEY = 'app-locale';

async function getLocale() {
  // In Electron, use config storage (shared across all app:// origins)
  if (window.electronAPI?.getConfig) {
    const saved = await window.electronAPI.getConfig('locale');
    if (saved === 'cz') return 'cs';
    if (saved === 'cs' || saved === 'en') return saved;
  } else {
    // Browser fallback
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === 'cz') return 'cs';
    if (saved === 'cs' || saved === 'en') return saved;
  }
  return 'cs'; // default
}

async function setLocale(locale) {
  // Store as 'cz' for React apps compatibility (they expect 'cz' not 'cs')
  const storageValue = locale === 'cs' ? 'cz' : locale;

  // In Electron, use config storage
  if (window.electronAPI?.setConfig) {
    await window.electronAPI.setConfig('locale', storageValue);
  } else {
    localStorage.setItem(LOCALE_KEY, storageValue);
  }

  currentLocale = locale;
  applyTranslations(locale);
  updateLangButtons(locale);
  document.documentElement.lang = locale;

  // Update Electron menu language
  if (window.electronAPI?.setMenuLocale) {
    window.electronAPI.setMenuLocale(storageValue);
  }
}

let currentLocale = 'cs';

function t(key) {
  const dict = translations[currentLocale] || translations.cs;
  return dict[key] || key;
}

function applyTranslations(locale) {
  const dict = translations[locale] || translations.cs;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });
}

function updateLangButtons(locale) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === locale);
  });
}

// ============================================================================
// Competition Management
// ============================================================================

let activeCompetitionId = null;
let competitionsList = [];

const selectEl = document.getElementById('competition-select');
const newBtn = document.getElementById('competition-new');

async function loadCompetitions() {
  if (!window.electronAPI?.competitions) {
    // Web fallback — no competition management available
    selectEl.disabled = true;
    return;
  }

  try {
    const index = await window.electronAPI.competitions.list();
    const competitions = index.competitions || [];

    selectEl.innerHTML = '';

    competitionsList = competitions;

    if (competitions.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('competition.empty');
      selectEl.appendChild(opt);
      selectEl.disabled = true;
      activeCompetitionId = null;
      updateCardsState();
      updateDisciplineToggle();
      return;
    }

    // Sort by lastModified descending
    const sorted = [...competitions].sort((a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );

    sorted.forEach(comp => {
      const opt = document.createElement('option');
      opt.value = comp.id;
      const date = new Date(comp.createdAt).toLocaleDateString();
      opt.textContent = comp.name + ' (' + date + ')';
      selectEl.appendChild(opt);
    });

    selectEl.disabled = false;

    // Select active competition
    if (index.activeCompetitionId && sorted.find(c => c.id === index.activeCompetitionId)) {
      selectEl.value = index.activeCompetitionId;
      activeCompetitionId = index.activeCompetitionId;
    } else {
      // Default to first
      selectEl.value = sorted[0].id;
      activeCompetitionId = sorted[0].id;
      await window.electronAPI.competitions.setActive(activeCompetitionId);
    }

    updateCardsState();
    updateDisciplineToggle();
    checkCleanupNeeded(competitions);
  } catch (err) {
    console.error('Failed to load competitions:', err);
    selectEl.disabled = true;
  }
}

// Discipline toggle
function updateDisciplineToggle() {
  const toggle = document.getElementById('discipline-toggle');
  if (!activeCompetitionId) {
    toggle.style.opacity = '0.4';
    toggle.style.pointerEvents = 'none';
    return;
  }
  toggle.style.opacity = '1';
  toggle.style.pointerEvents = 'auto';
  const comp = competitionsList.find(c => c.id === activeCompetitionId);
  const discipline = (comp && comp.discipline) || 'rally';
  toggle.querySelectorAll('.discipline-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.discipline === discipline);
  });
}

document.querySelectorAll('.discipline-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!activeCompetitionId || !window.electronAPI?.competitions) return;
    const discipline = btn.dataset.discipline;
    try {
      await window.electronAPI.competitions.setDiscipline(activeCompetitionId, discipline);
      const comp = competitionsList.find(c => c.id === activeCompetitionId);
      if (comp) comp.discipline = discipline;
      updateDisciplineToggle();
    } catch (err) {
      console.error('Failed to set discipline:', err);
    }
  });
});

function updateCardsState() {
  const hasComp = Boolean(activeCompetitionId);
  document.querySelectorAll('.card').forEach(card => {
    card.classList.toggle('disabled', !hasComp);
  });
  const delBtn = document.getElementById('competition-delete');
  if (delBtn) delBtn.disabled = !hasComp;
}

// Competition change handler
selectEl.addEventListener('change', async () => {
  const id = selectEl.value;
  if (!id || id === activeCompetitionId) return;

  try {
    await window.electronAPI.competitions.setActive(id);
    activeCompetitionId = id;
    updateCardsState();
    updateDisciplineToggle();
  } catch (err) {
    console.error('Failed to set active competition:', err);
  }
});

// New competition — inline form
const barSelect = document.getElementById('competition-bar-select');
const barCreate = document.getElementById('competition-bar-create');
const nameInput = document.getElementById('competition-name-input');
const confirmBtn = document.getElementById('competition-create-confirm');
const cancelBtn = document.getElementById('competition-create-cancel');
const pickFolderBtn = document.getElementById('competition-pick-folder');
const folderText = document.getElementById('competition-folder-text');

// Folder picked for the next-created competition. Persists only across
// the create form's lifetime — reset on every showCreateForm() so a
// stale pick from a previous "+ New" doesn't silently apply later.
let pendingWorkingDir = null;
// Tracks whether the auto-open picker has already been attempted for
// this create session. After a cancel, the OK button flips to
// "Vytvořit bez složky" so the user has a single deliberate path to
// commit without a folder — without it, repeatedly hitting Enter just
// re-opens the cancelled dialog (feedback 2026-05-03 follow-up: user
// shouldn't have to click an explicit "pick folder" button).
let attemptedAutoPick = false;
// Guard against re-entering the OK handler while the native folder
// dialog is open (Enter held down, double-click on OK).
let confirmInFlight = false;

function updateFolderDisplay() {
  if (pendingWorkingDir) {
    folderText.textContent = t('competition.folderSet').replace('{path}', pendingWorkingDir);
    folderText.title = pendingWorkingDir;
    folderText.classList.add('has-folder');
  } else {
    folderText.textContent = t('competition.folderHint');
    folderText.removeAttribute('title');
    folderText.classList.remove('has-folder');
  }
  // Mirror the OK button label so the user always knows what their next
  // click does:
  //   • folder picked          → "Vytvořit"               (creates with folder)
  //   • no folder, no attempt  → "Vytvořit a vybrat složku" (auto-opens picker)
  //   • no folder, picker cancelled → "Vytvořit bez složky" (commits w/o folder)
  if (confirmBtn) {
    if (pendingWorkingDir) {
      confirmBtn.textContent = t('competition.createConfirmReady');
    } else if (attemptedAutoPick) {
      confirmBtn.textContent = t('competition.createConfirmNoFolder');
    } else {
      confirmBtn.textContent = t('competition.createConfirm');
    }
  }
}

function showCreateForm() {
  barSelect.classList.add('hidden');
  barCreate.classList.remove('hidden');
  nameInput.value = t('competition.defaultName');
  nameInput.focus();
  nameInput.select();
  pendingWorkingDir = null;
  attemptedAutoPick = false;
  updateFolderDisplay();
}

function hideCreateForm() {
  barCreate.classList.add('hidden');
  barSelect.classList.remove('hidden');
  pendingWorkingDir = null;
  attemptedAutoPick = false;
}

// Discriminated result so callers can tell cancel apart from real failure
// and from validation rejection (UNC / device path):
//   • { ok: true, path: '<abs>' }   — user picked and main.js validated
//   • { ok: true, path: null }      — user clicked Cancel (genuine cancel)
//   • { ok: false, reason, message? } — real error or validation rejection;
//     `reason` is one of 'unavailable' | 'invalid-path' | 'error'.
//
// Round-5 fix: the previous shape returned `null` for cancel AND validation
// rejection AND real failures, and the caller treated all three as "user
// cancelled". A UNC pick (a normal corporate-network choice) silently
// flipped the OK button to "Vytvořit bez složky" with no explanation.
async function pickFolder(opts = {}) {
  if (!window.electronAPI?.pickDirectory) return { ok: false, reason: 'unavailable' };
  const dialogTitle = opts.title || (currentLocale === 'cs'
    ? `Vyberte složku pro soutěž "${nameInput.value.trim() || ''}"`.trim()
    : `Pick folder for competition "${nameInput.value.trim() || ''}"`.trim());
  let picked;
  try {
    picked = await window.electronAPI.pickDirectory(pendingWorkingDir, dialogTitle);
  } catch (err) {
    console.error('Folder pick failed:', err);
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  // Backward-compat: old main.js returned a bare string|null. New main.js
  // returns the discriminated object. Accept either so a stale Electron
  // build paired with new renderer doesn't hard-crash.
  if (typeof picked === 'string' && picked) {
    pendingWorkingDir = picked;
    updateFolderDisplay();
    return { ok: true, path: picked };
  }
  if (picked === null || picked === undefined) {
    return { ok: true, path: null };
  }
  if (picked.canceled === true) {
    return { ok: true, path: null };
  }
  if (picked.canceled === false && picked.error === 'invalid-path') {
    return { ok: false, reason: 'invalid-path', raw: picked.raw };
  }
  if (picked.canceled === false && typeof picked.path === 'string' && picked.path) {
    pendingWorkingDir = picked.path;
    updateFolderDisplay();
    return { ok: true, path: picked.path };
  }
  // Unknown shape — treat as failure rather than silent no-op so a future
  // protocol drift surfaces instead of producing a stuck launcher.
  return { ok: false, reason: 'error', message: 'unexpected pick-directory response' };
}

// Show a localized error to the user when an IPC operation fails. We use
// a plain alert() rather than a toast widget because the launcher renderer
// is intentionally framework-free (vanilla JS) and adding a notification
// system here just for two error paths would be disproportionate. The
// messages live in the translation tables so the user sees them in the
// language they picked, not console-only English.
function showError(key, vars = {}) {
  let msg = t(key);
  for (const [k, v] of Object.entries(vars)) msg = msg.replace(`{${k}}`, String(v));
  alert(msg);
}

async function confirmCreate() {
  if (confirmInFlight) return;
  const name = nameInput.value.trim();
  if (!name) return;
  if (!window.electronAPI?.competitions) return;

  confirmInFlight = true;
  try {
    // Auto-open the folder dialog the FIRST time OK / Enter fires. If
    // the user cancels, `attemptedAutoPick` flips and the next OK
    // commits without a folder (the button label flips too — see
    // updateFolderDisplay). The dedicated "Změnit" button remains
    // available for users who change their mind during the create
    // session. Feedback 2026-05-03: "the folder dialog should open
    // automatically, with appropriate title".
    if (!pendingWorkingDir && !attemptedAutoPick) {
      attemptedAutoPick = true;
      const picked = await pickFolder();
      if (!picked.ok) {
        // Real failure (IPC threw, validation rejected). Surface a
        // localized message so the user knows their pick wasn't lost
        // to a silent cancel — round-5 follow-up to feedback 2026-05-03.
        if (picked.reason === 'invalid-path') {
          showError('competition.folderRejected');
        } else if (picked.reason !== 'unavailable') {
          showError('competition.folderPickFailed', { error: picked.message || picked.reason });
        }
        // Reset so the next OK click re-opens the picker rather than
        // committing without a folder; the user has signalled they want
        // a folder by triggering this branch.
        attemptedAutoPick = false;
        updateFolderDisplay();
        return;
      }
      if (picked.path === null) {
        // Genuine cancel — leave the form open so the user can re-pick
        // ("Změnit") or click OK again to commit without a folder.
        // The button label now reads "Vytvořit bez složky", so the next
        // click is intentional, not a continuation of the same action.
        updateFolderDisplay();
        return;
      }
    }
    // Pass workingDir if user picked one — main.js validates it again
    // (UNC, length, on-disk) before persisting.
    const metadata = await window.electronAPI.competitions.create(name, pendingWorkingDir || undefined);
    hideCreateForm();
    await loadCompetitions();
    selectEl.value = metadata.id;
    activeCompetitionId = metadata.id;
    updateCardsState();
    // Surface workingDirRejected (main.js sets this when validateUserDir
    // refuses the pick at create time — e.g. the folder vanished between
    // pick and create). Without this, the user's pick disappears silently.
    if (metadata && metadata.workingDirRejected) {
      showError('competition.workingDirDropped');
    }
  } catch (err) {
    console.error('Failed to create competition:', err);
    showError('competition.createFailed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    confirmInFlight = false;
  }
}

newBtn.addEventListener('click', showCreateForm);
cancelBtn.addEventListener('click', hideCreateForm);
confirmBtn.addEventListener('click', confirmCreate);
if (pickFolderBtn) pickFolderBtn.addEventListener('click', async () => {
  const r = await pickFolder();
  if (!r.ok) {
    if (r.reason === 'invalid-path') showError('competition.folderRejected');
    else if (r.reason !== 'unavailable') showError('competition.folderPickFailed', { error: r.message || r.reason });
  }
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmCreate();
  if (e.key === 'Escape') hideCreateForm();
});

// Delete competition — inline confirmation
const deleteBtn = document.getElementById('competition-delete');
const barDelete = document.getElementById('competition-bar-delete');
const deleteConfirmText = document.getElementById('delete-confirm-text');
const deleteConfirmBtn = document.getElementById('competition-delete-confirm');
const deleteCancelBtn = document.getElementById('competition-delete-cancel');

function showDeleteConfirm() {
  if (!activeCompetitionId) return;
  const opt = selectEl.options[selectEl.selectedIndex];
  const name = opt ? opt.textContent : activeCompetitionId;
  const msg = t('competition.deleteConfirmText').replace('{name}', name);
  deleteConfirmText.textContent = msg;
  barSelect.classList.add('hidden');
  barDelete.classList.remove('hidden');
}

function hideDeleteConfirm() {
  barDelete.classList.add('hidden');
  barSelect.classList.remove('hidden');
}

async function confirmDelete() {
  if (!activeCompetitionId || !window.electronAPI?.competitions) return;
  try {
    const result = await window.electronAPI.competitions.delete(activeCompetitionId);
    hideDeleteConfirm();
    activeCompetitionId = result.activeCompetitionId;
    await loadCompetitions();
    updateCardsState();
  } catch (err) {
    console.error('Failed to delete competition:', err);
  }
}

deleteBtn.addEventListener('click', showDeleteConfirm);
deleteCancelBtn.addEventListener('click', hideDeleteConfirm);
deleteConfirmBtn.addEventListener('click', confirmDelete);

// ============================================================================
// Cleanup suggestions
// ============================================================================

const MAX_AGE_DAYS = 30;
const MAX_COMPETITIONS = 10;
const cleanupBanner = document.getElementById('cleanup-banner');
const cleanupText = document.getElementById('cleanup-text');
const cleanupActionBtn = document.getElementById('cleanup-action');
const cleanupDismissBtn = document.getElementById('cleanup-dismiss');
let cleanupCandidateIds = [];

function checkCleanupNeeded(competitions) {
  if (!competitions || competitions.length === 0) return;

  const now = Date.now();
  const thirtyDaysMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const oldComps = competitions.filter(c => (now - new Date(c.createdAt).getTime()) > thirtyDaysMs);

  if (oldComps.length > 0) {
    cleanupCandidateIds = oldComps.map(c => c.id);
    cleanupText.textContent = t('competition.cleanupMsg').replace('{count}', String(oldComps.length));
    cleanupBanner.classList.remove('hidden');
    return;
  }

  if (competitions.length > MAX_COMPETITIONS) {
    // Flag oldest beyond the limit
    const sorted = [...competitions].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const excess = sorted.slice(0, competitions.length - MAX_COMPETITIONS);
    cleanupCandidateIds = excess.map(c => c.id);
    cleanupText.textContent = t('competition.cleanupExcess').replace('{count}', String(competitions.length));
    cleanupBanner.classList.remove('hidden');
    return;
  }

  cleanupBanner.classList.add('hidden');
  cleanupCandidateIds = [];
}

cleanupDismissBtn.addEventListener('click', () => {
  cleanupBanner.classList.add('hidden');
});

cleanupActionBtn.addEventListener('click', async () => {
  if (!window.electronAPI?.competitions || cleanupCandidateIds.length === 0) return;
  try {
    const toDelete = cleanupCandidateIds.filter(id => id !== activeCompetitionId);
    if (toDelete.length === 0) {
      // All candidates are the active competition — nothing to delete
      cleanupBanner.classList.add('hidden');
      cleanupCandidateIds = [];
      return;
    }
    for (const id of toDelete) {
      await window.electronAPI.competitions.delete(id);
    }
    cleanupBanner.classList.add('hidden');
    cleanupCandidateIds = [];
    await loadCompetitions();
    updateCardsState();
  } catch (err) {
    console.error('Failed to cleanup competitions:', err);
  }
});

// ============================================================================
// Card navigation
// ============================================================================

document.querySelectorAll('.card').forEach(card => {
  const navigate = () => {
    if (!activeCompetitionId) return;
    const appName = card.dataset.app;
    if (window.electronAPI) {
      window.electronAPI.navigateToApp(appName, activeCompetitionId);
    } else {
      // Fallback for testing in browser
      window.location.href = `../${appName}/index.html?competitionId=${encodeURIComponent(activeCompetitionId)}`;
    }
  };

  card.addEventListener('click', navigate);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate();
    }
  });
});

// ============================================================================
// Language switcher
// ============================================================================

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setLocale(btn.dataset.lang);
  });
});

// ============================================================================
// Initialize
// ============================================================================

(async () => {
  const locale = await getLocale();
  currentLocale = locale;
  applyTranslations(locale);
  updateLangButtons(locale);
  document.documentElement.lang = locale;
  // Set initial menu language
  if (window.electronAPI?.setMenuLocale) {
    const storageValue = locale === 'cs' ? 'cz' : locale;
    window.electronAPI.setMenuLocale(storageValue);
  }
  // Load competitions
  await loadCompetitions();
})();
