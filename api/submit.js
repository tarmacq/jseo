/*
 * POST /api/submit
 *
 * Receives a multipart/form-data submission from soumission.html, then sends:
 *   1. the full dossier (with the attached file) to the JSEO staff mailbox
 *   2. an acknowledgement to the author who submitted
 *
 * Runs on Vercel Node functions and on the bundled local server (server.js).
 */

const Busboy = require('busboy');
const nodemailer = require('nodemailer');

const supabase = require('./_supabase');

const STAFF_EMAIL = process.env.JSEO_STAFF_EMAIL || 'jseo.metaheuristiques2026@gmail.com';
const MAIL_USER = process.env.JSEO_MAIL_USER;
const MAIL_PASS = process.env.JSEO_MAIL_PASS;
const MAIL_HOST = process.env.JSEO_MAIL_HOST || 'smtp.gmail.com';
const MAIL_PORT = Number(process.env.JSEO_MAIL_PORT || 465);

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'doc', 'docx'];
const ABSTRACT_MIN = 200;

const EVENT = {
  name: 'JSEO 2026',
  longName: "Journée scientifique des écosystèmes d'optimisation",
  date: '22 octobre 2026',
  place: 'Faculté de Mathématiques, USTHB, Alger',
  notification: '10 octobre 2026'
};

/* --------------------------------------------------------------- parsing */

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) {
      reject(Object.assign(new Error('BAD_CONTENT_TYPE'), { code: 'BAD_CONTENT_TYPE' }));
      return;
    }

    const fields = {};
    let file = null;
    let aborted = false;

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_BYTES, files: 1, fields: 40 }
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      let size = 0;

      stream.on('data', (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      stream.on('limit', () => {
        aborted = true;
        reject(Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' }));
      });

      stream.on('end', () => {
        if (aborted || !info.filename) return;
        file = {
          filename: info.filename,
          mimeType: info.mimeType,
          size,
          content: Buffer.concat(chunks)
        };
      });
    });

    busboy.on('error', reject);
    busboy.on('close', () => {
      if (!aborted) resolve({ fields, file });
    });

    if (req.body && Buffer.isBuffer(req.body)) {
      busboy.end(req.body);
    } else {
      req.pipe(busboy);
    }
  });
}

/* ------------------------------------------------------------ validation */

function extensionOf(name) {
  const i = String(name).lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

function validate(fields, file) {
  const need = (key) => String(fields[key] || '').trim();

  if (need('website')) return 'Soumission rejetée.';

  if (need('lastName').length < 2) return 'Le nom est manquant ou trop court.';
  if (need('firstName').length < 2) return 'Le prénom est manquant ou trop court.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(need('email'))) return "L'adresse e-mail n'est pas valide.";
  if (!need('status')) return 'Le statut est manquant.';
  if (need('institution').length < 2) return "L'établissement ou l'entreprise est manquant.";
  if (need('title').length < 5) return 'Le titre de la communication est manquant.';
  if (!need('axis')) return "L'axe thématique est manquant.";
  if (!need('presentation')) return 'Le type de présentation est manquant.';
  if (!need('language')) return 'La langue de la communication est manquante.';

  const keywords = need('keywords').split(',').map((s) => s.trim()).filter(Boolean);
  if (keywords.length < 3) return 'Indiquez au moins trois mots-clés.';

  if (need('abstract').length < ABSTRACT_MIN) {
    return `Le résumé doit compter au moins ${ABSTRACT_MIN} caractères.`;
  }

  if (!need('consent')) return 'Votre accord est nécessaire pour enregistrer la soumission.';

  if (!file) return 'Le fichier du résumé est manquant.';
  if (ALLOWED_EXT.indexOf(extensionOf(file.filename)) === -1) {
    return 'Format de fichier non accepté. Déposez un PDF, DOC ou DOCX.';
  }
  if (file.size > MAX_BYTES) return 'Le fichier dépasse la limite de 10 Mo.';

  return null;
}

/* --------------------------------------------------------------- turnstile */

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : undefined;
}

/**
 * Validates the Turnstile token with Cloudflare. The site key alone proves
 * nothing: only this server-side call, made with the secret key, does.
 */
async function verifyTurnstile(token, req) {
  if (!token) return { ok: false, reason: 'missing' };

  const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
  const ip = clientIp(req);
  if (ip) body.set('remoteip', ip);

  let payload;
  try {
    const response = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    payload = await response.json();
  } catch (err) {
    console.error('Turnstile verification unreachable:', err);
    return { ok: false, reason: 'unreachable' };
  }

  if (!payload.success) {
    console.warn('Turnstile rejected:', payload['error-codes']);
    return { ok: false, reason: 'rejected', codes: payload['error-codes'] };
  }

  return { ok: true };
}

/* --------------------------------------------------------------- helpers */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeReference() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `JSEO26-${stamp}${rand}`;
}

function safeFilename(reference, lastName, original) {
  const ext = extensionOf(original) || 'pdf';
  const slug = String(lastName)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
    .slice(0, 24) || 'AUTEUR';
  return `${reference}_${slug}.${ext}`;
}

/* -------------------------------------------------------------- templates */

const SHELL = (title, body) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #e2e6ec;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">
  <tr><td style="background-color:#0f2557;padding:26px 32px;">
    <div style="color:#f2b417;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${escapeHtml(EVENT.name)}</div>
    <div style="color:#ffffff;font-size:20px;font-weight:bold;padding-top:6px;">Écosystèmes d'optimisation</div>
    <div style="color:#b9c6de;font-size:13px;padding-top:4px;">${escapeHtml(EVENT.date)} &nbsp;&#183;&nbsp; ${escapeHtml(EVENT.place)}</div>
  </td></tr>
  <tr><td style="padding:32px;color:#14181f;font-size:15px;line-height:1.65;">${body}</td></tr>
  <tr><td style="background-color:#0a1b40;padding:20px 32px;color:#97a6c2;font-size:12px;line-height:1.6;">
    Journée scientifique des écosystèmes d'optimisation<br>
    Faculté de Mathématiques, USTHB, Bab Ezzouar, Alger<br>
    <a href="mailto:${STAFF_EMAIL}" style="color:#ffffff;">${STAFF_EMAIL}</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

function row(label, value) {
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid #e2e6ec;color:#5c6472;font-size:12px;text-transform:uppercase;letter-spacing:1px;width:180px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:9px 0;border-bottom:1px solid #e2e6ec;color:#14181f;font-size:14px;vertical-align:top;">${value}</td>
  </tr>`;
}

function staffHtml(f, file, reference, stored) {
  const coauthors = String(f.coauthors || '').trim();

  const storageNote = stored
    ? ''
    : `<div style="background-color:#fdf0ef;border:1px solid #f2c9c5;border-radius:6px;padding:14px 16px;margin-bottom:22px;color:#8c1d18;font-size:13px;line-height:1.6;">
        <strong>Enregistrement en base impossible.</strong> Cette soumission n'a pas pu être écrite dans Supabase.
        Conservez ce message, il contient l'intégralité du dossier et la pièce jointe.
      </div>`;

  return SHELL(`Nouvelle soumission ${reference}`, `
    <h1 style="margin:0 0 6px;font-size:21px;color:#0a1b40;">Nouvelle soumission</h1>
    <p style="margin:0 0 24px;color:#5c6472;font-size:14px;">Référence <strong style="color:#0f2557;">${escapeHtml(reference)}</strong>, reçue le ${escapeHtml(new Date().toLocaleString('fr-FR'))}.</p>
    ${storageNote}

    <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#1c3a7a;">Auteur correspondant</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      ${row('Nom et prénom', escapeHtml(f.lastName) + ' ' + escapeHtml(f.firstName))}
      ${row('E-mail', `<a href="mailto:${escapeHtml(f.email)}" style="color:#0f2557;">${escapeHtml(f.email)}</a>`)}
      ${row('Téléphone', escapeHtml(f.phone) || '<span style="color:#858c99;">non renseigné</span>')}
      ${row('Statut', escapeHtml(f.status))}
      ${row('Établissement', escapeHtml(f.institution))}
      ${row('Laboratoire', escapeHtml(f.lab) || '<span style="color:#858c99;">non renseigné</span>')}
    </table>

    <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#1c3a7a;">Communication</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      ${row('Titre', '<strong>' + escapeHtml(f.title) + '</strong>')}
      ${row('Co-auteurs', coauthors ? escapeHtml(coauthors).replace(/\n/g, '<br>') : '<span style="color:#858c99;">aucun</span>')}
      ${row('Axe', escapeHtml(f.axis))}
      ${row('Présentation', escapeHtml(f.presentation))}
      ${row('Langue', escapeHtml(f.language))}
      ${row('Mots-clés', escapeHtml(f.keywords))}
    </table>

    <h2 style="margin:0 0 10px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#1c3a7a;">Résumé</h2>
    <div style="background-color:#f6f7f9;border:1px solid #e2e6ec;border-radius:6px;padding:18px;font-size:14px;line-height:1.7;white-space:pre-wrap;margin-bottom:24px;">${escapeHtml(f.abstract)}</div>

    <p style="margin:0;color:#5c6472;font-size:13px;">
      Fichier joint : <strong style="color:#14181f;">${escapeHtml(file.filename)}</strong>
      (${(file.size / 1024).toFixed(0)} Ko).
      Répondez à ce message pour écrire directement à l'auteur.
    </p>
  `);
}

function authorHtml(f, reference) {
  return SHELL('Accusé de réception de votre soumission', `
    <h1 style="margin:0 0 14px;font-size:21px;color:#0a1b40;">Votre soumission est bien arrivée</h1>

    <p style="margin:0 0 16px;">Bonjour ${escapeHtml(f.firstName)} ${escapeHtml(f.lastName)},</p>

    <p style="margin:0 0 16px;">Nous confirmons la bonne réception de votre proposition de communication par le comité d'organisation de la ${escapeHtml(EVENT.longName)}. Votre dossier a été transmis au comité scientifique pour évaluation.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${row('Référence', '<strong style="color:#0f2557;font-size:15px;">' + escapeHtml(reference) + '</strong>')}
      ${row('Titre', '<strong>' + escapeHtml(f.title) + '</strong>')}
      ${row('Axe', escapeHtml(f.axis))}
      ${row('Présentation', escapeHtml(f.presentation))}
      ${row('Langue', escapeHtml(f.language))}
    </table>

    <p style="margin:0 0 16px;">La notification aux auteurs est prévue le <strong>${escapeHtml(EVENT.notification)}</strong>. Conservez la référence ci-dessus pour tout échange avec le comité.</p>

    <p style="margin:0 0 16px;">La journée se tiendra le <strong>${escapeHtml(EVENT.date)}</strong> à la ${escapeHtml(EVENT.place)}.</p>

    <p style="margin:0 0 8px;">Nous vous remercions de votre contribution et vous disons à bientôt.</p>
    <p style="margin:0;color:#5c6472;">Le comité d'organisation de la JSEO 2026</p>

    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e6ec;color:#858c99;font-size:12px;line-height:1.6;">
      Ce message est un accusé de réception automatique. Pour toute question, répondez simplement à ce courriel.
    </div>
  `);
}

function authorText(f, reference) {
  return [
    `Bonjour ${f.firstName} ${f.lastName},`,
    '',
    `Nous confirmons la bonne réception de votre proposition de communication par le comité d'organisation de la ${EVENT.longName}.`,
    '',
    `Référence : ${reference}`,
    `Titre : ${f.title}`,
    `Axe : ${f.axis}`,
    `Présentation : ${f.presentation}`,
    `Langue : ${f.language}`,
    '',
    `Notification aux auteurs : ${EVENT.notification}`,
    `Journée scientifique : ${EVENT.date}, ${EVENT.place}`,
    '',
    'Le comité d\'organisation de la JSEO 2026',
    STAFF_EMAIL
  ].join('\n');
}

/* --------------------------------------------------------------- handler */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Méthode non autorisée.' });
    return;
  }

  if (!MAIL_USER || !MAIL_PASS) {
    console.error('JSEO_MAIL_USER / JSEO_MAIL_PASS are not configured.');
    res.status(500).json({
      error: "Le service d'envoi n'est pas configuré. Écrivez directement à " + STAFF_EMAIL + '.'
    });
    return;
  }

  if (!supabase.isConfigured()) {
    console.error('SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not configured.');
    res.status(500).json({ error: "L'authentification n'est pas configurée sur le serveur." });
    return;
  }

  // Identity is established before the body is read, so an unauthenticated
  // caller never gets to upload 10 Mo.
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  let user;
  try {
    user = await supabase.verifyAccessToken(bearer);
  } catch (err) {
    res.status(503).json({ error: "Le service d'authentification est momentanément indisponible." });
    return;
  }

  if (!user) {
    res.status(401).json({ error: 'Votre session a expiré. Reconnectez-vous pour soumettre.' });
    return;
  }

  let fields;
  let file;

  try {
    const parsed = await parseMultipart(req);
    fields = parsed.fields;
    file = parsed.file;
  } catch (err) {
    if (err.code === 'FILE_TOO_LARGE') {
      res.status(413).json({ error: 'Le fichier dépasse la limite de 10 Mo.' });
      return;
    }
    console.error('Parse error:', err);
    res.status(400).json({ error: 'La requête est mal formée.' });
    return;
  }

  // The verified address wins over whatever the form carried.
  fields.email = user.email;

  const problem = validate(fields, file);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  if (!TURNSTILE_SECRET) {
    console.error('TURNSTILE_SECRET_KEY is not configured.');
    res.status(500).json({ error: "La vérification de sécurité n'est pas configurée sur le serveur." });
    return;
  }

  const captcha = await verifyTurnstile(fields['cf-turnstile-response'], req);
  if (!captcha.ok) {
    res.status(captcha.reason === 'unreachable' ? 503 : 400).json({
      error: captcha.reason === 'unreachable'
        ? 'La vérification de sécurité est momentanément indisponible. Réessayez dans un instant.'
        : 'La vérification de sécurité a échoué. Rechargez la page et réessayez.'
    });
    return;
  }

  const reference = makeReference();
  const attachmentName = safeFilename(reference, fields.lastName, file.filename);

  // Persist before mailing. A storage failure is logged and surfaced but does
  // not abort the submission, since the staff mail still carries everything.
  let stored = true;
  let storagePath = null;

  try {
    storagePath = await supabase.uploadFile(`${reference}/${attachmentName}`, file);
    await supabase.insertSubmission({
      reference,
      user_id: user.id,
      email: user.email,
      last_name: fields.lastName,
      first_name: fields.firstName,
      phone: fields.phone || null,
      status: fields.status,
      institution: fields.institution,
      lab: fields.lab || null,
      title: fields.title,
      coauthors: fields.coauthors || null,
      axis: fields.axis,
      presentation: fields.presentation,
      language: fields.language,
      keywords: fields.keywords,
      abstract: fields.abstract,
      file_path: storagePath,
      file_name: file.filename,
      file_size: file.size
    });
  } catch (err) {
    stored = false;
    console.error('Supabase persistence failed:', err);
  }

  const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: MAIL_PORT === 465,
    auth: { user: MAIL_USER, pass: MAIL_PASS }
  });

  const from = `"JSEO 2026" <${MAIL_USER}>`;

  // 1. The dossier reaches the staff. This one must succeed.
  try {
    await transporter.sendMail({
      from,
      to: STAFF_EMAIL,
      replyTo: `"${fields.firstName} ${fields.lastName}" <${fields.email}>`,
      subject: `[JSEO 2026] ${reference} : ${fields.title}`,
      html: staffHtml(fields, file, reference, stored),
      attachments: [{ filename: attachmentName, content: file.content, contentType: file.mimeType }]
    });
  } catch (err) {
    console.error('Staff mail failed:', err);
    res.status(502).json({
      error: "La soumission n'a pas pu être transmise. Réessayez dans quelques instants ou écrivez à " + STAFF_EMAIL + '.'
    });
    return;
  }

  // 2. The author gets an acknowledgement. A failure here does not lose the submission.
  let acknowledged = true;
  try {
    await transporter.sendMail({
      from,
      to: `"${fields.firstName} ${fields.lastName}" <${fields.email}>`,
      replyTo: STAFF_EMAIL,
      subject: `Accusé de réception de votre soumission ${reference} | JSEO 2026`,
      text: authorText(fields, reference),
      html: authorHtml(fields, reference)
    });
  } catch (err) {
    acknowledged = false;
    console.error('Acknowledgement mail failed:', err);
  }

  res.status(200).json({ ok: true, reference, acknowledged, stored });
};
