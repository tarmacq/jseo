/* Submission form: client-side validation, file handling, and API call.
 *
 * All user-facing strings live in STRINGS below and are selected from the
 * <html lang> attribute, so the same script drives the French and English
 * pages without duplication.
 */
(function () {
  'use strict';

  var ENDPOINT = window.JSEO_ENDPOINT || '/api/submit';
  var STAFF_EMAIL = 'jseo.metaheuristiques2026@gmail.com';
  var MAX_BYTES = 10 * 1024 * 1024;
  var ALLOWED_EXT = ['pdf', 'docx'];
  var ABSTRACT_MIN_WORDS = 250;
  var ABSTRACT_MAX_WORDS = 400;

  var STRINGS = {
    fr: {
      lastName: 'Indiquez votre nom.',
      firstName: 'Indiquez votre prénom.',
      emailMissing: 'Indiquez votre adresse e-mail.',
      emailInvalid: 'Cette adresse e-mail ne semble pas valide.',
      status: 'Sélectionnez votre statut.',
      institution: 'Indiquez votre établissement ou votre entreprise.',
      title: 'Indiquez le titre de votre communication.',
      axis: 'Sélectionnez un axe thématique.',
      axisOther: 'Précisez la thématique de votre contribution.',
      keywordsMin: 'Indiquez au moins trois mots-clés séparés par des points-virgules.',
      keywordsMax: function (n) { return 'Cinq mots-clés au maximum (' + n + ' actuellement).'; },
      abstractMin: function (n) { return 'Le résumé doit compter au moins ' + ABSTRACT_MIN_WORDS + ' mots (' + n + ' actuellement).'; },
      abstractMax: function (n) { return 'Le résumé ne doit pas dépasser ' + ABSTRACT_MAX_WORDS + ' mots (' + n + ' actuellement).'; },
      presentation: 'Choisissez un type de présentation.',
      language: 'Choisissez la langue de votre communication.',
      fileMissing: 'Déposez le fichier de votre résumé.',
      fileFormat: 'Format non accepté. Déposez un fichier PDF ou DOCX.',
      fileTooBig: function (s) { return 'Fichier trop volumineux' + (s ? ' (' + s + ')' : '') + '. La limite est de 10 Mo.'; },
      dragDrop: "Le glisser-déposer n'est pas disponible sur ce navigateur. Utilisez le bouton de sélection.",
      consent: 'Votre accord est nécessaire pour enregistrer la soumission.',
      captcha: "Confirmez la vérification de sécurité avant d'envoyer.",
      needAttention: 'Certains champs demandent votre attention. Ils sont signalés ci-dessous.',
      sessionExpired: 'Votre session a expiré. Reconnectez-vous pour envoyer votre soumission.',
      sending: 'Envoi en cours',
      submit: 'Envoyer ma soumission',
      failIntro: "Votre soumission n'a pas pu être transmise automatiquement.",
      failAction: function (link) {
        return 'Envoyez votre résumé directement à ' + link + ' en joignant votre fichier, ou réessayez dans quelques instants.';
      },
      mailSubject: 'Soumission JSEO 2026 : ',
      mailSubjectFallback: 'résumé',
      units: { b: ' o', k: ' Ko', m: ' Mo' },
      decimal: ','
    },
    en: {
      lastName: 'Please enter your surname.',
      firstName: 'Please enter your first name.',
      emailMissing: 'Please enter your email address.',
      emailInvalid: 'This email address does not look valid.',
      status: 'Please select your position.',
      institution: 'Please enter your institution or company.',
      title: 'Please enter the title of your contribution.',
      axis: 'Please select a thematic area.',
      axisOther: 'Please specify the theme of your contribution.',
      keywordsMin: 'Please enter at least three keywords separated by semicolons.',
      keywordsMax: function (n) { return 'Five keywords at most (' + n + ' at present).'; },
      abstractMin: function (n) { return 'The abstract must be at least ' + ABSTRACT_MIN_WORDS + ' words (' + n + ' at present).'; },
      abstractMax: function (n) { return 'The abstract must not exceed ' + ABSTRACT_MAX_WORDS + ' words (' + n + ' at present).'; },
      presentation: 'Please choose a type of presentation.',
      language: 'Please choose the language of your contribution.',
      fileMissing: 'Please upload your abstract file.',
      fileFormat: 'Format not accepted. Please upload a PDF or DOCX file.',
      fileTooBig: function (s) { return 'File too large' + (s ? ' (' + s + ')' : '') + '. The limit is 10 MB.'; },
      dragDrop: 'Drag and drop is not available in this browser. Please use the file picker.',
      consent: 'Your agreement is required before the submission can be recorded.',
      captcha: 'Please complete the security check before sending.',
      needAttention: 'Some fields need your attention. They are marked below.',
      sessionExpired: 'Your session has expired. Please sign in again to send your submission.',
      sending: 'Sending',
      submit: 'Send my submission',
      failIntro: 'Your submission could not be sent automatically.',
      failAction: function (link) {
        return 'Please email your abstract directly to ' + link + ' with your file attached, or try again in a moment.';
      },
      mailSubject: 'JSEO 2026 submission: ',
      mailSubjectFallback: 'abstract',
      units: { b: ' B', k: ' KB', m: ' MB' },
      decimal: '.'
    }
  };

  var LOCALE = (document.documentElement.lang || 'fr').slice(0, 2) === 'en' ? 'en' : 'fr';
  var T = STRINGS[LOCALE];

  function countWords(text) {
    var trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  var form = document.getElementById('submission-form');
  if (!form) return;

  var formWrap = document.getElementById('form-wrap');
  var statusBox = document.getElementById('form-status');
  var submitBtn = document.getElementById('submit-btn');
  var successPanel = document.getElementById('success-panel');

  var fileInput = document.getElementById('file');
  var dropzone = document.getElementById('dropzone');
  var chip = document.getElementById('file-chip');
  var chipName = document.getElementById('fc-name');
  var chipSize = document.getElementById('fc-size');
  var chipRemove = document.getElementById('fc-remove');

  var abstractEl = document.getElementById('abstract');
  var abstractCount = document.getElementById('abstract-count');

  /* ----------------------------------------------------------- auth gate */

  var gate = document.getElementById('auth-gate');
  var gateStates = {
    loading: document.getElementById('gate-loading'),
    anonymous: document.getElementById('gate-anonymous'),
    error: document.getElementById('gate-error')
  };

  function showGate(which) {
    gate.hidden = false;
    formWrap.hidden = true;
    Object.keys(gateStates).forEach(function (name) {
      gateStates[name].hidden = name !== which;
    });
  }

  function showForm(user) {
    gate.hidden = true;
    formWrap.hidden = false;
    document.getElementById('signed-in-email').textContent = user.email;
    form.elements['email'].value = user.email;
  }

  function startSession() {
    showGate('loading');
    window.JSEOAuth.init().then(function (result) {
      if (result.status === 'authenticated') showForm(result.user);
      else if (result.status === 'error') showGate('error');
      else showGate('anonymous');
    });
  }

  document.getElementById('gate-login').addEventListener('click', function () {
    window.JSEOAuth.login();
  });
  document.getElementById('gate-retry').addEventListener('click', startSession);
  document.getElementById('gate-logout').addEventListener('click', function () {
    window.JSEOAuth.logout();
  });

  startSession();

  /* ----------------------------------------------------------- helpers */

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + T.units.b;
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + T.units.k;
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', T.decimal) + T.units.m;
  }

  function extensionOf(name) {
    var i = name.lastIndexOf('.');
    return i === -1 ? '' : name.slice(i + 1).toLowerCase();
  }

  function setError(name, message) {
    var slot = form.querySelector('[data-err-for="' + name + '"]');
    var field = form.elements[name];
    var control = field && field.length && !field.tagName ? field[0] : field;

    if (slot) {
      slot.textContent = message || '';
      slot.classList.toggle('show', !!message);
    }
    if (control && control.setAttribute) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }

  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (el) {
      el.textContent = '';
      el.classList.remove('show');
    });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) {
      el.removeAttribute('aria-invalid');
    });
  }

  function showStatus(kind, html) {
    statusBox.className = 'form-status show form-status--' + kind;
    statusBox.innerHTML = html;
    statusBox.scrollIntoView({ block: 'center' });
  }

  function hideStatus() {
    statusBox.className = 'form-status';
    statusBox.innerHTML = '';
  }

  /* ----------------------------------------------------------- abstract counter */

  if (abstractEl && abstractCount) {
    var updateCount = function () {
      var words = countWords(abstractEl.value);
      abstractCount.textContent = String(words);
      abstractCount.parentNode.classList.toggle(
        'counter--over',
        words > 0 && (words < ABSTRACT_MIN_WORDS || words > ABSTRACT_MAX_WORDS)
      );
    };
    abstractEl.addEventListener('input', updateCount);
    updateCount();
  }

  /* ----------------------------------------------------------- axis "other" */

  var axisEl = document.getElementById('axis');
  var axisOtherField = document.getElementById('axis-other-field');

  if (axisEl && axisOtherField) {
    var syncAxis = function () {
      axisOtherField.hidden = axisEl.value !== 'Autre';
    };
    axisEl.addEventListener('change', syncAxis);
    syncAxis();
  }

  /* ----------------------------------------------------------- file handling */

  function describeFile(file) {
    if (!file) {
      chip.classList.remove('show');
      dropzone.hidden = false;
      return;
    }
    chipName.textContent = file.name;
    chipSize.textContent = humanSize(file.size);
    chip.classList.add('show');
    dropzone.hidden = true;
  }

  function acceptFile(file) {
    if (!file) return;

    if (ALLOWED_EXT.indexOf(extensionOf(file.name)) === -1) {
      setError('file', T.fileFormat);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('file', T.fileTooBig(humanSize(file.size)));
      return;
    }

    setError('file', '');
    describeFile(file);
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', function () { fileInput.click(); });

    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', function () {
      acceptFile(fileInput.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        dropzone.classList.add('is-over');
      });
    });

    ['dragleave', 'drop'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        dropzone.classList.remove('is-over');
      });
    });

    dropzone.addEventListener('drop', function (e) {
      var dropped = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
      if (!dropped) return;
      try {
        var dt = new DataTransfer();
        dt.items.add(dropped);
        fileInput.files = dt.files;
        acceptFile(fileInput.files[0]);
      } catch (err) {
        setError('file', T.dragDrop);
      }
    });

    chipRemove.addEventListener('click', function () {
      fileInput.value = '';
      describeFile(null);
      setError('file', '');
    });
  }

  /* ----------------------------------------------------------- validation */

  var RULES = [
    ['lastName', function (v) { return v.trim().length >= 2 || T.lastName; }],
    ['firstName', function (v) { return v.trim().length >= 2 || T.firstName; }],
    ['email', function (v) {
      if (!v.trim()) return T.emailMissing;
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || T.emailInvalid;
    }],
    ['status', function (v) { return !!v || T.status; }],
    ['institution', function (v) { return v.trim().length >= 2 || T.institution; }],
    ['title', function (v) { return v.trim().length >= 5 || T.title; }],
    ['axis', function (v) { return !!v || T.axis; }],
    ['keywords', function (v) {
      var parts = v.split(';').map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length < 3) return T.keywordsMin;
      if (parts.length > 5) return T.keywordsMax(parts.length);
      return true;
    }],
    ['abstract', function (v) {
      var words = countWords(v);
      if (words < ABSTRACT_MIN_WORDS) return T.abstractMin(words);
      if (words > ABSTRACT_MAX_WORDS) return T.abstractMax(words);
      return true;
    }]
  ];

  function validate() {
    clearErrors();
    var firstBad = null;

    RULES.forEach(function (rule) {
      var name = rule[0];
      var control = form.elements[name];
      var result = rule[1](control.value || '');
      if (result !== true) {
        setError(name, result);
        if (!firstBad) firstBad = control;
      }
    });

    if (form.elements['axis'].value === 'Autre' && !form.elements['axisOther'].value.trim()) {
      setError('axisOther', T.axisOther);
      if (!firstBad) firstBad = form.elements['axisOther'];
    }

    if (!form.querySelector('input[name="presentation"]:checked')) {
      setError('presentation', T.presentation);
      if (!firstBad) firstBad = form.elements['presentation'][0];
    }

    if (!form.querySelector('input[name="language"]:checked')) {
      setError('language', T.language);
      if (!firstBad) firstBad = form.elements['language'][0];
    }

    var file = fileInput.files[0];
    if (!file) {
      setError('file', T.fileMissing);
      if (!firstBad) firstBad = dropzone;
    } else if (ALLOWED_EXT.indexOf(extensionOf(file.name)) === -1) {
      setError('file', T.fileFormat);
      if (!firstBad) firstBad = dropzone;
    } else if (file.size > MAX_BYTES) {
      setError('file', T.fileTooBig(''));
      if (!firstBad) firstBad = dropzone;
    }

    if (!form.elements['consent'].checked) {
      setError('consent', T.consent);
      if (!firstBad) firstBad = form.elements['consent'];
    }

    var captcha = form.elements['cf-turnstile-response'];
    if (!captcha || !captcha.value) {
      setError('captcha', T.captcha);
      if (!firstBad) firstBad = form.querySelector('.cf-turnstile');
    }

    return firstBad;
  }

  // A Turnstile token is single use: once the server has seen it, the widget
  // must be reset before the visitor can try again.
  function resetCaptcha() {
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
      try { window.turnstile.reset(); } catch (err) { /* widget not ready */ }
    }
  }

  /* ----------------------------------------------------------- submit */

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.innerHTML = busy
      ? '<span class="spinner" aria-hidden="true"></span> ' + T.sending
      : T.submit;
  }

  function mailtoFallback() {
    var subject = encodeURIComponent(T.mailSubject + (form.elements['title'].value || T.mailSubjectFallback));
    var link = '<a href="mailto:' + STAFF_EMAIL + '?subject=' + subject + '">' + STAFF_EMAIL + '</a>';
    return '<p>' + T.failIntro + '</p><p>' + T.failAction(link) + '</p>';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideStatus();

    var firstBad = validate();
    if (firstBad) {
      showStatus('err', '<p>' + T.needAttention + '</p>');
      if (firstBad.focus) firstBad.focus();
      return;
    }

    var token = window.JSEOAuth.getToken();
    if (!token) {
      showStatus('err', '<p>' + T.sessionExpired + '</p>');
      startSession();
      return;
    }

    setBusy(true);

    var data = new FormData(form);

    // The locale also rides in the query string so the server can answer in
    // the right language even for errors raised before the body is parsed.
    var url = ENDPOINT + (ENDPOINT.indexOf('?') === -1 ? '?' : '&') + 'lang=' + LOCALE;

    fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: data
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        }).catch(function () {
          return { ok: false, status: res.status, body: {} };
        });
      })
      .then(function (res) {
        if (res.status === 401) {
          setBusy(false);
          resetCaptcha();
          showStatus('err', '<p>' + T.sessionExpired + '</p>');
          startSession();
          return;
        }

        if (!res.ok) {
          var msg = res.body && res.body.error
            ? '<p>' + res.body.error + '</p>'
            : mailtoFallback();
          showStatus('err', msg);
          resetCaptcha();
          setBusy(false);
          return;
        }

        document.getElementById('success-email').textContent = form.elements['email'].value.trim();
        document.getElementById('success-ref').textContent = (res.body && res.body.reference) || 'JSEO-2026';

        formWrap.hidden = true;
        successPanel.classList.add('show');
        successPanel.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function () {
        showStatus('err', mailtoFallback());
        resetCaptcha();
        setBusy(false);
      });
  });
})();
