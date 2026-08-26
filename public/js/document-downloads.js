(function () {
  'use strict';

  var cards = Array.prototype.slice.call(document.querySelectorAll('.dok-card'));
  var countNodes = new Map();
  cards.forEach(function (card) {
    var links = Array.prototype.slice.call(card.querySelectorAll('a[href^="/downloads/"], a[href^="/download-document/"]'));
    if (!links.length) return;
    var filename = links[0].getAttribute('href').split('/').pop() || '';
    var documentId = filename.replace(/\.(?:docx|pdf)$/i, '');
    if (!documentId) return;
    links.forEach(function (link) {
      var ownFilename = link.getAttribute('href').split('/').pop();
      if (link.getAttribute('href').indexOf('/downloads/') === 0) {
        link.setAttribute('href', '/download-document/' + encodeURIComponent(ownFilename));
      }
    });
    var count = document.createElement('div');
    count.className = 'dok-download-count';
    count.setAttribute('data-document-download-count', documentId);
    count.innerHTML = '<i class="bi bi-graph-up-arrow" aria-hidden="true"></i><span>Считаем скачивания…</span>';
    var buttons = card.querySelector('.dok-btns');
    if (buttons) buttons.insertAdjacentElement('afterend', count);
    countNodes.set(documentId, count.querySelector('span'));
  });

  if (!countNodes.size) return;
  fetch('/api/document-download-counts', { credentials: 'same-origin' })
    .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status)); })
    .then(function (payload) {
      countNodes.forEach(function (element, documentId) {
        var count = Number(payload.counts && payload.counts[documentId]) || 0;
        element.textContent = count.toLocaleString('ru-RU') + ' ' + (count % 10 === 1 && count % 100 !== 11 ? 'скачивание' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'скачивания' : 'скачиваний');
      });
    })
    .catch(function () {
      countNodes.forEach(function (element) { element.textContent = 'Счётчик временно недоступен'; });
    });
})();
