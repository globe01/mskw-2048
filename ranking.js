(function (root) {
  'use strict';
  // One ranking rule for the browser (including offline play) and the server.
  function compare(a, b) {
    return Number(b.maxTile) - Number(a.maxTile)
      || Number(b.score) - Number(a.score)
      || Number(a.at) - Number(b.at);
  }
  if (typeof module === 'object' && module.exports) module.exports = { compare };
  else root.MskwRanking = Object.freeze({ compare });
})(typeof globalThis !== 'undefined' ? globalThis : this);
