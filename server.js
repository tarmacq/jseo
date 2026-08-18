/*
 * Local development server.
 *
 *   node server.js        then open http://localhost:3000
 *
 * Serves the static site and routes POST /api/submit to api/submit.js,
 * so the submission flow behaves exactly as it does once deployed.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const submit = require('./api/submit');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.woff2': 'font/woff2'
};

// Minimal res.status().json() shim so api/submit.js runs unchanged.
function decorate(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (payload) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<h1>404</h1><p>Page introuvable. <a href="/">Retour a l\'accueil</a></p>');
      return;
    }
    res.setHeader('Content-Type', TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.end(data);
  });
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname === '/api/submit') {
    Promise.resolve(submit(req, decorate(res))).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('{"error":"Erreur interne."}');
      }
    });
    return;
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`JSEO 2026 sur http://localhost:${PORT}`);
  if (!process.env.JSEO_MAIL_USER) {
    console.log('Attention: JSEO_MAIL_USER / JSEO_MAIL_PASS ne sont pas definis, l\'envoi des e-mails echouera.');
  }
});
