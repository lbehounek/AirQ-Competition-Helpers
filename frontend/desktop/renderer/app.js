// Translations with proper Czech diacritics
const translations = {
  cs: {
    'title': 'AirQ Competition Helpers',
    'subtitle': 'Vyberte aplikaci',
    'corridors-title': 'Foto koridory',
    'corridors-desc': 'Interaktivní vizualizace koridorů',
    'photo-title': 'Foto pomocník',
    'photo-desc': 'Organizace a označování soutěžních fotek',
    'footer': 'AirQ Competition Helpers - Desktop Edition'
  },
  en: {
    'title': 'AirQ Competition Helpers',
    'subtitle': 'Select an application',
    'corridors-title': 'Photo Corridors',
    'corridors-desc': 'Interactive corridor visualization',
    'photo-title': 'Photo Helper',
    'photo-desc': 'Competition photo organization and labeling',
    'footer': 'AirQ Competition Helpers - Desktop Edition'
  }
};

let currentLang = localStorage.getItem('desktop-lang') || 'cs';

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('desktop-lang', lang);

  // Update UI
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang][key]) {
      el.textContent = translations[lang][key];
    }
  });

  // Update button states
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

// Initialize language
setLanguage(currentLang);

// Language toggle
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
});

// Card navigation
document.querySelectorAll('.card').forEach(card => {
  const navigate = () => {
    const appName = card.dataset.app;
    if (window.electronAPI) {
      window.electronAPI.navigateToApp(appName);
    } else {
      // Fallback for testing in browser
      window.location.href = `app://${appName}/index.html`;
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
