(function () {
  'use strict';
  var DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  var MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  var LONG_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var LONG_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

  var $ = function (id) { return document.getElementById(id); };
  var state = { date: null, time: null };

  function parse(d) { var p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function longDate(d) { var x = parse(d); return x.getUTCDate() + ' ' + LONG_MONTHS[x.getUTCMonth()] + ' ' + LONG_DAYS[x.getUTCDay()]; }

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || 'Bir hata oluştu.');
          return data;
        });
      });
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---- Salon bilgisi ----
  api('/api/info').then(function (info) {
    var parts = [];
    if (info.phone) parts.push('<a href="tel:' + info.phone.replace(/\s/g, '') + '">' + escapeHtml(info.phone) + '</a>');
    if (info.address) parts.push(escapeHtml(info.address));
    $('contact').innerHTML = parts.join(' · ');
  }).catch(function () {});

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }

  // ---- Günler ----
  function loadDays() {
    $('days').innerHTML = '<div class="spinner"></div>';
    api('/api/days').then(function (data) {
      var box = $('days');
      box.innerHTML = '';
      if (!data.days.length) {
        box.appendChild(el('div', 'empty', 'Şu an açık randevu günü yok.<br>Lütfen daha sonra tekrar bak.'));
        return;
      }
      var firstFree = null;
      data.days.forEach(function (d) {
        var x = parse(d.date);
        var b = el('button', 'day' + (d.free ? '' : ' full'));
        b.type = 'button';
        b.dataset.date = d.date;
        b.disabled = !d.free;
        b.innerHTML = '<div class="dname">' + (d.date === data.today ? 'Bugün' : DAYS[x.getUTCDay()]) + '</div>' +
          '<div class="dnum">' + x.getUTCDate() + '</div>' +
          '<div class="dmon">' + MONTHS[x.getUTCMonth()] + '</div>' +
          '<div class="dfree">' + (d.free ? d.free + ' boş' : 'Dolu') + '</div>';
        b.addEventListener('click', function () { selectDay(d.date); });
        box.appendChild(b);
        if (d.free && !firstFree) firstFree = d.date;
      });
      if (state.date && data.days.some(function (d) { return d.date === state.date && d.free; })) selectDay(state.date);
      else if (firstFree) selectDay(firstFree);
    }).catch(function (e) {
      $('days').innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>';
    });
  }

  function selectDay(date) {
    state.date = date;
    state.time = null;
    Array.prototype.forEach.call(document.querySelectorAll('.day'), function (b) {
      b.classList.toggle('sel', b.dataset.date === date);
    });
    $('formCard').classList.add('hidden');
    $('slotsCard').classList.remove('hidden');
    var box = $('slots');
    box.innerHTML = '<div class="spinner"></div>';
    api('/api/slots?date=' + date).then(function (data) {
      if (state.date !== date) return;
      box.innerHTML = '';
      if (!data.slots.some(function (s) { return s.free; })) {
        box.appendChild(el('div', 'empty', 'Bu gün için boş saat kalmadı.'));
        return;
      }
      data.slots.forEach(function (s) {
        var b = el('button', 'slot', s.time);
        b.type = 'button';
        b.disabled = !s.free;
        b.dataset.time = s.time;
        b.addEventListener('click', function () { selectTime(s.time); });
        box.appendChild(b);
      });
    }).catch(function (e) { box.innerHTML = '<div class="empty">' + escapeHtml(e.message) + '</div>'; });
  }

  function selectTime(time) {
    state.time = time;
    Array.prototype.forEach.call(document.querySelectorAll('.slot'), function (b) {
      b.classList.toggle('sel', b.dataset.time === time);
    });
    $('summary').innerHTML = '<b>' + longDate(state.date) + '</b> · saat <b>' + time + '</b>';
    $('err').classList.add('hidden');
    var fc = $('formCard');
    fc.classList.remove('hidden');
    setTimeout(function () { fc.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }

  // Kayıtlı bilgileri hatırla (aynı cihazdan tekrar randevu kolay olsun)
  try {
    var saved = JSON.parse(localStorage.getItem('hb_customer') || '{}');
    if (saved.name) $('name').value = saved.name;
    if (saved.phone) $('phone').value = saved.phone;
  } catch (e) {}

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('err');
    err.classList.add('hidden');
    var name = $('name').value.trim();
    var phone = $('phone').value.trim();
    var digits = phone.replace(/\D/g, '').replace(/^90(?=5\d{9}$)/, '').replace(/^0(?=5\d{9}$)/, '');
    if (name.length < 2) return showErr('Lütfen adını ve soyadını yaz.');
    if (!/^5\d{9}$/.test(digits)) return showErr('Lütfen geçerli bir cep telefonu yaz (05XX XXX XX XX).');
    var btn = $('submit');
    btn.disabled = true;
    btn.textContent = 'Gönderiliyor...';
    api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({ date: state.date, time: state.time, name: name, phone: phone, note: $('note').value }),
    }).then(function (data) {
      try { localStorage.setItem('hb_customer', JSON.stringify({ name: name, phone: phone })); } catch (e) {}
      $('booking').classList.add('hidden');
      $('done').classList.remove('hidden');
      $('doneText').textContent = data.appointment.dateText + ' · ' + data.appointment.time;
      $('doneSms').textContent = data.sms
        ? 'Onay SMS\'i telefonuna gönderildi. Görüşmek üzere!'
        : 'Görüşmek üzere! Değişiklik için bizi arayabilirsin.';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function (e) {
      showErr(e.message);
      loadDays();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Randevuyu Onayla';
    });

    function showErr(m) { err.textContent = m; err.classList.remove('hidden'); }
  });

  $('again').addEventListener('click', function () {
    state.time = null;
    $('note').value = '';
    $('done').classList.add('hidden');
    $('booking').classList.remove('hidden');
    $('formCard').classList.add('hidden');
    loadDays();
  });

  // Dışarıdan yenileme isteği (ör. önizleme ortamı)
  window.addEventListener('hb-refresh', function () { if (!$('booking').classList.contains('hidden') && $('formCard').classList.contains('hidden')) loadDays(); });

  loadDays();
})();
