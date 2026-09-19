/*
 * Deterministic structural state application for the my-frontend-observer
 * v0.9 demo.
 *
 * Geometry is owned entirely by styles.css, keyed on the `data-demo-state`
 * attribute the demo server injects into <html>. This script owns only the
 * two structural differences CSS cannot express honestly:
 *
 *   1. removing a card from the DOM (so a "removed" region is genuinely
 *      absent, not merely hidden), and
 *   2. swapping the local illustration asset while the surrounding
 *      container geometry stays fixed.
 *
 * It runs synchronously at the end of <body>, before the load event, so a
 * capture taken at readiness always sees the settled layout. No timers, no
 * randomness, no network, no current time.
 */
(function () {
  'use strict';

  var STATES = [
    'baseline',
    'move-hero',
    'wider-sidebar',
    'changed-spacing',
    'move-footer',
    'removed-card',
    'changed-asset',
    'multi-change',
    'reference',
  ];
  var REMOVED_CARD_STATES = ['removed-card', 'multi-change'];
  var ALTERNATE_ASSET_STATES = ['changed-asset', 'multi-change', 'reference'];
  var REMOVED_CARD_TARGET = 'card-2';
  var ALTERNATE_ASSET_SRC = 'assets/asset-alternate.svg';

  var root = document.documentElement;
  var state = root.getAttribute('data-demo-state') || 'baseline';
  // The server already rejects an unknown state before serving this document.
  // This is a second, closed check so the script can never act on a value
  // outside the frozen vocabulary.
  if (STATES.indexOf(state) === -1) {
    state = 'baseline';
    root.setAttribute('data-demo-state', state);
  }

  var badge = document.querySelector('[data-testid="demo-state-badge"]');
  if (badge) badge.textContent = state;

  var currentLink = document.querySelector('[data-testid="demo-nav-' + state + '"]');
  if (currentLink) currentLink.setAttribute('aria-current', 'page');

  if (REMOVED_CARD_STATES.indexOf(state) !== -1) {
    var card = document.querySelector('[data-demo-target="' + REMOVED_CARD_TARGET + '"]');
    if (card && card.parentNode) card.parentNode.removeChild(card);
  }

  if (ALTERNATE_ASSET_STATES.indexOf(state) !== -1) {
    var image = document.querySelector('[data-testid="demo-asset-image"]');
    if (image) image.setAttribute('src', ALTERNATE_ASSET_SRC);
  }
})();
