/*
 * Tarmacq OAuth session for the JSEO submission page.
 *
 * Flow:
 *   1. Read the Supabase config from api.tarmacq.com.
 *   2. Capture the access_token returned by auth.tarmacq.com after login.
 *   3. Resolve the token against Supabase Auth to obtain the verified user.
 *
 * The token is only a hint here. The API re-verifies it server side before
 * accepting a submission, so nothing in this file is a security boundary.
 */
window.JSEOAuth = (function () {
  'use strict';

  // No .js suffix: Vercel's cleanUrls answers /api/config.js with a 308 to
  // /api/config, and a redirect carries no Access-Control-Allow-Origin, so
  // the browser fails the request on CORS before the handler ever runs.
  var CONFIG_URL = 'https://api.tarmacq.com/api/config';

  var AUTH_URL = window.JSEO_AUTH_URL || 'https://auth.tarmacq.com/distribution/services/jseo';
  var SERVICE = 'jseo';
  var TOKEN_KEY = 'jseo.access_token';

  var state = { config: null, token: null, user: null };

  /* ------------------------------------------------------------- config */

  // The endpoint returns JSON and requires an Origin header on the allowlist,
  // so it must be fetched, never loaded through a script tag (a classic
  // script tag sends no Origin and is answered with 403).
  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var url = raw.supabaseUrl || raw.SUPABASE_URL || raw.url;
    var key = raw.supabaseKey || raw.supabaseAnonKey || raw.SUPABASE_ANON_KEY || raw.anonKey;
    if (!url || !key) return null;
    return { url: String(url).replace(/\/$/, ''), key: String(key), extras: raw };
  }

  function loadConfig() {
    if (state.config) return Promise.resolve(state.config);

    var preset = normalise(window.JSEO_SUPABASE);
    if (preset) {
      state.config = preset;
      return Promise.resolve(preset);
    }

    return fetch(CONFIG_URL, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('CONFIG_' + res.status);
        return res.json();
      })
      .then(function (body) {
        var config = normalise(body);
        if (!config) throw new Error('CONFIG_SHAPE');
        state.config = config;
        return config;
      });
  }

  /* -------------------------------------------------------------- token */

  function readParams() {
    var out = {};
    [window.location.hash.replace(/^#/, ''), window.location.search.replace(/^\?/, '')]
      .forEach(function (chunk) {
        if (!chunk) return;
        chunk.split('&').forEach(function (pair) {
          var eq = pair.indexOf('=');
          if (eq === -1) return;
          out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
        });
      });
    return out;
  }

  function captureToken() {
    var params = readParams();
    var token = params.access_token || params.token;

    if (token) {
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (err) { /* private mode */ }
      // Keep the token out of the address bar, history and any referrer.
      window.history.replaceState({}, document.title, window.location.pathname);
      return token;
    }

    try { return sessionStorage.getItem(TOKEN_KEY); } catch (err) { return null; }
  }

  function clearToken() {
    state.token = null;
    state.user = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
  }

  /* --------------------------------------------------------------- user */

  function resolveUser(config, token) {
    return fetch(config.url + '/auth/v1/user', {
      headers: { apikey: config.key, Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error('AUTH_' + res.status);
      return res.json();
    });
  }

  /* ------------------------------------------------------------- public */

  function login(returnTo) {
    var target = returnTo || (window.location.origin + window.location.pathname);
    var url = AUTH_URL +
      (AUTH_URL.indexOf('?') === -1 ? '?' : '&') +
      'service=' + encodeURIComponent(SERVICE) +
      '&redirect_uri=' + encodeURIComponent(target) +
      '&redirect=' + encodeURIComponent(target);
    window.location.assign(url);
  }

  function logout() {
    clearToken();
    window.location.reload();
  }

  function init() {
    return loadConfig().then(function (config) {
      var token = captureToken();
      if (!token) return { status: 'anonymous' };

      return resolveUser(config, token).then(function (user) {
        if (!user || !user.email) {
          clearToken();
          return { status: 'anonymous' };
        }
        state.token = token;
        state.user = user;
        return { status: 'authenticated', user: user, token: token };
      });
    }).catch(function (err) {
      console.error('JSEO auth:', err);
      return { status: 'error', reason: err.message };
    });
  }

  return {
    init: init,
    login: login,
    logout: logout,
    getConfig: function () { return state.config; },
    getToken: function () { return state.token; },
    getUser: function () { return state.user; }
  };
})();
