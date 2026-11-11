'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));

const express = require('express');
const { openDb } = require('./lib/db');
const { sendSms, isConfigured: smsConfigured } = require('./lib/sms');
const { normalizePhone, formatPhone } = require('./lib/phone');
const {
  nowIstanbul, isValidDate, isValidTime, toMin, addDays, humanDate,
} = require('./lib/time');

const SALON_NAME = 'Batuhan Veysel Hair Boss';

function createApp(options = {}) {
  const env = options.env || process.env;
  const repo = options.repo || openDb(env.DB_PATH || path.join(__dirname, 'data', 'randevu.db'));
  const sms = options.sendSms || sendSms;
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD;
  const SESSION_SECRET = env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  if (!ADMIN_PASSWORD) console.warn('UYARI: ADMIN_PASSWORD tanımlı değil, yönetim paneline giriş kapalı.');
  if (!env.SESSION_SECRET) console.warn('UYARI: SESSION_SECRET tanımlı değil, sunucu yeniden başlayınca oturumlar kapanır.');

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  // ---------- Basit hız sınırlayıcı ----------
  function rateLimit(max, windowMs) {
    const hits = new Map();
    return (req, res, next) => {
      const now = Date.now();
      const key = req.ip;
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (arr.length >= max) {
        return res.status(429).json({ error: 'Çok fazla deneme yaptınız, lütfen biraz sonra tekrar deneyin.' });
      }
      arr.push(now);
      hits.set(key, arr);
      if (hits.size > 5000) hits.clear();
      next();
    };
  }

  // ---------- Oturum (imzalı çerez) ----------
  const COOKIE = 'hb_admin';
  const SESSION_DAYS = 30;
  function sign(payload) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  }
  function makeToken() {
    const exp = String(Date.now() + SESSION_DAYS * 864e5);
    return `${exp}.${sign(exp)}`;
  }
  function verifyToken(tok) {
    if (!tok || typeof tok !== 'string') return false;
    const [exp, sig] = tok.split('.');
    if (!exp || !sig) return false;
    const good = sign(exp);
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
    return Number(exp) > Date.now();
  }
  function getCookie(req, name) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
  }
  function requireAdmin(req, res, next) {
    if (verifyToken(getCookie(req, COOKIE))) return next();
    res.status(401).json({ error: 'Giriş yapmanız gerekiyor.' });
  }
  function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  function cleanText(s, max) {
    return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
  }

  function confirmationMessage(a) {
    let msg = `Sayın ${a.name}, ${SALON_NAME} randevunuz oluşturuldu: ${humanDate(a.date)} saat ${a.time}.`;
    if (env.SALON_ADDRESS) msg += ` Adres: ${env.SALON_ADDRESS}.`;
    if (env.SALON_PHONE) msg += ` İptal/değişiklik için: ${env.SALON_PHONE}`;
    return msg;
  }

  // =============== MÜŞTERİ API ===============
  app.get('/api/info', (req, res) => {
    res.json({
      name: SALON_NAME,
      address: env.SALON_ADDRESS || '',
      phone: env.SALON_PHONE || '',
      slot_minutes: repo.settings().slot_minutes,
    });
  });

  app.get('/api/days', (req, res) => {
    res.json({ today: nowIstanbul().date, days: repo.openDays() });
  });

  app.get('/api/slots', (req, res) => {
    const { date } = req.query;
    if (!isValidDate(date)) return res.status(400).json({ error: 'Geçersiz tarih.' });
    const now = nowIstanbul();
    const { booking_days_ahead } = repo.settings();
    if (date < now.date || date > addDays(now.date, booking_days_ahead)) return res.json({ slots: [] });
    const slots = repo.slotsForDate(date, now).filter((s) => !s.past).map(({ time, free }) => ({ time, free }));
    res.json({ slots });
  });

  app.post('/api/appointments', rateLimit(10, 60 * 60 * 1000), asyncH(async (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 60);
    const note = cleanText(b.note, 200);
    const phone = normalizePhone(b.phone);
    if (!isValidDate(b.date) || !isValidTime(b.time)) return res.status(400).json({ error: 'Lütfen bir gün ve saat seçin.' });
    if (name.length < 2) return res.status(400).json({ error: 'Lütfen adınızı ve soyadınızı yazın.' });
    if (!phone) return res.status(400).json({ error: 'Lütfen geçerli bir cep telefonu numarası yazın (05XX XXX XX XX).' });

    const today = nowIstanbul().date;
    const { booking_days_ahead } = repo.settings();
    if (b.date > addDays(today, booking_days_ahead)) return res.status(400).json({ error: 'Bu tarih için henüz randevu alınamıyor.' });
    if (repo.futureActiveCountByPhone(phone, today) >= 2) {
      return res.status(409).json({ error: 'Bu numarayla zaten aktif randevunuz var. Değişiklik için lütfen bizi arayın.' });
    }

    const appt = repo.createAppointment({ date: b.date, time: b.time, name, phone, note });

    const r = await sms(phone, confirmationMessage(appt), env);
    repo.setSmsStatus(appt.id, r.status);
    if (env.OWNER_PHONE) {
      const owner = normalizePhone(env.OWNER_PHONE);
      if (owner) {
        sms(owner, `Yeni randevu: ${appt.name} (${formatPhone(phone)}) - ${humanDate(appt.date)} ${appt.time}`, env)
          .catch(() => {});
      }
    }

    res.status(201).json({
      ok: true,
      appointment: { date: appt.date, time: appt.time, name: appt.name, dateText: humanDate(appt.date) },
      sms: r.ok,
    });
  }));

  // =============== YÖNETİM API ===============
  app.post('/api/admin/login', rateLimit(10, 15 * 60 * 1000), (req, res) => {
    const pw = (req.body || {}).password;
    if (!ADMIN_PASSWORD || typeof pw !== 'string' || !safeEqual(pw, ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Şifre yanlış.' });
    }
    res.cookie(COOKIE, makeToken(), {
      httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_DAYS * 864e5, path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/admin/me', requireAdmin, (req, res) => {
    res.json({ ok: true, sms: smsConfigured(env), today: nowIstanbul().date, settings: repo.settings() });
  });

  app.get('/api/admin/appointments', requireAdmin, (req, res) => {
    const today = nowIstanbul().date;
    const from = isValidDate(req.query.from) ? req.query.from : today;
    const to = isValidDate(req.query.to) ? req.query.to : addDays(from, 60);
    const list = repo.appointmentsBetween(from, to).map((a) => ({ ...a, phoneText: formatPhone(a.phone) }));
    res.json({ appointments: list });
  });

  app.get('/api/admin/slots', requireAdmin, (req, res) => {
    const { date } = req.query;
    if (!isValidDate(date)) return res.status(400).json({ error: 'Geçersiz tarih.' });
    const day = repo.getDay(date);
    // Yönetici geçmiş saatleri de görebilsin diye "şimdi"yi o günün başı kabul ediyoruz.
    const slots = repo.slotsForDate(date, { date: '0000-00-00', minutes: 0 })
      .map(({ time, free }) => ({ time, free }));
    res.json({ open: Boolean(day), slots });
  });

  app.post('/api/admin/appointments', requireAdmin, asyncH(async (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 60) || 'Müşteri';
    const phone = b.phone ? normalizePhone(b.phone) : '';
    if (b.phone && !phone) return res.status(400).json({ error: 'Telefon numarası geçersiz.' });
    if (!isValidDate(b.date) || !isValidTime(b.time)) return res.status(400).json({ error: 'Gün ve saat seçin.' });
    const appt = repo.createAppointment({
      date: b.date, time: b.time, name, phone: phone || '', note: cleanText(b.note, 200), source: 'admin', force: Boolean(b.force),
    });
    if (phone && b.sendSms) {
      const r = await sms(phone, confirmationMessage(appt), env);
      repo.setSmsStatus(appt.id, r.status);
    }
    res.status(201).json({ ok: true, appointment: appt });
  }));

  app.patch('/api/admin/appointments/:id', requireAdmin, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const appt = repo.getAppointment(id);
    if (!appt) return res.status(404).json({ error: 'Randevu bulunamadı.' });
    const { status, notify } = req.body || {};
    if (!['active', 'cancelled', 'done'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum.' });
    try {
      repo.setStatus(id, status);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Bu saate başka bir randevu alınmış.' });
      throw e;
    }
    if (status === 'cancelled' && notify && appt.phone) {
      await sms(appt.phone, `Sayın ${appt.name}, ${SALON_NAME} ${humanDate(appt.date)} saat ${appt.time} randevunuz iptal edilmiştir.${env.SALON_PHONE ? ' Bilgi: ' + env.SALON_PHONE : ''}`, env);
    }
    res.json({ ok: true });
  }));

  app.get('/api/admin/workdays', requireAdmin, (req, res) => {
    const today = nowIstanbul().date;
    const from = isValidDate(req.query.from) ? req.query.from : today;
    const to = isValidDate(req.query.to) ? req.query.to : addDays(from, 90);
    const days = repo.daysBetween(from, to).map((d) => ({
      ...d, booked: repo.bookedOnDate(d.date).length,
    }));
    res.json({ days });
  });

  app.put('/api/admin/workdays', requireAdmin, (req, res) => {
    const b = req.body || {};
    const dates = Array.isArray(b.dates) ? b.dates : [];
    if (!dates.length || dates.length > 400 || !dates.every(isValidDate)) return res.status(400).json({ error: 'Gün seçin.' });
    if (!isValidTime(b.start_time) || !isValidTime(b.end_time) || toMin(b.start_time) >= toMin(b.end_time)) {
      return res.status(400).json({ error: 'Başlangıç saati bitişten önce olmalı.' });
    }
    let bs = null; let be = null;
    if (b.break_start || b.break_end) {
      if (!isValidTime(b.break_start) || !isValidTime(b.break_end) || toMin(b.break_start) >= toMin(b.break_end)) {
        return res.status(400).json({ error: 'Mola saatleri geçersiz.' });
      }
      bs = b.break_start; be = b.break_end;
    }
    repo.db.exec('BEGIN');
    try {
      for (const date of dates) repo.upsertDay({ date, start_time: b.start_time, end_time: b.end_time, break_start: bs, break_end: be });
      repo.db.exec('COMMIT');
    } catch (e) {
      repo.db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true });
  });

  app.delete('/api/admin/workdays', requireAdmin, (req, res) => {
    const dates = Array.isArray((req.body || {}).dates) ? req.body.dates : [];
    if (!dates.every(isValidDate)) return res.status(400).json({ error: 'Geçersiz tarih.' });
    const withAppts = dates.filter((d) => repo.bookedOnDate(d).length > 0);
    for (const d of dates) repo.deleteDay(d);
    res.json({ ok: true, warning: withAppts.length ? withAppts : null });
  });

  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const b = req.body || {};
    const upd = {};
    if (b.slot_minutes !== undefined) {
      const n = Number(b.slot_minutes);
      if (!Number.isInteger(n) || n < 10 || n > 240) return res.status(400).json({ error: 'Randevu süresi 10-240 dakika olmalı.' });
      upd.slot_minutes = n;
    }
    if (b.booking_days_ahead !== undefined) {
      const n = Number(b.booking_days_ahead);
      if (!Number.isInteger(n) || n < 1 || n > 365) return res.status(400).json({ error: 'Gün sayısı 1-365 olmalı.' });
      upd.booking_days_ahead = n;
    }
    if (b.min_notice_minutes !== undefined) {
      const n = Number(b.min_notice_minutes);
      if (!Number.isInteger(n) || n < 0 || n > 1440) return res.status(400).json({ error: 'Geçersiz değer.' });
      upd.min_notice_minutes = n;
    }
    repo.updateSettings(upd);
    res.json({ ok: true, settings: repo.settings() });
  });

  // =============== Statik dosyalar ===============
  const pub = path.join(__dirname, 'public');
  app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
  app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(pub, 'sw.js'));
  });
  app.use(express.static(pub, { maxAge: '1h' }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz istek.' });
    console.error(err);
    res.status(500).json({ error: 'Bir hata oluştu, lütfen tekrar deneyin.' });
  });

  return { app, repo };
}

if (require.main === module) {
  const { app } = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`${SALON_NAME} randevu sistemi http://localhost:${port} adresinde çalışıyor`));
}

module.exports = { createApp };
