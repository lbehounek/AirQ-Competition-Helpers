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
