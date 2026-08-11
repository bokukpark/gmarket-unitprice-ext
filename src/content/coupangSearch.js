/**
 * coupangSearch.js
 * 쿠팡 검색 결과 페이지(content script)에서 상품 카드들을 찾아
 * 상품명+최종판매가(+배송비)를 파싱하고, 단위가격 뱃지를 삽입한다.
 *
 * 쿠팡의 특이사항 (지마켓과 다른 점):
 *  1. 쿠팡은 이미 자체 단위가격("(100ml당 365원)")을 카드에 표시해준다.
 *     실측 검증 결과 이 값은 "배송비 미포함" 상품가 기준이며, 로켓배송 여부와
 *     무관하게 검색 결과 전반에 광범위하게 붙어 있었다(3개 카테고리·180개 카드 전수 확인).
 *  2. 다만 배송비가 상품가에 비해 매우 클 수 있어(예: 5,110원 상품에 배송비 10,000원),
 *     쿠팡이 보여주는 "배송비 미포함" 단위가격만 보고 비교하면 실제 체감 가격과
 *     크게 어긋날 수 있다. 그래서 이 파일은 쿠팡 표시값을 그대로 쓰지 않고,
 *     상품명에서 직접 총 용량을 재계산해(unitParser.js 재사용) 배송비 포함/미포함
 *     두 가지 단위가격을 모두 계산한다.
 *  3. 정렬 토글 UI를 제공해 "배송비 미포함 기준"과 "배송비 포함 기준" 중
 *     선택해서 최저가 하이라이트를 볼 수 있게 한다.
 */

(function () {
  'use strict';

  const { calcUnitPrice, parsePrice } = window.UnitParser;

  const SELECTORS = {
    cardCandidates: ['.ProductUnit_productUnit__Qd6sv'],
    nameCandidates: ['.ProductUnit_productNameV2__cV9cw'],
    // 최종 판매가(할인 적용된 값). text-[20px] 폰트 크기를 가진 굵은 span이 최종가.
    priceCandidates: ['.PriceArea_priceArea__NntJz div[class*="fw-text-[20px]"] span'],
    // 배송비 별도 표시 배지 (없으면 무료배송/배송비 포함으로 간주)
    shippingFeeCandidates: ['[data-badge-type="feePrice"]'],
  };

  const BADGE_CLASS = 'upx-badge';
  const PROCESSED_ATTR = 'data-upx-processed';
  const TOGGLE_ID = 'upx-sort-toggle';
  const SORT_BUTTON_ID = 'upx-sort-button';

  // 'excludeShipping' | 'includeShipping' — 현재 정렬/하이라이트 기준
  let sortMode = 'excludeShipping';
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

    const shippingEl = firstMatch(card, SELECTORS.shippingFeeCandidates);
    // "배송비 10,000원" 텍스트에서 숫자만 추출
    const shippingFee = shippingEl ? (parsePrice(shippingEl.textContent) || 0) : 0;

    return { name, price, shippingFee };
  }

  function renderBadge(card, result) {
    let badge = card.querySelector(`.${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement('div');
      badge.className = BADGE_CLASS;
      card.appendChild(badge);
    }
    const excludeText = `${result.unitPrice.toLocaleString()}원 / ${result.displayUnit}`;
    const includeText = result.shippingFee > 0
      ? `${result.unitPriceWithShipping.toLocaleString()}원 / ${result.displayUnit} (배송비 포함)`
      : null;

    badge.textContent = includeText
      ? (sortMode === 'includeShipping' ? includeText : excludeText)
      : excludeText;

    badge.dataset.unitPrice = String(result.unitPrice);
    badge.dataset.unitPriceWithShipping = String(result.unitPriceWithShipping);
    badge.dataset.shippingFee = String(result.shippingFee);

    // 배송비가 있는 상품은 둘 다 참고할 수 있게 title(툴팁)로 노출
    if (result.shippingFee > 0) {
      badge.title = `배송비 미포함: ${result.unitPrice.toLocaleString()}원/${result.displayUnit}\n` +
        `배송비 포함(+${result.shippingFee.toLocaleString()}원): ${result.unitPriceWithShipping.toLocaleString()}원/${result.displayUnit}`;
    } else {
      badge.title = '';
    }
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
      let data;
      if (card.getAttribute(PROCESSED_ATTR) === '1') {
        data = {
          price: parseFloat(card.dataset.upxPrice || 'NaN'),
          shippingFee: parseFloat(card.dataset.upxShipping || '0'),
          name: card.dataset.upxName || '',
        };
        if (Number.isNaN(data.price)) continue;
      } else {
        data = extractCardData(card);
        card.setAttribute(PROCESSED_ATTR, '1');
        if (!data) continue;
        card.dataset.upxPrice = String(data.price);
        card.dataset.upxShipping = String(data.shippingFee);
        card.dataset.upxName = data.name;
      }

      const result = calcUnitPrice(data.price, data.name, data.shippingFee);
      if (result) {
        renderBadge(card, result);
        results.push({
          card,
          unitPrice: result.unitPrice,
          unitPriceWithShipping: result.unitPriceWithShipping,
        });
      } else {
        renderUnknownBadge(card);
      }
    }

    return results;
  }

  function highlightCheapest(results) {
    if (results.length === 0) return;
    const key = sortMode === 'includeShipping' ? 'unitPriceWithShipping' : 'unitPrice';
    const sorted = [...results].sort((a, b) => a[key] - b[key]);
    document.querySelectorAll('.upx-cheapest').forEach(el => el.classList.remove('upx-cheapest'));
    sorted[0].card.classList.add('upx-cheapest');
  }

  function sortCardsByUnitPrice(results) {
    const key = sortMode === 'includeShipping' ? 'unitPriceWithShipping' : 'unitPrice';
    const sortable = results.filter(({ card }) => card.parentElement);
    if (sortable.length < 2) return;

    const parent = sortable[0].card.parentElement;
    const cards = sortable.filter(({ card }) => card.parentElement === parent);
    if (cards.length < 2) return;

    cards.forEach(({ card }, index) => {
      if (!card.dataset.upxOriginalOrder) card.dataset.upxOriginalOrder = String(index);
    });
    cards.sort((a, b) => a[key] - b[key]);

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

  function refreshBadgeTexts(results) {
    // 정렬 모드가 바뀌면 이미 렌더링된 배지 텍스트도 갱신
    results.forEach(({ card }) => {
      const price = parseFloat(card.dataset.upxPrice || 'NaN');
      const shipping = parseFloat(card.dataset.upxShipping || '0');
      const name = card.dataset.upxName || '';
      if (Number.isNaN(price)) return;
      const result = window.UnitParser.calcUnitPrice(price, name, shipping);
      if (result) renderBadge(card, result);
    });
  }

  function ensureToggleUI() {
    if (document.getElementById(TOGGLE_ID)) return;

    const container = document.createElement('div');
    container.id = TOGGLE_ID;
    container.className = 'upx-toggle-container';
    container.innerHTML = `
      <span class="upx-toggle-label">단위가격 기준:</span>
      <button type="button" class="upx-toggle-btn upx-toggle-btn--active" data-mode="excludeShipping">배송비 제외</button>
      <button type="button" class="upx-toggle-btn" data-mode="includeShipping">배송비 포함</button>
    `;
    document.body.appendChild(container);

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.upx-toggle-btn');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === sortMode) return;
      sortMode = mode;

      container.querySelectorAll('.upx-toggle-btn').forEach(b => {
        b.classList.toggle('upx-toggle-btn--active', b.dataset.mode === sortMode);
      });

      const results = processCards();
      refreshBadgeTexts(results);
      highlightCheapest(results);
      if (isSortedByUnitPrice) sortCardsByUnitPrice(results);
    });

    const sortButton = document.createElement('button');
    sortButton.id = SORT_BUTTON_ID;
    sortButton.type = 'button';
    sortButton.className = 'upx-sort-btn';
    sortButton.textContent = '단위가격 낮은순 정렬';
    sortButton.setAttribute('aria-pressed', 'false');
    container.appendChild(sortButton);
    sortButton.addEventListener('click', () => {
      const results = processCards();
      isSortedByUnitPrice = !isSortedByUnitPrice;
      if (isSortedByUnitPrice) {
        sortCardsByUnitPrice(results);
        sortButton.textContent = '원래 순서로 보기';
      } else {
        restoreCardOrder();
        sortButton.textContent = '단위가격 낮은순 정렬';
      }
      sortButton.classList.toggle('upx-sort-btn--active', isSortedByUnitPrice);
      sortButton.setAttribute('aria-pressed', String(isSortedByUnitPrice));
    });
  }

  function run() {
    ensureToggleUI();
    const results = processCards();
    highlightCheapest(results);
  }

  run();

  const observer = new MutationObserver(() => {
    clearTimeout(window.__upxDebounce);
    window.__upxDebounce = setTimeout(run, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
