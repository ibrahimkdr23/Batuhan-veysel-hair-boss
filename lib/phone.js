'use strict';
/**
 * Türk cep telefonunu 5XXXXXXXXX (10 hane) biçimine çevirir.
 * Geçersizse null döner. Kabul edilenler: 0532..., +90 532..., 90532..., 532...
 */
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let d = input.replace(/\D/g, '');
  if (d.startsWith('90') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  if (!/^5\d{9}$/.test(d)) return null;
  return d;
}

/** 5321234567 -> 0532 123 45 67 */
function formatPhone(p) {
  if (!p || p.length !== 10) return p || '';
  return `0${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6, 8)} ${p.slice(8)}`;
}

module.exports = { normalizePhone, formatPhone };
