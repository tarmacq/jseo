/* Site-wide behaviour: mobile nav, current-year stamp, radio card states. */
(function () {
  'use strict';

  // Mobile navigation
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Copyright year
  Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  // Selected state on radio/checkbox cards
  var choices = document.querySelectorAll('.choice input');
  if (choices.length) {
    var sync = function () {
      Array.prototype.forEach.call(document.querySelectorAll('.choice'), function (card) {
        var input = card.querySelector('input');
        card.classList.toggle('is-checked', !!(input && input.checked));
      });
    };
    Array.prototype.forEach.call(choices, function (input) {
      input.addEventListener('change', sync);
    });
    sync();
  }
})();
