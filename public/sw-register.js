// Service worker kaydı — CSP için inline script yerine harici dosya
// (script-src'den 'unsafe-inline' kaldırılabilsin diye).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
