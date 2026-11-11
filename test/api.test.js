'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const { openDb } = require('../lib/db');
const { nowIstanbul, addDays } = require('../lib/time');
const { normalizePhone } = require('../lib/phone');

function setup() {
  const sent = [];
  const env = { ADMIN_PASSWORD: 'gizli', SESSION_SECRET: 'x'.repeat(32) };
  const { app, repo } = createApp({
    env, repo: openDb(':memory:'),
    sendSms: async (phone, msg) => { sent.push({ phone, msg }); return { ok: true, status: 'gönderildi' }; },
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const req = async (method, path, body) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { server, req, repo, sent };
}

test('telefon normalize', () => {
  assert.strictEqual(normalizePhone('0532 123 45 67'), '5321234567');
  assert.strictEqual(normalizePhone('+90 (532) 123-45-67'), '5321234567');
  assert.strictEqual(normalizePhone('5321234567'), '5321234567');
  assert.strictEqual(normalizePhone('0212 123 45 67'), null);
  assert.strictEqual(normalizePhone('123'), null);
});

test('uçtan uca randevu akışı', async (t) => {
  const { server, req, sent } = setup();
  t.after(() => server.close());
  const tomorrow = addDays(nowIstanbul().date, 1);

  // Yönetici girişi olmadan erişim yok
  assert.strictEqual((await req('GET', '/api/admin/me')).status, 401);
  assert.strictEqual((await req('POST', '/api/admin/login', { password: 'yanlis' })).status, 401);
  assert.strictEqual((await req('POST', '/api/admin/login', { password: 'gizli' })).status, 200);
  assert.strictEqual((await req('GET', '/api/admin/me')).status, 200);

  // Gün kapalıyken müşteri göremez
  let days = await req('GET', '/api/days');
  assert.strictEqual(days.body.days.length, 0);

  // Yarını 10:00-12:00 aç, 11:00-11:30 mola
  let r = await req('PUT', '/api/admin/workdays', {
    dates: [tomorrow], start_time: '10:00', end_time: '12:00', break_start: '11:00', break_end: '11:30',
  });
  assert.strictEqual(r.status, 200);
  days = await req('GET', '/api/days');
  assert.deepStrictEqual(days.body.days, [{ date: tomorrow, free: 3 }]);
  let slots = await req('GET', `/api/slots?date=${tomorrow}`);
  assert.deepStrictEqual(slots.body.slots.map((s) => s.time), ['10:00', '10:30', '11:30']);

  // Geçersiz telefon
  r = await req('POST', '/api/appointments', { date: tomorrow, time: '10:00', name: 'Ali Veli', phone: '123' });
  assert.strictEqual(r.status, 400);
  // Mola saatine randevu alınamaz
  r = await req('POST', '/api/appointments', { date: tomorrow, time: '11:00', name: 'Ali Veli', phone: '05321234567' });
  assert.strictEqual(r.status, 409);

  // Başarılı randevu + SMS
  r = await req('POST', '/api/appointments', { date: tomorrow, time: '10:00', name: 'Ali Veli', phone: '0532 123 45 67' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].phone, '5321234567');
  assert.match(sent[0].msg, /10:00/);

  // Aynı saate ikinci randevu olmaz
  r = await req('POST', '/api/appointments', { date: tomorrow, time: '10:00', name: 'Ayşe', phone: '05331112233' });
  assert.strictEqual(r.status, 409);
  slots = await req('GET', `/api/slots?date=${tomorrow}`);
  assert.deepStrictEqual(slots.body.slots.find((s) => s.time === '10:00'), { time: '10:00', free: false });

  // Yönetici listede görür, "geldi" işaretleyince saat yine dolu kalır
  const list = await req('GET', `/api/admin/appointments?from=${tomorrow}&to=${tomorrow}`);
  assert.strictEqual(list.body.appointments.length, 1);
  const a = list.body.appointments[0];
  assert.strictEqual(a.phoneText, '0532 123 45 67');
  await req('PATCH', `/api/admin/appointments/${a.id}`, { status: 'done' });
  slots = await req('GET', `/api/slots?date=${tomorrow}`);
  assert.strictEqual(slots.body.slots.find((s) => s.time === '10:00').free, false);

  // İptal edilince saat boşa çıkar
  await req('PATCH', `/api/admin/appointments/${a.id}`, { status: 'cancelled' });
  slots = await req('GET', `/api/slots?date=${tomorrow}`);
  assert.strictEqual(slots.body.slots.find((s) => s.time === '10:00').free, true);

  // Elle randevu (kapalı güne zorla)
  const later = addDays(tomorrow, 2);
  r = await req('POST', '/api/admin/appointments', { date: later, time: '15:00', name: 'Telefon', force: true });
  assert.strictEqual(r.status, 201);

  // Günü kapat
  r = await req('DELETE', '/api/admin/workdays', { dates: [tomorrow] });
  assert.strictEqual(r.status, 200);
  days = await req('GET', '/api/days');
  assert.strictEqual(days.body.days.length, 0);

  // Ayarlar
  r = await req('PUT', '/api/admin/settings', { slot_minutes: 45 });
  assert.strictEqual(r.body.settings.slot_minutes, 45);
  r = await req('PUT', '/api/admin/settings', { slot_minutes: 5 });
  assert.strictEqual(r.status, 400);
});

test('geçmiş saatler ve günler müşteriye kapalı', () => {
  const repo = openDb(':memory:');
  repo.upsertDay({ date: '2026-01-10', start_time: '10:00', end_time: '12:00' });
  const now = { date: '2026-01-10', minutes: 10 * 60 + 10 }; // 10:10, 30 dk ön bildirim
  const s = repo.slotsForDate('2026-01-10', now);
  assert.deepStrictEqual(s.filter((x) => x.free).map((x) => x.time), ['11:00', '11:30']);
  assert.deepStrictEqual(repo.slotsForDate('2026-01-09', now), []);
});
