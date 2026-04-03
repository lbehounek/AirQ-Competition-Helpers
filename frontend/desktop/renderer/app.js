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
    'competition.cleanupExcess': 'Máte {count} soutěží (max 10). Zvažte smazání starších.'
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
    'competition.cleanupExcess': 'You have {count} competitions (max 10). Consider deleting older ones.'
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

    if (competitions.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('competition.empty');
      selectEl.appendChild(opt);
      selectEl.disabled = true;
      activeCompetitionId = null;
      updateCardsState();
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
    checkCleanupNeeded(competitions);
  } catch (err) {
    console.error('Failed to load competitions:', err);
    selectEl.disabled = true;
  }
}

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

function showCreateForm() {
  barSelect.classList.add('hidden');
  barCreate.classList.remove('hidden');
  nameInput.value = t('competition.defaultName');
  nameInput.focus();
  nameInput.select();
}

function hideCreateForm() {
  barCreate.classList.add('hidden');
  barSelect.classList.remove('hidden');
}

async function confirmCreate() {
  const name = nameInput.value.trim();
  if (!name) return;
  if (!window.electronAPI?.competitions) return;

  try {
    const metadata = await window.electronAPI.competitions.create(name);
    hideCreateForm();
    await loadCompetitions();
    selectEl.value = metadata.id;
    activeCompetitionId = metadata.id;
    updateCardsState();
  } catch (err) {
    console.error('Failed to create competition:', err);
  }
}

newBtn.addEventListener('click', showCreateForm);
cancelBtn.addEventListener('click', hideCreateForm);
confirmBtn.addEventListener('click', confirmCreate);
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
