/* "Uygulamayı yükle" — Android/Chrome için yerel istem, iPhone/Safari için talimat. */
(function () {
  'use strict';
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  var card = document.getElementById('installCard');
  var btn = document.getElementById('installBtn');
  var close = document.getElementById('installClose');
  var modal = document.getElementById('iosModal');
  if (!card || !btn) return;

  var ua = navigator.userAgent || '';
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isIOSOtherBrowser = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  var isAndroid = /Android/i.test(ua);
  var KEY = 'hb_install_dismissed';

  function dismissed() {
    try { var t = Number(localStorage.getItem(KEY)); return t && Date.now() - t < 7 * 864e5; } catch (e) { return false; }
  }
  function show() { if (!isStandalone && !dismissed()) card.classList.remove('hidden'); }
  function hide() { card.classList.add('hidden'); }

  if (isStandalone) return;

  close && close.addEventListener('click', function () {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    hide();
  });

  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    show();
  });
  window.addEventListener('appinstalled', hide);

  function openModal(title, steps, note) {
    if (!modal) return;
    if (title) modal.querySelector('h3').textContent = title;
    if (steps) document.getElementById('iosSteps').innerHTML = steps;
    document.getElementById('iosNote').textContent = note || '';
    modal.classList.remove('hidden');
  }
  if (modal) {
    document.getElementById('iosOk').addEventListener('click', function () { modal.classList.add('hidden'); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
  }

  btn.addEventListener('click', function () {
    if (deferred) {
      deferred.prompt();
      deferred.userChoice.then(function (c) { if (c.outcome === 'accepted') hide(); deferred = null; });
      return;
    }
    if (isIOS) {
      openModal('iPhone\'a yükle', null, isIOSOtherBrowser
        ? 'Chrome kullanıyorsan Paylaş butonu adres çubuğunun sağındadır. Sorun olursa sayfayı Safari\'de aç.'
        : '');
      return;
    }
    openModal(isAndroid ? 'Android\'e yükle' : 'Bilgisayara yükle',
      '<li>Tarayıcının sağ üstündeki <b>⋮</b> menüsüne dokun</li>' +
      '<li><b>Uygulamayı yükle</b> veya <b>Ana ekrana ekle</b>\'yi seç</li>' +
      '<li><b>Yükle</b>\'ye dokun. Hair Boss ana ekranında!</li>',
      'En iyi sonuç için Chrome kullan.');
  });

  // iOS'ta yerel istem yok, kartı doğrudan göster. Diğerlerinde olay gelmezse kısa süre sonra göster.
  if (isIOS) show();
  else setTimeout(function () { if (!deferred) show(); }, 2500);
})();
