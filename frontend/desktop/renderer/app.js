// Translations
const translations = {
  cs: {
    title: 'Nástroje pro navigační soutěže',
    subtitle: 'Vyberte aplikaci',
    'corridors.title': 'Foto koridory',
    'corridors.desc': 'Interaktivní vizualizace koridorů',
    'helper.title': 'Foto pomocník',
    'helper.desc': 'Organizace a označování soutěžních fotek'
  },
  en: {
    title: 'Navigation Flying Tools',
    subtitle: 'Select an application',
    'corridors.title': 'Photo Corridors',
    'corridors.desc': 'Interactive corridor visualization',
    'helper.title': 'Photo Helper',
    'helper.desc': 'Organize and label competition photos'
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

  applyTranslations(locale);
  updateLangButtons(locale);
  document.documentElement.lang = locale;

  // Update Electron menu language
  if (window.electronAPI?.setMenuLocale) {
    window.electronAPI.setMenuLocale(storageValue);
  }
}

function applyTranslations(locale) {
  const t = translations[locale] || translations.cs;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key]) {
      el.textContent = t[key];
    }
  });
}

function updateLangButtons(locale) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === locale);
  });
}

// Initialize language
(async () => {
  const currentLocale = await getLocale();
  applyTranslations(currentLocale);
  updateLangButtons(currentLocale);
  document.documentElement.lang = currentLocale;
  // Set initial menu language
  if (window.electronAPI?.setMenuLocale) {
    const storageValue = currentLocale === 'cs' ? 'cz' : currentLocale;
    window.electronAPI.setMenuLocale(storageValue);
  }
})();

// Language switcher
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setLocale(btn.dataset.lang);
  });
});

// Card navigation
document.querySelectorAll('.card').forEach(card => {
  const navigate = () => {
    const appName = card.dataset.app;
    if (window.electronAPI) {
      window.electronAPI.navigateToApp(appName);
    } else {
      // Fallback for testing in browser
      window.location.href = `../${appName}/index.html`;
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
