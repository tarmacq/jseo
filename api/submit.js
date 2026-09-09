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
const ALLOWED_EXT = ['pdf', 'docx'];
const ABSTRACT_MIN_WORDS = 250;
const ABSTRACT_MAX_WORDS = 400;

const EVENT = {
  fr: {
    name: 'JSEO 2026',
    longName: "Journée scientifique des écosystèmes d'optimisation",
    date: '22 octobre 2026',
    place: 'Faculté de Mathématiques, USTHB, Alger',
    notification: '15 octobre 2026',
    deadline: '12 octobre 2026'
  },
  en: {
    name: 'JSEO 2026',
    longName: 'Scientific Day on Optimisation Ecosystems',
    date: '22 October 2026',
    place: 'Faculty of Mathematics, USTHB, Algiers',
    notification: '15 October 2026',
    deadline: '12 October 2026'
  }
};

/* Messages returned to the browser, in the language of the page used. */
const MSG = {
  fr: {
    methodNotAllowed: 'Méthode non autorisée.',
    authNotConfigured: "L'authentification n'est pas configurée sur le serveur.",
    authUnavailable: "Le service d'authentification est momentanément indisponible.",
    sessionExpired: 'Votre session a expiré. Reconnectez-vous pour soumettre.',
    incomplete: (vars) => `Le serveur est incomplètement configuré (${vars}). Écrivez au comité à ${STAFF_EMAIL}.`,
    fileTooLarge: 'Le fichier dépasse la limite de 10 Mo.',
    badRequest: 'La requête est mal formée.',
    captchaUnavailable: 'La vérification de sécurité est momentanément indisponible. Réessayez dans un instant.',
    captchaFailed: 'La vérification de sécurité a échoué. Rechargez la page et réessayez.',
    sendFailed: `La soumission n'a pas pu être transmise. Réessayez dans quelques instants ou écrivez à ${STAFF_EMAIL}.`,
    rejected: 'Soumission rejetée.',
    lastName: 'Le nom est manquant ou trop court.',
    firstName: 'Le prénom est manquant ou trop court.',
    email: "L'adresse e-mail n'est pas valide.",
    status: 'Le statut est manquant.',
    institution: "L'établissement ou l'entreprise est manquant.",
    title: 'Le titre de la communication est manquant.',
    axis: "L'axe thématique est manquant.",
    axisOther: 'Précisez la thématique de votre contribution.',
    presentation: 'Le type de présentation est manquant.',
    language: 'La langue de la communication est manquante.',
    keywordsMin: 'Indiquez au moins trois mots-clés séparés par des points-virgules.',
    keywordsMax: 'Cinq mots-clés au maximum.',
    abstractMin: (n) => `Le résumé doit compter au moins ${ABSTRACT_MIN_WORDS} mots (${n} actuellement).`,
    abstractMax: (n) => `Le résumé ne doit pas dépasser ${ABSTRACT_MAX_WORDS} mots (${n} actuellement).`,
    consent: 'Votre accord est nécessaire pour enregistrer la soumission.',
    fileMissing: 'Le fichier du résumé est manquant.',
    fileFormat: 'Format de fichier non accepté. Déposez un PDF ou un DOCX.'
  },
  en: {
    methodNotAllowed: 'Method not allowed.',
    authNotConfigured: 'Authentication is not configured on the server.',
    authUnavailable: 'The authentication service is temporarily unavailable.',
    sessionExpired: 'Your session has expired. Please sign in again to submit.',
    incomplete: (vars) => `The server is incompletely configured (${vars}). Please write to the committee at ${STAFF_EMAIL}.`,
    fileTooLarge: 'The file exceeds the 10 MB limit.',
    badRequest: 'The request is malformed.',
    captchaUnavailable: 'The security check is temporarily unavailable. Please try again in a moment.',
    captchaFailed: 'The security check failed. Please reload the page and try again.',
    sendFailed: `The submission could not be sent. Please try again shortly or write to ${STAFF_EMAIL}.`,
    rejected: 'Submission rejected.',
    lastName: 'The surname is missing or too short.',
    firstName: 'The first name is missing or too short.',
    email: 'The email address is not valid.',
    status: 'The position is missing.',
    institution: 'The institution or company is missing.',
    title: 'The title of the contribution is missing.',
    axis: 'The thematic area is missing.',
    axisOther: 'Please specify the theme of your contribution.',
    presentation: 'The type of presentation is missing.',
    language: 'The language of the contribution is missing.',
    keywordsMin: 'Please enter at least three keywords separated by semicolons.',
    keywordsMax: 'Five keywords at most.',
    abstractMin: (n) => `The abstract must be at least ${ABSTRACT_MIN_WORDS} words (${n} at present).`,
    abstractMax: (n) => `The abstract must not exceed ${ABSTRACT_MAX_WORDS} words (${n} at present).`,
    consent: 'Your agreement is required before the submission can be recorded.',
    fileMissing: 'The abstract file is missing.',
    fileFormat: 'File format not accepted. Please upload a PDF or a DOCX.'
  }
};

/** Normalises whatever the form sent into one of the two supported locales. */
function pickLocale(value) {
  return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
}

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

function countWords(text) {
  const trimmed = String(text || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function validate(fields, file, m) {
  const need = (key) => String(fields[key] || '').trim();

  if (need('website')) return m.rejected;

  if (need('lastName').length < 2) return m.lastName;
  if (need('firstName').length < 2) return m.firstName;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(need('email'))) return m.email;
  if (!need('status')) return m.status;
  if (need('institution').length < 2) return m.institution;
  if (need('title').length < 5) return m.title;
  if (!need('axis')) return m.axis;
  if (need('axis') === 'Autre' && !need('axisOther')) return m.axisOther;
  if (!need('presentation')) return m.presentation;
  if (!need('language')) return m.language;

  const keywords = need('keywords').split(';').map((s) => s.trim()).filter(Boolean);
  if (keywords.length < 3) return m.keywordsMin;
  if (keywords.length > 5) return m.keywordsMax;

  const words = countWords(need('abstract'));
  if (words < ABSTRACT_MIN_WORDS) return m.abstractMin(words);
  if (words > ABSTRACT_MAX_WORDS) return m.abstractMax(words);

  if (!need('consent')) return m.consent;

  if (!file) return m.fileMissing;
  if (ALLOWED_EXT.indexOf(extensionOf(file.filename)) === -1) return m.fileFormat;
  if (file.size > MAX_BYTES) return m.fileTooLarge;

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

const SHELL = (title, body, locale = 'fr') => {
  const e = EVENT[locale];
  const wordmark = locale === 'en' ? 'Optimisation ecosystems' : "Écosystèmes d'optimisation";
  return `<!DOCTYPE html>
<html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f7f9;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #e2e6ec;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">
  <tr><td style="background-color:#0f2557;padding:26px 32px;">
    <div style="color:#f2b417;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">${escapeHtml(e.name)}</div>
    <div style="color:#ffffff;font-size:20px;font-weight:bold;padding-top:6px;">${escapeHtml(wordmark)}</div>
    <div style="color:#b9c6de;font-size:13px;padding-top:4px;">${escapeHtml(e.date)} &nbsp;&#183;&nbsp; ${escapeHtml(e.place)}</div>
  </td></tr>
  <tr><td style="padding:32px;color:#14181f;font-size:15px;line-height:1.65;">${body}</td></tr>
  <tr><td style="background-color:#0a1b40;padding:20px 32px;color:#97a6c2;font-size:12px;line-height:1.6;">
    ${escapeHtml(e.longName)}<br>
    ${escapeHtml(e.place)}<br>
    <a href="mailto:${STAFF_EMAIL}" style="color:#ffffff;">${STAFF_EMAIL}</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
};

function row(label, value) {
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid #e2e6ec;color:#5c6472;font-size:12px;text-transform:uppercase;letter-spacing:1px;width:180px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:9px 0;border-bottom:1px solid #e2e6ec;color:#14181f;font-size:14px;vertical-align:top;">${value}</td>
  </tr>`;
}

function staffHtml(f, file, reference, stored, locale) {
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
      ${row('Formulaire rempli en', locale === 'en' ? 'Anglais' : 'Français')}
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

const AUTHOR_MAIL = {
  fr: (f, reference, e) => ({
    subject: `Accusé de réception de votre soumission ${reference} | ${e.name}`,
    body: `
    <h1 style="margin:0 0 14px;font-size:21px;color:#0a1b40;">Votre soumission est bien reçue</h1>

    <p style="margin:0 0 16px;">Bonjour ${escapeHtml(f.firstName)} ${escapeHtml(f.lastName)},</p>

    <p style="margin:0 0 16px;">Nous confirmons la bonne réception de votre proposition de communication par le comité d'organisation de la ${escapeHtml(e.longName)}. Votre dossier a été transmis au comité scientifique pour évaluation.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${row('Référence', '<strong style="color:#0f2557;font-size:15px;">' + escapeHtml(reference) + '</strong>')}
      ${row('Titre', '<strong>' + escapeHtml(f.title) + '</strong>')}
      ${row('Axe', escapeHtml(f.axis))}
      ${row('Présentation', escapeHtml(f.presentation))}
      ${row('Langue', escapeHtml(f.language))}
    </table>

    <p style="margin:0 0 16px;">La notification d'acceptation est prévue le <strong>${escapeHtml(e.notification)}</strong>. Conservez la référence ci-dessus pour tout échange avec le comité.</p>

    <p style="margin:0 0 16px;">La journée se tiendra le <strong>${escapeHtml(e.date)}</strong> à la ${escapeHtml(e.place)}.</p>

    <p style="margin:0 0 8px;">Nous vous remercions de votre contribution et vous disons à bientôt.</p>
    <p style="margin:0;color:#5c6472;">Le comité d'organisation de la JSEO 2026</p>

    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e6ec;color:#858c99;font-size:12px;line-height:1.6;">
      Ce message est un accusé de réception automatique. Pour toute question, répondez simplement à ce courriel.
    </div>
  `,
    text: [
      `Bonjour ${f.firstName} ${f.lastName},`,
      '',
      `Nous confirmons la bonne réception de votre proposition de communication par le comité d'organisation de la ${e.longName}.`,
      '',
      `Référence : ${reference}`,
      `Titre : ${f.title}`,
      `Axe : ${f.axis}`,
      `Présentation : ${f.presentation}`,
      `Langue : ${f.language}`,
      '',
      `Notification d'acceptation : ${e.notification}`,
      `Journée scientifique : ${e.date}, ${e.place}`,
      '',
      "Le comité d'organisation de la JSEO 2026",
      STAFF_EMAIL
    ].join('\n')
  }),

  en: (f, reference, e) => ({
    subject: `Acknowledgement of your submission ${reference} | ${e.name}`,
    body: `
    <h1 style="margin:0 0 14px;font-size:21px;color:#0a1b40;">Your submission has arrived</h1>

    <p style="margin:0 0 16px;">Dear ${escapeHtml(f.firstName)} ${escapeHtml(f.lastName)},</p>

    <p style="margin:0 0 16px;">We confirm that the organising committee of the ${escapeHtml(e.longName)} has received your proposed contribution. It has been passed to the scientific committee for review.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${row('Reference', '<strong style="color:#0f2557;font-size:15px;">' + escapeHtml(reference) + '</strong>')}
      ${row('Title', '<strong>' + escapeHtml(f.title) + '</strong>')}
      ${row('Area', escapeHtml(f.axis))}
      ${row('Presentation', escapeHtml(f.presentation))}
      ${row('Language', escapeHtml(f.language))}
    </table>

    <p style="margin:0 0 16px;">Notification of acceptance is expected on <strong>${escapeHtml(e.notification)}</strong>. Please keep the reference above for any correspondence with the committee.</p>

    <p style="margin:0 0 16px;">The event will take place on <strong>${escapeHtml(e.date)}</strong> at the ${escapeHtml(e.place)}.</p>

    <p style="margin:0 0 8px;">Thank you for your contribution. We look forward to seeing you there.</p>
    <p style="margin:0;color:#5c6472;">The JSEO 2026 organising committee</p>

    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e6ec;color:#858c99;font-size:12px;line-height:1.6;">
      This is an automatic acknowledgement. If you have any questions, simply reply to this email.
    </div>
  `,
    text: [
      `Dear ${f.firstName} ${f.lastName},`,
      '',
      `We confirm that the organising committee of the ${e.longName} has received your proposed contribution.`,
      '',
      `Reference: ${reference}`,
      `Title: ${f.title}`,
      `Area: ${f.axis}`,
      `Presentation: ${f.presentation}`,
      `Language: ${f.language}`,
      '',
      `Notification of acceptance: ${e.notification}`,
      `Scientific day: ${e.date}, ${e.place}`,
      '',
      'The JSEO 2026 organising committee',
      STAFF_EMAIL
    ].join('\n')
  })
};

/* --------------------------------------------------------------- handler */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Taken from the query string, since errors can be raised before the body
  // that carries the locale field has been read. Refined from the body later.
  let locale = pickLocale(new URL(req.url, 'http://localhost').searchParams.get('lang'));
  let m = MSG[locale];

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: m.methodNotAllowed });
    return;
  }

  // Supabase comes first because verifying the caller depends on it.
  if (!supabase.isConfigured()) {
    console.error('Missing environment variables:', supabase.missingConfig().join(', '));
    res.status(500).json({ error: m.authNotConfigured });
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
    res.status(503).json({ error: m.authUnavailable });
    return;
  }

  if (!user) {
    res.status(401).json({ error: m.sessionExpired });
    return;
  }

  // Every remaining server setting is reported at once, so a misconfigured
  // deployment is fixed in a single pass rather than one redeploy per
  // variable. Named only for a caller who has already proven who they are.
  const missing = [];
  if (!MAIL_USER) missing.push('JSEO_MAIL_USER');
  if (!MAIL_PASS) missing.push('JSEO_MAIL_PASS');
  if (!TURNSTILE_SECRET) missing.push('TURNSTILE_SECRET_KEY');

  if (missing.length) {
    console.error('Missing environment variables:', missing.join(', '));
    res.status(500).json({ error: m.incomplete(missing.join(", ")) });
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
      res.status(413).json({ error: m.fileTooLarge });
      return;
    }
    console.error('Parse error:', err);
    res.status(400).json({ error: m.badRequest });
    return;
  }

  // The body carries the authoritative locale; the query string was only a
  // stand-in for errors raised before this point.
  if (fields.locale) {
    locale = pickLocale(fields.locale);
    m = MSG[locale];
  }

  // The verified address wins over whatever the form carried.
  fields.email = user.email;

  const problem = validate(fields, file, m);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const captcha = await verifyTurnstile(fields['cf-turnstile-response'], req);
  if (!captcha.ok) {
    res.status(captcha.reason === 'unreachable' ? 503 : 400).json({
      error: captcha.reason === "unreachable" ? m.captchaUnavailable : m.captchaFailed
    });
    return;
  }

  // Fold the free-text thematic area into the axis so a single column, and a
  // single line in both emails, carries the whole answer.
  if (fields.axis === 'Autre' && fields.axisOther) {
    fields.axis = 'Autre : ' + fields.axisOther;
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
      html: staffHtml(fields, file, reference, stored, locale),
      attachments: [{ filename: attachmentName, content: file.content, contentType: file.mimeType }]
    });
  } catch (err) {
    console.error('Staff mail failed:', err);
    res.status(502).json({
      error: m.sendFailed
    });
    return;
  }

  // 2. The author gets an acknowledgement, written in the language of the
  //    page they submitted from. A failure here does not lose the submission.
  let acknowledged = true;
  try {
    const mail = AUTHOR_MAIL[locale](fields, reference, EVENT[locale]);
    await transporter.sendMail({
      from,
      to: `"${fields.firstName} ${fields.lastName}" <${fields.email}>`,
      replyTo: STAFF_EMAIL,
      subject: mail.subject,
      text: mail.text,
      html: SHELL(mail.subject, mail.body, locale)
    });
  } catch (err) {
    acknowledged = false;
    console.error('Acknowledgement mail failed:', err);
  }

  res.status(200).json({ ok: true, reference, acknowledged, stored, locale });
};
