const nodemailer = require('nodemailer');
const config = require('./config');

let transport = null;
const outbox = []; // últimos envíos, útil en pruebas y para diagnosticar sin SMTP

function getTransport() {
  if (!config.mail.host) return null;
  transport ||= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
  return transport;
}

/** Envía un email. Sin SMTP configurado solo lo escribe en el log (modo desarrollo). */
async function sendMail({ to, subject, text, html }) {
  const recipients = [].concat(to).filter(Boolean);
  if (!recipients.length) return { skipped: true };
  outbox.push({ to: recipients, subject, at: new Date().toISOString() });
  if (outbox.length > 50) outbox.shift();
  const t = getTransport();
  if (!t) {
    console.log(`[mail:sin-SMTP] → ${recipients.join(', ')} · ${subject}`);
    return { skipped: true };
  }
  await t.sendMail({ from: config.mail.from, to: recipients.join(', '), subject, text, html });
  return { sent: true };
}

module.exports = { sendMail, outbox };
