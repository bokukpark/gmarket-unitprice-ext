/**
 * unitParser.js
 * 상품명/옵션 텍스트에서 "총 용량/개수"를 추출하고, 가격과 결합해 단위가격을 계산한다.
 *
 * 지원 패턴 예시:
 *   "펩시 제로 콜라 500ml"                -> 500ml
 *   "펩시 제로 콜라 500ml x 20개"          -> 500ml * 20 = 10000ml
 *   "펩시 제로 콜라 355ml 24캔"            -> 355ml * 24 = 8520ml
 *   "코카콜라 제로 1.5L"                   -> 1500ml
 *   "삼다수 2L 6개입"                      -> 2000ml * 6 = 12000ml
 *   "즉석밥 210g x 12개"                   -> 210g * 12 = 2520g
 *   "물티슈 100매 x 3팩"                   -> 300매(개)
 *   "볼펜 12자루"                          -> 12개
 *
 * 정규화 기준 단위:
 *   부피: ml (L -> *1000)
 *   무게: g  (kg -> *1000)
 *   개수: count (개/입/매/캔/포/팩/자루/롤 등 -> count, 단 "묶음/포/팩" 자체가 배수인 경우는 곱셈 처리)
 */

'use strict';

// 단위 카테고리 정의: 매칭 문자열 -> {category, toBase(값)}
const VOLUME_UNITS = {
  'ml': { category: 'volume', factor: 1 },
  '㎖': { category: 'volume', factor: 1 },
  'l': { category: 'volume', factor: 1000 },
  '리터': { category: 'volume', factor: 1000 },
};

const WEIGHT_UNITS = {
  'mg': { category: 'weight', factor: 0.001 },
  'g': { category: 'weight', factor: 1 },
  'kg': { category: 'weight', factor: 1000 },
};

const COUNT_UNITS = {
  '개입': { category: 'count', factor: 1 }, // "6개입" 처럼 붙어쓰는 흔한 복합 표기
  '매입': { category: 'count', factor: 1 },
  '개': { category: 'count', factor: 1 },
  '입': { category: 'count', factor: 1 },
  '매': { category: 'count', factor: 1 },
  '캔': { category: 'count', factor: 1 },
  '병': { category: 'count', factor: 1 },
  '포': { category: 'count', factor: 1 },
  '팩': { category: 'count', factor: 1 },
  '롤': { category: 'count', factor: 1 },
  '장': { category: 'count', factor: 1 },
  '족': { category: 'count', factor: 1 },
  '자루': { category: 'count', factor: 1 },
  '봉': { category: 'count', factor: 1 },
  '박스': { category: 'count', factor: 1 },
  '세트': { category: 'count', factor: 1 },
  'pet': { category: 'count', factor: 1 }, // "1.25L x 12PET" 같은 생수/음료 실무 표기
  'ea': { category: 'count', factor: 1 },
};

const ALL_UNITS = { ...VOLUME_UNITS, ...WEIGHT_UNITS, ...COUNT_UNITS };

// 긴 단위 문자열이 먼저 매칭되도록 길이 내림차순 정렬
const UNIT_KEYS_SORTED = Object.keys(ALL_UNITS).sort((a, b) => b.length - a.length);

// 숫자(콤마/소수 허용) + 공백* + 단위 패턴
// 예: "500ml", "1.5 L", "1,000원", "12개"
function buildQuantityRegex() {
  const unitAlt = UNIT_KEYS_SORTED.map(escapeRegex).join('|');
  // 대소문자 무시, 전역 매칭
  // 단위 뒤에 'x'/'X'(배수 기호, 예: "210mlx30캔")가 붙는 건 허용해야 하므로
  // 부정형 lookahead에서 x/X는 제외한다.
  return new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${unitAlt})(?![a-wyzA-WYZ가-힣])`, 'gi');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const QUANTITY_REGEX = buildQuantityRegex();

// 배수 표기: "x 20", "X20", "*20", "20개입" 등에서 곱셈 개수를 찾기 위한 보조 패턴
// "500ml x 20개" 같은 경우는 QUANTITY_REGEX가 "500ml"과 "20개"를 각각 잡아내고,
// 둘 중 하나는 volume/weight, 하나는 count 이므로 곱해주면 된다.

/**
 * 텍스트에서 발견된 모든 (수량, 단위) 토큰을 추출한다.
 * @param {string} text
 * @returns {Array<{value:number, rawUnit:string, category:string, baseValue:number}>}
 */
function extractTokens(text) {
  const tokens = [];
  if (!text) return tokens;
  let match;
  const re = new RegExp(QUANTITY_REGEX.source, QUANTITY_REGEX.flags);
  while ((match = re.exec(text)) !== null) {
    const rawNum = match[1].replace(/,/g, '');
    const value = parseFloat(rawNum);
    const rawUnit = match[2].toLowerCase();
    const unitInfo = ALL_UNITS[rawUnit];
    if (!unitInfo || Number.isNaN(value)) continue;
    tokens.push({
      value,
      rawUnit,
      category: unitInfo.category,
      baseValue: value * unitInfo.factor,
      index: match.index,
    });
  }
  return tokens;
}

/**
 * 괄호 안 내용은 대부분 "총합 재확인" 성격의 중복 정보이거나 부가 설명이라
 * (예: "210ml 60캔 (30캔 2박스)") 이중 계산을 유발할 수 있어 제거한다.
 */
function stripParentheses(text) {
  return text.replace(/[([][^)\]]*[)\]]/g, ' ');
}

/**
 * 세그먼트(번들 하나) 안에서 "기준 용량/무게" x "그 안의 개수 토큰들의 곱"을 계산한다.
 * @param {Array} tokens - extractTokens() 결과 중 이 세그먼트에 속하는 토큰들
 * @returns {{ unit: 'ml'|'g'|'count', totalValue: number } | null}
 */
function resolveSegment(tokens) {
  if (tokens.length === 0) return null;
  const volumeOrWeight = tokens.filter(t => t.category === 'volume' || t.category === 'weight');
  const counts = tokens.filter(t => t.category === 'count');

  if (volumeOrWeight.length > 0) {
    const base = volumeOrWeight[0];
    const multiplier = counts.length > 0
      ? counts.reduce((acc, c) => acc * c.value, 1)
      : 1;
    const unit = base.category === 'volume' ? 'ml' : 'g';
    return { unit, totalValue: base.baseValue * multiplier };
  }

  if (counts.length > 0) {
    const totalCount = counts.reduce((acc, c) => acc * c.value, 1);
    return { unit: 'count', totalValue: totalCount };
  }

  return null;
}

/**
 * 추출된 토큰들을 조합해 "최종 총량"을 계산한다.
 *
 * 실제 오픈마켓 상품명은 아래처럼 여러 패턴이 섞여 나타난다:
 *  - 단순: "500ml"
 *  - 배수: "500ml x 20개" -> 500 * 20
 *  - 번들(서로 다른 상품 묶음): "A 210ml 30캔 + B 210ml 30캔" -> 각각 계산 후 합산
 *  - 중복 표기: "210ml 60캔 (30캔 2박스)" -> 괄호는 총합 재확인이므로 제거 후 계산
 *
 * 전략:
 *  1. 괄호 내용 제거 (중복/부가 정보로 간주)
 *  2. '+' 기준으로 세그먼트 분리 (번들 상품 대응)
 *  3. 각 세그먼트를 독립적으로 파싱 (그 세그먼트 안의 count 토큰들만 곱함)
 *  4. 모든 세그먼트의 unit이 동일하면(ml/g/count) 합산, 하나라도 unit이 다르면
 *     비교가 무의미하므로 파싱 실패 처리
 *
 * @param {string} text
 * @returns {{ totalValue: number, unit: 'ml'|'g'|'count', tokens: Array } | null}
 */
function parseQuantity(text) {
  if (!text) return null;
  const cleaned = stripParentheses(text);
  const segments = cleaned.split('+');

  const resolvedSegments = [];
  const allTokens = [];

  for (const seg of segments) {
    const tokens = extractTokens(seg);
    allTokens.push(...tokens);
    const resolved = resolveSegment(tokens);
    if (resolved) resolvedSegments.push(resolved);
  }

  if (resolvedSegments.length === 0) return null;

  const unit = resolvedSegments[0].unit;
  const allSameUnit = resolvedSegments.every(s => s.unit === unit);
  if (!allSameUnit) return null; // 예: 부피 상품 + 무게 상품 묶음은 비교 불가

  const totalValue = resolvedSegments.reduce((acc, s) => acc + s.totalValue, 0);

  return { totalValue, unit, tokens: allTokens };
}

/**
 * 가격 문자열/숫자와 상품명 텍스트를 받아 단위가격을 계산한다.
 * @param {number} price - 원 단위 숫자 가격 (콤마/원 기호 제거된 상태)
 * @param {string} text - 상품명 + 옵션 텍스트
 * @returns {{ unitPrice: number, unit: string, displayUnit: string, totalValue: number } | null}
 */
function calcUnitPrice(price, text) {
  if (typeof price !== 'number' || Number.isNaN(price) || price <= 0) return null;
  const qty = parseQuantity(text);
  if (!qty) return null;

  let unitPrice, displayUnit, perAmount;
  if (qty.unit === 'ml') {
    perAmount = 100; // 100ml당 가격
    unitPrice = (price / qty.totalValue) * perAmount;
    displayUnit = '100ml';
  } else if (qty.unit === 'g') {
    perAmount = 100; // 100g당 가격
    unitPrice = (price / qty.totalValue) * perAmount;
    displayUnit = '100g';
  } else {
    // count
    unitPrice = price / qty.totalValue;
    displayUnit = '개';
  }

  return {
    unitPrice: Math.round(unitPrice * 100) / 100, // 소수 2자리
    unit: qty.unit,
    displayUnit,
    totalValue: qty.totalValue,
  };
}

/**
 * 가격 텍스트("12,900원", "12900" 등)를 숫자로 정규화한다.
 */
function parsePrice(priceText) {
  if (typeof priceText === 'number') return priceText;
  if (!priceText) return null;
  const cleaned = String(priceText).replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  return parseInt(cleaned, 10);
}

const UnitParser = {
  extractTokens,
  parseQuantity,
  calcUnitPrice,
  parsePrice,
};

// Node(테스트/빌드) 환경과 브라우저 content script 환경 양쪽 지원
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UnitParser;
}
if (typeof window !== 'undefined') {
  window.UnitParser = UnitParser;
}
