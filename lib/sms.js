'use strict';
/**
 * Netgsm SMS gönderimi (REST v2).
 * NETGSM_USERCODE / NETGSM_PASSWORD / NETGSM_HEADER tanımlı değilse SMS gönderilmez,
 * mesaj sadece loga yazılır (geliştirme / test için).
 */
const NETGSM_URL = 'https://api.netgsm.com.tr/sms/rest/v2/send';

function isConfigured(env = process.env) {
  return Boolean(env.NETGSM_USERCODE && env.NETGSM_PASSWORD && env.NETGSM_HEADER);
}

/**
 * @param {string} phone 5XXXXXXXXX
 * @param {string} message
 * @returns {Promise<{ok:boolean, status:string}>}
 */
async function sendSms(phone, message, env = process.env) {
  if (!isConfigured(env)) {
    console.log(`[SMS - kapalı] ${phone}: ${message}`);
    return { ok: false, status: 'kapalı' };
  }
  const auth = Buffer.from(`${env.NETGSM_USERCODE}:${env.NETGSM_PASSWORD}`).toString('base64');
  try {
    const res = await fetch(NETGSM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        msgheader: env.NETGSM_HEADER,
        encoding: 'TR',
        iysfilter: '0', // bilgilendirme amaçlı (randevu onayı) mesaj
        messages: [{ msg: message, no: phone }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* düz metin dönebilir */ }
    const ok = res.ok && (data.code === '00' || data.code === 0 || /^00/.test(text));
    if (!ok) console.error(`[SMS hata] ${phone}: HTTP ${res.status} ${text}`);
    return { ok, status: ok ? 'gönderildi' : `hata: ${data.code || res.status}` };
  } catch (e) {
    console.error(`[SMS hata] ${phone}: ${e.message}`);
    return { ok: false, status: 'hata' };
  }
}

module.exports = { sendSms, isConfigured };
