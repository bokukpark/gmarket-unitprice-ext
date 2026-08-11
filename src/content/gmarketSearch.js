/**
 * gmarketSearch.js
 * 지마켓 검색 결과 페이지(content script)에서 상품 카드들을 찾아
 * 상품명+가격을 파싱하고, 단위가격 뱃지를 삽입한다.
 *
 * ⚠️ 셀렉터 미확정 상태:
 *  지마켓이 봇 차단(Cloudflare)을 걸어두어 정확한 실제 DOM 구조를 사전에 확보하지 못했다.
 *  아래 CARD_SELECTOR_CANDIDATES 는 흔히 쓰이는 패턴 기반의 추정치이며,
 *  실제 페이지에서 상품 카드 DOM(outerHTML)을 확인 후 SELECTORS 값을 교체해야 한다.
 *  (크롬 개발자도구 > 상품 카드 우클릭 > 검사 > Copy > Copy outerHTML)
 */

(function () {
  'use strict';

  const { calcUnitPrice, parsePrice } = window.UnitParser;

  // ---- 설정: patchright로 실제 지마켓 검색 결과 페이지(2024-07)를 확인해 확정한 셀렉터 ----
  // 참고: 지마켓은 Cloudflare 봇 차단이 있어 curl/일반 headless로는 접근 불가.
  //       patchright(스텔스 패치된 Playwright)로 우회해 실제 DOM을 확인함.
  const SELECTORS = {
    // 상품 카드 하나를 감싸는 컨테이너
    cardCandidates: [
      '.box__component-itemcard',
    ],
    // 카드 내부 상품명 텍스트 (title 속성에도 동일 텍스트가 있어 안전)
    nameCandidates: ['.text__item'],
    // 카드 내부 판매가(할인 적용된 최종가). strong 태그만 정확히 선택해야
    // "할인률 6%" 같은 텍스트가 섞이지 않는다.
    priceCandidates: ['.box__price-seller strong.text__value'],
  };

  const BADGE_CLASS = 'upx-badge';
  const PROCESSED_ATTR = 'data-upx-processed';
  const SORT_OVERLAY_ID = 'upx-sort-overlay';
  let isSortedByUnitPrice = false;

  function firstMatch(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findCards() {
    for (const sel of SELECTORS.cardCandidates) {
      const nodes = document.querySelectorAll(sel);
      if (nodes.length > 0) return Array.from(nodes);
    }
    return [];
  }

  function extractCardData(card) {
    const nameEl = firstMatch(card, SELECTORS.nameCandidates);
    const priceEl = firstMatch(card, SELECTORS.priceCandidates);
    if (!nameEl || !priceEl) return null;

    const name = nameEl.textContent.trim();
    const price = parsePrice(priceEl.textContent);
    if (!price) return null;

    return { name, price, nameEl, priceEl };
  }

  function renderBadge(card, result) {
    // 이미 붙어있으면 갱신만
    let badge = card.querySelector(`.${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement('div');
      badge.className = BADGE_CLASS;
      card.appendChild(badge);
    }
    badge.textContent = `${result.unitPrice.toLocaleString()}원 / ${result.displayUnit}`;
    badge.dataset.unitPrice = String(result.unitPrice);
  }

  function renderUnknownBadge(card) {
    let badge = card.querySelector(`.${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement('div');
      badge.className = BADGE_CLASS + ' upx-badge--unknown';
      card.appendChild(badge);
    }
    badge.textContent = '단위 파싱 불가';
  }

  function processCards() {
    const cards = findCards();
    const results = [];

    for (const card of cards) {
      if (card.getAttribute(PROCESSED_ATTR) === '1') {
        // 이미 처리됨 -> 배지에서 unitPrice 재수집 (정렬용)
        const badge = card.querySelector(`.${BADGE_CLASS}`);
        const up = badge && badge.dataset.unitPrice ? parseFloat(badge.dataset.unitPrice) : null;
        if (up != null) results.push({ card, unitPrice: up });
        continue;
      }

      const data = extractCardData(card);
      card.setAttribute(PROCESSED_ATTR, '1');

      if (!data) continue;

      const result = calcUnitPrice(data.price, data.name);
      if (result) {
        renderBadge(card, result);
        results.push({ card, unitPrice: result.unitPrice });
      } else {
        renderUnknownBadge(card);
      }
    }

    return results;
  }

  function highlightCheapest(results) {
    if (results.length === 0) return;
    const sorted = [...results].sort((a, b) => a.unitPrice - b.unitPrice);
    // 기존 강조 제거
    document.querySelectorAll('.upx-cheapest').forEach(el => el.classList.remove('upx-cheapest'));
    sorted[0].card.classList.add('upx-cheapest');
  }

  // 카드가 모두 같은 부모에 있을 때만 DOM 순서를 바꾼다. 광고/추천 카드처럼
  // 다른 컨테이너에 있는 카드는 원래 위치를 유지해 검색 결과 레이아웃을 깨지 않는다.
  function sortCardsByUnitPrice(results) {
    const sortable = results.filter(({ card }) => card.parentElement);
    if (sortable.length < 2) return;

    const parent = sortable[0].card.parentElement;
    const cards = sortable.filter(({ card }) => card.parentElement === parent);
    if (cards.length < 2) return;

    cards.forEach(({ card }, index) => {
      if (!card.dataset.upxOriginalOrder) card.dataset.upxOriginalOrder = String(index);
    });
    cards.sort((a, b) => a.unitPrice - b.unitPrice);

    const fragment = document.createDocumentFragment();
    cards.forEach(({ card }) => fragment.appendChild(card));
    parent.appendChild(fragment);
  }

  function restoreCardOrder() {
    const cards = findCards().filter(card => card.dataset.upxOriginalOrder != null && card.parentElement);
    if (cards.length < 2) return;
    const parent = cards[0].parentElement;
    const siblings = cards.filter(card => card.parentElement === parent);
    siblings.sort((a, b) => Number(a.dataset.upxOriginalOrder) - Number(b.dataset.upxOriginalOrder));
    const fragment = document.createDocumentFragment();
    siblings.forEach(card => fragment.appendChild(card));
    parent.appendChild(fragment);
  }

  function ensureSortOverlay() {
    if (document.getElementById(SORT_OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = SORT_OVERLAY_ID;
    overlay.className = 'upx-sort-overlay';
    overlay.innerHTML = '<button type="button" class="upx-sort-btn" aria-pressed="false">단위가격 낮은순 정렬</button>';
    document.body.appendChild(overlay);

    const button = overlay.querySelector('.upx-sort-btn');
    button.addEventListener('click', () => {
      const results = processCards();
      isSortedByUnitPrice = !isSortedByUnitPrice;
      if (isSortedByUnitPrice) {
        sortCardsByUnitPrice(results);
        button.textContent = '원래 순서로 보기';
      } else {
        restoreCardOrder();
        button.textContent = '단위가격 낮은순 정렬';
      }
      button.classList.toggle('upx-sort-btn--active', isSortedByUnitPrice);
      button.setAttribute('aria-pressed', String(isSortedByUnitPrice));
    });
  }

  function run() {
    ensureSortOverlay();
    const results = processCards();
    highlightCheapest(results);
  }

  // 초기 실행
  run();

  // 지마켓은 SPA/무한스크롤/필터 변경 등으로 리스트가 동적으로 갱신될 수 있으므로
  // MutationObserver로 리스트 컨테이너 변화를 감지해 재실행한다.
  const observer = new MutationObserver(() => {
    // 과도한 재실행 방지를 위해 디바운스
    clearTimeout(window.__upxDebounce);
    window.__upxDebounce = setTimeout(run, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
