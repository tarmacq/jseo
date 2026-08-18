/*
 * Tarmacq OAuth session for the JSEO submission page.
 *
 * Flow:
 *   1. Load the Supabase config served by api.tarmacq.com (origin allowlisted
 *      to the site domain, so this only resolves in the browser).
 *   2. Capture the access_token returned by auth.tarmacq.com after login.
 *   3. Resolve the token against Supabase Auth to obtain the verified user.
 *
 * The token is only ever a hint here. The API re-verifies it server side
 * before accepting a submission, so nothing in this file is a security
 * boundary.
 */
window.JSEOAuth = (function () {
  'use strict';

  var CONFIG_URL = 'https://api.tarmacq.com/api/config.js';
  var AUTH_URL = 'https://auth.tarmacq.com/dist/services/jseo';
  var TOKEN_KEY = 'jseo.access_token';

  var state = { config: null, token: null, user: null };

  /* ------------------------------------------------------------- config */

  // The endpoint is served as .js, so a script tag is the documented path.
  // Different Tarmacq services expose it under different globals, so we look
  // through the conventional names rather than hard-coding one.
  var GLOBALS = ['TARMACQ_CONFIG', 'TarmacqConfig', 'SUPABASE_CONFIG', 'APP_CONFIG', 'CONFIG', 'config'];
  var URL_KEYS = ['supabaseUrl', 'SUPABASE_URL', 'supabase_url', 'url'];
  var KEY_KEYS = ['supabaseAnonKey', 'SUPABASE_ANON_KEY', 'supabase_anon_key', 'anonKey', 'anon_key', 'supabaseKey', 'key'];

  function pick(obj, names) {
    for (var i = 0; i < names.length; i++) {
      if (obj && typeof obj[names[i]] === 'string' && obj[names[i]]) return obj[names[i]];
    }
    return null;
  }

  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var nested = raw.supabase && typeof raw.supabase === 'object' ? raw.supabase : raw;
    var url = pick(nested, URL_KEYS) || pick(raw, URL_KEYS);
    var key = pick(nested, KEY_KEYS) || pick(raw, KEY_KEYS);
    return url && key ? { url: url.replace(/\/$/, ''), key: key } : null;
  }

  function fromGlobals() {
    for (var i = 0; i < GLOBALS.length; i++) {
      var found = normalise(window[GLOBALS[i]]);
      if (found) return found;
    }
    return null;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = resolve;
      el.onerror = function () { reject(new Error('config script failed')); };
      document.head.appendChild(el);
    });
  }

  function loadConfig() {
    if (state.config) return Promise.resolve(state.config);

    var preset = normalise(window.JSEO_SUPABASE);
    if (preset) {
      state.config = preset;
      return Promise.resolve(preset);
    }

    return loadScript(CONFIG_URL)
      .then(fromGlobals)
      .catch(function () { return null; })
      .then(function (found) {
        if (found) return found;

        // Fall back to reading it as data in case it is served as JSON.
        return fetch(CONFIG_URL, { credentials: 'omit' })
          .then(function (res) { return res.text(); })
          .then(function (text) {
            try {
              return normalise(JSON.parse(text));
            } catch (err) {
              // Last resort: pull the two values out of the source text.
              var url = text.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
              var key = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
              return url && key ? { url: url[0], key: key[0] } : null;
            }
          })
          .catch(function () { return null; });
      })
      .then(function (found) {
        if (!found) throw new Error('CONFIG_UNAVAILABLE');
        state.config = found;
        return found;
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
      if (!res.ok) throw new Error('AUTH_UNAVAILABLE');
      return res.json();
    });
  }

  /* ------------------------------------------------------------- public */

  function login(returnTo) {
    var target = returnTo || (window.location.origin + window.location.pathname);
    var url = AUTH_URL +
      '?redirect_uri=' + encodeURIComponent(target) +
      '&redirect=' + encodeURIComponent(target) +
      '&service=jseo';
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
      return { status: 'error', reason: err.message };
    });
  }

  return {
    init: init,
    login: login,
    logout: logout,
    getToken: function () { return state.token; },
    getUser: function () { return state.user; }
  };
})();
