'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { toMin, toTime, nowIstanbul, addDays } = require('./time');

const DEFAULT_SETTINGS = {
  slot_minutes: '30',
  // Müşteri en fazla kaç gün sonrasına randevu alabilir
  booking_days_ahead: '30',
  // Bugün için: şu andan en az kaç dakika sonrası alınabilir
  min_notice_minutes: '30',
};

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS work_days (
      date        TEXT PRIMARY KEY,           -- YYYY-MM-DD
      start_time  TEXT NOT NULL,              -- HH:MM
      end_time    TEXT NOT NULL,              -- HH:MM
      break_start TEXT,                       -- HH:MM (isteğe bağlı mola)
      break_end   TEXT
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      time        TEXT NOT NULL,
      duration    INTEGER NOT NULL,
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL,
      note        TEXT,
      status      TEXT NOT NULL DEFAULT 'active',  -- active | cancelled | done
      source      TEXT NOT NULL DEFAULT 'online',  -- online | admin
      sms_status  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_booked_slot
      ON appointments(date, time) WHERE status != 'cancelled';

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  return createRepo(db);
}

function createRepo(db) {
  const q = {
    getSettings: db.prepare('SELECT key, value FROM settings'),
    setSetting: db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    getDay: db.prepare('SELECT * FROM work_days WHERE date = ?'),
    daysBetween: db.prepare('SELECT * FROM work_days WHERE date BETWEEN ? AND ? ORDER BY date'),
    upsertDay: db.prepare(`INSERT INTO work_days(date, start_time, end_time, break_start, break_end)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET
      start_time = excluded.start_time, end_time = excluded.end_time,
      break_start = excluded.break_start, break_end = excluded.break_end`),
    deleteDay: db.prepare('DELETE FROM work_days WHERE date = ?'),
    bookedOnDate: db.prepare("SELECT * FROM appointments WHERE date = ? AND status != 'cancelled' ORDER BY time"),
    apptsBetween: db.prepare('SELECT * FROM appointments WHERE date BETWEEN ? AND ? ORDER BY date, time'),
    insertAppt: db.prepare(`INSERT INTO appointments(date, time, duration, name, phone, note, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    getAppt: db.prepare('SELECT * FROM appointments WHERE id = ?'),
    setStatus: db.prepare('UPDATE appointments SET status = ? WHERE id = ?'),
    setSms: db.prepare('UPDATE appointments SET sms_status = ? WHERE id = ?'),
    futureActiveByPhone: db.prepare(`SELECT COUNT(*) AS n FROM appointments
      WHERE phone = ? AND status = 'active' AND date >= ?`),
  };

  function settings() {
    const s = { ...DEFAULT_SETTINGS };
    for (const r of q.getSettings.all()) s[r.key] = r.value;
    return {
      slot_minutes: Number(s.slot_minutes),
      booking_days_ahead: Number(s.booking_days_ahead),
      min_notice_minutes: Number(s.min_notice_minutes),
    };
  }

  /**
   * Bir gün için tüm dilimleri ve doluluk durumunu hesaplar.
   * @returns {Array<{time:string, free:boolean, past:boolean}>}
   */
  function slotsForDate(date, now = nowIstanbul()) {
    const day = q.getDay.get(date);
    if (!day) return [];
    const { slot_minutes: step, min_notice_minutes: notice } = settings();
    const start = toMin(day.start_time);
    const end = toMin(day.end_time);
    const bS = day.break_start ? toMin(day.break_start) : null;
    const bE = day.break_end ? toMin(day.break_end) : null;
    const busy = q.bookedOnDate.all(date).map((a) => [toMin(a.time), toMin(a.time) + a.duration]);

    const out = [];
    for (let t = start; t + step <= end; t += step) {
      const tEnd = t + step;
      if (bS !== null && bE !== null && t < bE && tEnd > bS) continue; // mola
      const taken = busy.some(([s, e]) => t < e && tEnd > s);
      const past = date < now.date || (date === now.date && t < now.minutes + notice);
      out.push({ time: toTime(t), free: !taken && !past, past });
    }
    return out;
  }

  /** Müşteriye gösterilecek açık günler (bugünden itibaren) */
  function openDays(now = nowIstanbul()) {
    const { booking_days_ahead } = settings();
    const to = addDays(now.date, booking_days_ahead);
    return q.daysBetween.all(now.date, to).map((d) => {
      const slots = slotsForDate(d.date, now);
      return { date: d.date, free: slots.filter((s) => s.free).length };
    });
  }

  function createAppointment({ date, time, name, phone, note, source = 'online', force = false }) {
    const { slot_minutes } = settings();
    if (!force) {
      const slot = slotsForDate(date).find((s) => s.time === time);
      if (!slot || !slot.free) {
        const err = new Error('Bu saat artık müsait değil, lütfen başka bir saat seçin.');
        err.status = 409;
        throw err;
      }
    }
    try {
      const r = q.insertAppt.run(date, time, slot_minutes, name, phone, note || null, source);
      return q.getAppt.get(Number(r.lastInsertRowid));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        const err = new Error('Bu saat az önce doldu, lütfen başka bir saat seçin.');
        err.status = 409;
        throw err;
      }
      throw e;
    }
  }

  return {
    db,
    settings,
    updateSettings(obj) {
      for (const [k, v] of Object.entries(obj)) q.setSetting.run(k, String(v));
    },
    getDay: (date) => q.getDay.get(date),
    daysBetween: (from, to) => q.daysBetween.all(from, to),
    upsertDay: (d) => q.upsertDay.run(d.date, d.start_time, d.end_time, d.break_start || null, d.break_end || null),
    deleteDay: (date) => q.deleteDay.run(date),
    slotsForDate,
    openDays,
    createAppointment,
    appointmentsBetween: (from, to) => q.apptsBetween.all(from, to),
    getAppointment: (id) => q.getAppt.get(id),
    setStatus: (id, status) => q.setStatus.run(status, id),
    setSmsStatus: (id, s) => q.setSms.run(s, id),
    futureActiveCountByPhone: (phone, today) => q.futureActiveByPhone.get(phone, today).n,
    bookedOnDate: (date) => q.bookedOnDate.all(date),
  };
}

module.exports = { openDb };
