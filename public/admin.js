(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LONG_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  var LONG_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  var WD = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

  var S = { today: null, settings: null, filter: 'upcoming', month: null, workdays: {}, selected: new Set() };

  // ---------- yardımcılar ----------
  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && path !== '/api/admin/login') { showLogin(); throw new Error(data.error || 'Giriş gerekli'); }
          if (!r.ok) throw new Error(data.error || 'Bir hata oluştu.');
          return data;
        });
      });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }
  function parse(d) { var p = d.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function iso(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(d, n) { var x = parse(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
  function longDate(d) { var x = parse(d); return x.getUTCDate() + ' ' + LONG_MONTHS[x.getUTCMonth()] + ' ' + LONG_DAYS[x.getUTCDay()]; }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // ---------- giriş ----------
  function showLogin() {
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    setTimeout(function () { $('pw').focus(); }, 50);
  }
  function showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginErr').classList.add('hidden');
    api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) })
      .then(function () { $('pw').value = ''; boot(); })
      .catch(function (err) { $('loginErr').textContent = err.message; $('loginErr').classList.remove('hidden'); });
  });
  $('logout').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).then(showLogin);
  });

  function boot() {
    api('/api/admin/me').then(function (me) {
      S.today = me.today;
      S.settings = me.settings;
      if (!S.month) S.month = me.today.slice(0, 7);
      showApp();
      fillSettings(me);
      loadAppts();
      loadWorkdays();
    }).catch(function () {});
  }

  // ---------- sekmeler ----------
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x === b); });
      ['appts', 'days', 'settings'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab); });
      if (b.dataset.tab === 'appts') loadAppts();
      if (b.dataset.tab === 'days') loadWorkdays();
    });
  });
  $('refresh').addEventListener('click', function () { boot(); toast('Yenilendi'); });

  // ---------- randevular ----------
  document.querySelectorAll('#filterChips .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      S.filter = c.dataset.f;
      document.querySelectorAll('#filterChips .chip').forEach(function (x) { x.classList.toggle('on', x === c); });
      loadAppts();
    });
  });
  $('showCancelled').addEventListener('change', function () { loadAppts(); });

  function loadAppts() {
    var from = S.today; var to = addDays(S.today, 120);
    if (S.filter === 'today') { to = S.today; }
    if (S.filter === 'tomorrow') { from = to = addDays(S.today, 1); }
    if (S.filter === 'past') { from = addDays(S.today, -60); to = addDays(S.today, -1); }
    var box = $('apptList');
    box.innerHTML = '<div class="spinner"></div>';

    // istatistikler
    api('/api/admin/appointments?from=' + S.today + '&to=' + addDays(S.today, 6)).then(function (d) {
      var act = d.appointments.filter(function (a) { return a.status !== 'cancelled'; });
      $('stToday').textContent = act.filter(function (a) { return a.date === S.today; }).length;
      $('stTomorrow').textContent = act.filter(function (a) { return a.date === addDays(S.today, 1); }).length;
      $('stWeek').textContent = act.length;
    }).catch(function () {});

    api('/api/admin/appointments?from=' + from + '&to=' + to).then(function (d) {
      var list = d.appointments;
      if (!$('showCancelled').checked) list = list.filter(function (a) { return a.status !== 'cancelled'; });
      if (S.filter === 'past') list.reverse();
      box.innerHTML = '';
      if (!list.length) { box.innerHTML = '<div class="empty">Randevu yok.</div>'; return; }
      var lastDate = null;
      list.forEach(function (a) {
        if (a.date !== lastDate) {
          lastDate = a.date;
          var cnt = list.filter(function (x) { return x.date === a.date && x.status !== 'cancelled'; }).length;
          var h = document.createElement('div');
          h.className = 'date-head';
          h.innerHTML = '<span>' + (a.date === S.today ? 'Bugün · ' : a.date === addDays(S.today, 1) ? 'Yarın · ' : '') + esc(longDate(a.date)) + '</span><span class="muted small">' + cnt + ' randevu</span>';
          box.appendChild(h);
        }
        box.appendChild(apptCard(a));
      });
    }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function apptCard(a) {
    var d = document.createElement('div');
    d.className = 'appt ' + a.status;
    var badge = a.status === 'cancelled' ? '<span class="badge c">İptal</span>'
      : a.status === 'done' ? '<span class="badge d">Geldi</span>' : '';
    var src = a.source === 'admin' ? '<span class="badge">Elle</span>' : '';
    var phone = a.phone
      ? '<div class="ph"><a href="tel:0' + esc(a.phone) + '">📞 ' + esc(a.phoneText) + '</a> · <a href="https://wa.me/90' + esc(a.phone) + '" target="_blank" rel="noopener">WhatsApp</a></div>'
      : '';
    var sms = a.sms_status ? '<div class="note">SMS: ' + esc(a.sms_status) + '</div>' : '';
    d.innerHTML = '<div class="t">' + esc(a.time) + '</div><div class="info">' +
      '<div class="nm">' + esc(a.name) + badge + src + '</div>' + phone +
      (a.note ? '<div class="note">“' + esc(a.note) + '”</div>' : '') + sms +
      '<div class="acts"></div></div>';
    var acts = d.querySelector('.acts');
    function btn(label, cls, fn) {
      var b = document.createElement('button');
      b.className = 'btn small ' + cls;
      b.textContent = label;
      b.addEventListener('click', fn);
      acts.appendChild(b);
    }
    if (a.status === 'active') {
      btn('✓ Geldi', 'ghost', function () { setStatus(a, 'done'); });
      btn('İptal et', 'danger', function () {
        if (!confirm(a.name + ' — ' + longDate(a.date) + ' ' + a.time + ' randevusu iptal edilsin mi?')) return;
        var notify = a.phone ? confirm('Müşteriye iptal SMS\'i gönderilsin mi?') : false;
        setStatus(a, 'cancelled', notify);
      });
    } else {
      btn('Geri al', 'ghost', function () { setStatus(a, 'active'); });
    }
    return d;
  }

  function setStatus(a, status, notify) {
    api('/api/admin/appointments/' + a.id, { method: 'PATCH', body: JSON.stringify({ status: status, notify: !!notify }) })
      .then(function () { toast(status === 'cancelled' ? 'İptal edildi' : status === 'done' ? 'İşaretlendi' : 'Geri alındı'); loadAppts(); })
      .catch(function (e) { alert(e.message); });
  }

  // ---------- elle randevu ekleme ----------
  var addForce = false;
  $('addAppt').addEventListener('click', function () {
    $('aDate').value = S.today;
    $('aName').value = ''; $('aPhone').value = ''; $('aNote').value = ''; $('aSms').checked = false;
    $('addErr').classList.add('hidden');
    $('addModal').classList.remove('hidden');
    loadAdminSlots();
  });
  $('aDate').addEventListener('change', loadAdminSlots);
  $('addCancel').addEventListener('click', function () { $('addModal').classList.add('hidden'); });

  function loadAdminSlots() {
    var sel = $('aTime');
    sel.innerHTML = '<option>Yükleniyor...</option>';
    if (!$('aDate').value) return;
    api('/api/admin/slots?date=' + $('aDate').value).then(function (d) {
      sel.innerHTML = '';
      addForce = !d.open;
      if (d.open) {
        d.slots.forEach(function (s) {
          var o = document.createElement('option');
          o.value = s.time; o.textContent = s.time + (s.free ? '' : ' (dolu)'); o.disabled = !s.free;
          sel.appendChild(o);
        });
        var first = d.slots.find(function (s) { return s.free; });
        if (first) sel.value = first.time;
        else sel.innerHTML = '<option value="">Boş saat yok</option>';
      } else {
        var step = S.settings.slot_minutes;
        for (var m = 8 * 60; m < 23 * 60; m += step) {
          var t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
          var o = document.createElement('option'); o.value = o.textContent = t; sel.appendChild(o);
        }
        var o2 = document.createElement('option'); o2.disabled = true; o2.textContent = '— bu gün kapalı —'; sel.insertBefore(o2, sel.firstChild);
        sel.value = '10:00';
      }
    }).catch(function (e) { sel.innerHTML = '<option value="">' + esc(e.message) + '</option>'; });
  }

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('addErr');
    err.classList.add('hidden');
    api('/api/admin/appointments', {
      method: 'POST',
      body: JSON.stringify({
        date: $('aDate').value, time: $('aTime').value, name: $('aName').value,
        phone: $('aPhone').value, note: $('aNote').value, sendSms: $('aSms').checked, force: addForce,
      }),
    }).then(function () {
      $('addModal').classList.add('hidden');
      toast('Randevu eklendi');
      loadAppts();
    }).catch(function (e2) { err.textContent = e2.message; err.classList.remove('hidden'); });
  });

  // ---------- çalışma günleri (takvim) ----------
  $('prevMonth').addEventListener('click', function () { shiftMonth(-1); });
  $('nextMonth').addEventListener('click', function () { shiftMonth(1); });
  function shiftMonth(n) {
    var p = S.month.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    S.month = iso(d).slice(0, 7);
    loadWorkdays();
  }

  function loadWorkdays() {
    if (!S.month) return;
    var from = S.month + '-01';
    var p = S.month.split('-').map(Number);
    var to = iso(new Date(Date.UTC(p[0], p[1], 0)));
    api('/api/admin/workdays?from=' + from + '&to=' + to).then(function (d) {
      S.workdays = {};
      d.days.forEach(function (w) { S.workdays[w.date] = w; });
      renderCal();
    }).catch(function () {});
  }

  function renderCal() {
    var p = S.month.split('-').map(Number);
    $('monthTitle').textContent = LONG_MONTHS[p[1] - 1] + ' ' + p[0];
    var cal = $('cal');
    cal.innerHTML = '';
    WD.forEach(function (w, i) {
      var h = document.createElement('div');
      h.className = 'wd'; h.textContent = w; h.title = 'Bu ayın tüm ' + w + ' günlerini seç';
      h.addEventListener('click', function () { selectWeekday((i + 1) % 7); });
      cal.appendChild(h);
    });
    var first = new Date(Date.UTC(p[0], p[1] - 1, 1));
    var offset = (first.getUTCDay() + 6) % 7; // Pazartesi başlangıç
    for (var i = 0; i < offset; i++) { var b = document.createElement('div'); b.className = 'cd blank'; cal.appendChild(b); }
    var days = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    for (var dd = 1; dd <= days; dd++) {
      var date = S.month + '-' + String(dd).padStart(2, '0');
      cal.appendChild(dayCell(date, dd));
    }
    updateSelInfo();
  }

  function dayCell(date, n) {
    var c = document.createElement('div');
    var w = S.workdays[date];
    var past = date < S.today;
    c.className = 'cd' + (w ? ' open' : '') + (past ? ' past' : '') + (date === S.today ? ' today' : '') + (S.selected.has(date) ? ' sel' : '');
    c.innerHTML = '<span class="n">' + n + '</span>' +
      (w ? '<span class="h">' + w.start_time + '<br>' + w.end_time + '</span>' + (w.booked ? '<span class="b">' + w.booked + ' rnd</span>' : '') : '');
    if (!past) {
      c.addEventListener('click', function () {
        if (S.selected.has(date)) S.selected.delete(date); else S.selected.add(date);
        if (S.selected.size === 1 && w) { // tek açık gün seçildiyse saatlerini forma getir
          $('dStart').value = w.start_time; $('dEnd').value = w.end_time;
          $('dBreakOn').checked = !!w.break_start; $('breakRow').classList.toggle('hidden', !w.break_start);
          if (w.break_start) { $('dBs').value = w.break_start; $('dBe').value = w.break_end; }
        }
        renderCal();
      });
    }
    return c;
  }

  function selectWeekday(jsDay) {
    var p = S.month.split('-').map(Number);
    var days = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    var dates = [];
    for (var d = 1; d <= days; d++) {
      var date = S.month + '-' + String(d).padStart(2, '0');
      if (parse(date).getUTCDay() === jsDay && date >= S.today) dates.push(date);
    }
    var allSel = dates.every(function (x) { return S.selected.has(x); });
    dates.forEach(function (x) { if (allSel) S.selected.delete(x); else S.selected.add(x); });
    renderCal();
  }

  function updateSelInfo() {
    var n = S.selected.size;
    $('openDays').disabled = $('closeDays').disabled = $('clearSel').disabled = !n;
    $('selInfo').textContent = n ? n + ' gün seçildi.' : 'Gün seçilmedi.';
  }

  $('dBreakOn').addEventListener('change', function () { $('breakRow').classList.toggle('hidden', !this.checked); });
  $('clearSel').addEventListener('click', function () { S.selected.clear(); renderCal(); });

  $('openDays').addEventListener('click', function () {
    var body = { dates: Array.from(S.selected), start_time: $('dStart').value, end_time: $('dEnd').value };
    if ($('dBreakOn').checked) { body.break_start = $('dBs').value; body.break_end = $('dBe').value; }
    api('/api/admin/workdays', { method: 'PUT', body: JSON.stringify(body) }).then(function () {
      toast(S.selected.size + ' gün randevuya açıldı');
      S.selected.clear();
      loadWorkdays();
    }).catch(function (e) { alert(e.message); });
  });

  $('closeDays').addEventListener('click', function () {
    var dates = Array.from(S.selected);
    var booked = dates.filter(function (d) { return S.workdays[d] && S.workdays[d].booked; });
    var msg = dates.length + ' gün kapatılsın mı?';
    if (booked.length) msg += '\n\nDİKKAT: ' + booked.length + ' günde alınmış randevu var. Randevular silinmez, Randevular sekmesinden müşterileri arayıp iptal etmen gerekir.';
    if (!confirm(msg)) return;
    api('/api/admin/workdays', { method: 'DELETE', body: JSON.stringify({ dates: dates }) }).then(function () {
      toast('Günler kapatıldı');
      S.selected.clear();
      loadWorkdays();
    }).catch(function (e) { alert(e.message); });
  });

  // ---------- ayarlar ----------
  function fillSettings(me) {
    $('sSlot').value = String(me.settings.slot_minutes);
    if (!$('sSlot').value) {
      var o = document.createElement('option'); o.value = o.textContent = me.settings.slot_minutes; $('sSlot').appendChild(o);
      $('sSlot').value = String(me.settings.slot_minutes);
    }
    $('sAhead').value = me.settings.booking_days_ahead;
    $('sNotice').value = me.settings.min_notice_minutes;
    $('smsInfo').innerHTML = me.sms
      ? '✅ Netgsm bağlı. Müşterilere randevu onay SMS\'i gidiyor.'
      : '⚠️ SMS kapalı. Netgsm bilgileri sunucuya girilince otomatik açılır (kurulum notlarına bak).';
    $('publicLink').value = location.origin + '/';
  }
  $('settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ slot_minutes: Number($('sSlot').value), booking_days_ahead: Number($('sAhead').value), min_notice_minutes: Number($('sNotice').value) }),
    }).then(function (d) { S.settings = d.settings; toast('Kaydedildi'); }).catch(function (e2) { alert(e2.message); });
  });
  $('copyLink').addEventListener('click', function () {
    var v = $('publicLink').value;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Link kopyalandı'); })
      .catch(function () { $('publicLink').select(); document.execCommand('copy'); toast('Link kopyalandı'); });
  });

  // Uygulama öne gelince yenile (telefonda açık bırakıldığında güncel kalsın)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !$('appView').classList.contains('hidden')) loadAppts();
  });

  window.addEventListener('hb-refresh', function () {
    if ($('appView').classList.contains('hidden')) return;
    if (!$('tab-days').classList.contains('hidden')) loadWorkdays(); else loadAppts();
  });

  boot();
  // İlk açılışta 401 gelirse giriş ekranı gösterilir
})();
