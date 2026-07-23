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

  // ---- 설정: 실제 DOM 확인 후 이 부분만 교체하면 됨 ----
  const SELECTORS = {
    // 상품 카드 하나를 감싸는 컨테이너 후보들(우선순위 순으로 시도)
    cardCandidates: [
      'div.box__component-itemcard',
      'li.box__item',
      'div[data-montelena-nclick] li',
      'ul.grid__row li',
    ],
    // 카드 내부 상품명 텍스트
    nameCandidates: ['.text__item', '.itemname', 'a[data-montelena-nclick] .text', 'strong.title'],
    // 카드 내부 가격 텍스트 (판매가)
    priceCandidates: ['.box__price-seller strong', '.price_seller', 'strong.text__value', '.box__price strong'],
  };

  const BADGE_CLASS = 'upx-badge';
  const PROCESSED_ATTR = 'data-upx-processed';

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

  function run() {
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
