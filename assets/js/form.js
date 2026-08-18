/* Submission form: client-side validation, file handling, and API call. */
(function () {
  'use strict';

  var ENDPOINT = window.JSEO_ENDPOINT || '/api/submit';
  var STAFF_EMAIL = 'jseo.metaheuristiques2026@gmail.com';
  var MAX_BYTES = 10 * 1024 * 1024;
  var ALLOWED_EXT = ['pdf', 'doc', 'docx'];
  var ABSTRACT_MIN = 200;

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
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo';
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
      abstractCount.textContent = String(abstractEl.value.length);
    };
    abstractEl.addEventListener('input', updateCount);
    updateCount();
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
      setError('file', 'Format non accepté. Déposez un fichier PDF, DOC ou DOCX.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('file', 'Fichier trop volumineux (' + humanSize(file.size) + '). La limite est de 10 Mo.');
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
        setError('file', 'Le glisser-déposer n\'est pas disponible sur ce navigateur. Utilisez le bouton de sélection.');
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
    ['lastName', function (v) { return v.trim().length >= 2 || 'Indiquez votre nom.'; }],
    ['firstName', function (v) { return v.trim().length >= 2 || 'Indiquez votre prénom.'; }],
    ['email', function (v) {
      if (!v.trim()) return 'Indiquez votre adresse e-mail.';
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Cette adresse e-mail ne semble pas valide.';
    }],
    ['status', function (v) { return !!v || 'Sélectionnez votre statut.'; }],
    ['institution', function (v) { return v.trim().length >= 2 || 'Indiquez votre établissement ou votre entreprise.'; }],
    ['title', function (v) { return v.trim().length >= 5 || 'Indiquez le titre de votre communication.'; }],
    ['axis', function (v) { return !!v || 'Sélectionnez un axe thématique.'; }],
    ['keywords', function (v) {
      var parts = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return parts.length >= 3 || 'Indiquez au moins trois mots-clés séparés par des virgules.';
    }],
    ['abstract', function (v) {
      if (v.trim().length < ABSTRACT_MIN) {
        return 'Le résumé doit compter au moins ' + ABSTRACT_MIN + ' caractères (' + v.trim().length + ' actuellement).';
      }
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

    if (!form.querySelector('input[name="presentation"]:checked')) {
      setError('presentation', 'Choisissez un type de présentation.');
      if (!firstBad) firstBad = form.elements['presentation'][0];
    }

    if (!form.querySelector('input[name="language"]:checked')) {
      setError('language', 'Choisissez la langue de votre communication.');
      if (!firstBad) firstBad = form.elements['language'][0];
    }

    var file = fileInput.files[0];
    if (!file) {
      setError('file', 'Déposez le fichier de votre résumé.');
      if (!firstBad) firstBad = dropzone;
    } else if (ALLOWED_EXT.indexOf(extensionOf(file.name)) === -1) {
      setError('file', 'Format non accepté. Déposez un fichier PDF, DOC ou DOCX.');
      if (!firstBad) firstBad = dropzone;
    } else if (file.size > MAX_BYTES) {
      setError('file', 'Fichier trop volumineux. La limite est de 10 Mo.');
      if (!firstBad) firstBad = dropzone;
    }

    if (!form.elements['consent'].checked) {
      setError('consent', 'Votre accord est nécessaire pour enregistrer la soumission.');
      if (!firstBad) firstBad = form.elements['consent'];
    }

    var captcha = form.elements['cf-turnstile-response'];
    if (!captcha || !captcha.value) {
      setError('captcha', 'Confirmez la vérification de sécurité avant d\'envoyer.');
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
      ? '<span class="spinner" aria-hidden="true"></span> Envoi en cours'
      : 'Envoyer ma soumission';
  }

  function mailtoFallback() {
    var subject = encodeURIComponent('Soumission JSEO 2026 : ' + (form.elements['title'].value || 'résumé'));
    return '<p>Votre soumission n\'a pas pu être transmise automatiquement.</p>' +
      '<p>Envoyez votre résumé directement à <a href="mailto:' + STAFF_EMAIL + '?subject=' + subject + '">' +
      STAFF_EMAIL + '</a> en joignant votre fichier, ou réessayez dans quelques instants.</p>';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideStatus();

    var firstBad = validate();
    if (firstBad) {
      showStatus('err', '<p>Certains champs demandent votre attention. Ils sont signalés ci-dessous.</p>');
      if (firstBad.focus) firstBad.focus();
      return;
    }

    var token = window.JSEOAuth.getToken();
    if (!token) {
      showStatus('err', '<p>Votre session a expiré. Reconnectez-vous pour envoyer votre soumission.</p>');
      startSession();
      return;
    }

    setBusy(true);

    var data = new FormData(form);

    fetch(ENDPOINT, {
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
          showStatus('err', '<p>Votre session a expiré. Reconnectez-vous pour envoyer votre soumission.</p>');
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
