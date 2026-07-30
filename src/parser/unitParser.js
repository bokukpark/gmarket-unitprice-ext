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

// 길이 단위: 화장지/키친타월처럼 "30M 30롤"(롤당 길이 x 롤 수)로 표기되는 상품군에 필수.
// 기준 단위는 m(미터). 'ml'/'mg'와 접두 충돌이 없도록 QUANTITY_REGEX가 긴 단위부터
// 매칭하는 정렬(UNIT_KEYS_SORTED)에 의존한다.
const LENGTH_UNITS = {
  'm': { category: 'length', factor: 1 },
  'cm': { category: 'length', factor: 0.01 },
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

const ALL_UNITS = { ...VOLUME_UNITS, ...WEIGHT_UNITS, ...LENGTH_UNITS, ...COUNT_UNITS };

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

    // "70g/㎡"(평량, 종이 두께 단위) 처럼 무게 단위를 재활용해 "제품 총량"이 아닌
    // "재질 밀도/스펙"을 표기하는 경우가 있다 (물티슈/화장지 원단 두께 등).
    // 이런 토큰은 총량 계산에 넣으면 안 되므로 근처에 "평량" 키워드가 있으면 제외한다.
    const contextWindow = text.slice(Math.max(0, match.index - 6), match.index + match[0].length + 6);
    if (unitInfo.category === 'weight' && /평량/.test(contextWindow)) {
      continue;
    }

    // "총32개"처럼 숫자 바로 앞에 '총'이 붙으면 "이게 최종 총합이다"라고 명시하는 표기다.
    // 이 신호 자체로 무조건 제외/채택을 결정하지 않고, resolveCluster에서
    // "총" 앞 다른 토큰들의 곱과 비교해 재진술인지 권위있는 총합 override인지 판단한다.
    const precedingChars = text.slice(Math.max(0, match.index - 2), match.index);
    const hasTotalPrefix = /총\s*$/.test(precedingChars);
    tokens.push({
      value,
      rawUnit,
      category: unitInfo.category,
      baseValue: value * unitInfo.factor,
      index: match.index,
      length: match[0].length,
      hasTotalPrefix,
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
 * 인접 토큰끼리 묶어 "하나의 수량 표현 단위(클러스터)"로 그룹핑한다.
 * 실제 상품명은 "100매 60팩" 처럼 진짜 곱셈 관계인 토큰들도 있지만,
 * "6000매 ... 100매 60팩 ... 6000매" 처럼 서로 무관하거나 총합을 재확인하는
 * 토큰들이 멀리 떨어져 섞여 있는 경우가 많다. 문자 간격(gap)이 임계값을 넘으면
 * 새 클러스터로 분리해 서로 다른 표현을 뭉뚱그려 곱하는 사고를 막는다.
 */
const CLUSTER_GAP_THRESHOLD = 5; // 토큰 사이 문자 간격(공백/조사 등 포함) 허용치

function clusterTokens(tokens) {
  if (tokens.length === 0) return [];
  const sorted = [...tokens].sort((a, b) => a.index - b.index);
  const clusters = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gap = cur.index - (prev.index + prev.length);
    if (gap > CLUSTER_GAP_THRESHOLD) {
      clusters.push([cur]);
    } else {
      clusters[clusters.length - 1].push(cur);
    }
  }
  return clusters;
}

/**
 * count 토큰들을 곱하되, 두 단계로 재진술(중복 표기)을 감지해 곱셈 폭발을 막는다.
 *
 *  1단계 (스팬 내부): 콤마로 나뉘지 않은 연속 구간(스팬) 안에서, 토큰을 순서대로 곱해가되
 *     어떤 토큰의 값이 "그 스팬 안에서 지금까지 누적된 곱"과 같으면 재진술로 보고 건너뛴다.
 *     예: "6000매 ... 100매 60팩 ... 6000매" (콤마 없음, 전체가 한 스팬)
 *         -> 100*60=6000, 그 다음 6000은 누적값과 같으므로 스킵 -> 최종 6000
 *
 *  2단계 (스팬 사이): 콤마로 나뉜 여러 스팬은 "서로 다른 방식으로 같은 총량을 표현"하는
 *     경우가 흔하다 (예: "30롤 3팩, 30개입, 3개" — 30*3=90을 "30개입"/"3개"로 다시 풀어 쓴 것).
 *     이런 경우 전부 곱하면 안 되고, 가장 상세히 풀어 쓴(토큰 수가 가장 많은) 스팬 하나만
 *     채택한다. 동률이면 값이 큰 스팬을 채택한다.
 *
 * @param {Array} counts - category가 'count'인 토큰 배열
 * @param {string} [text] - 원본 세그먼트 텍스트 (콤마 스팬 경계 계산용, 없으면 전체를 한 스팬으로 취급)
 */
function multiplyWithRestatementSkip(counts, text) {
  if (counts.length === 0) return 1;
  const sorted = [...counts].sort((a, b) => a.index - b.index);

  // 콤마 기준으로 스팬 분리 (text 없으면 전체가 하나의 스팬)
  const spans = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const between = text ? text.slice(prev.index + prev.length, cur.index) : '';
    if (between.includes(',')) {
      spans.push([cur]);
    } else {
      spans[spans.length - 1].push(cur);
    }
  }

  // 1단계: 스팬 내부 토큰 단위 재진술 스킵
  function multiplyWithinSpan(tokens) {
    let running = 1;
    for (const t of tokens) {
      const isRestatement = running !== 1 && Math.abs(t.value - running) < 0.001 * running + 1e-9;
      if (!isRestatement) running *= t.value;
    }
    return running;
  }

  if (spans.length === 1) {
    return multiplyWithinSpan(spans[0]);
  }

  // 2단계: 스팬이 여럿이면 "가장 상세한"(토큰 수 최다, 동률이면 값 최대) 스팬 하나만 채택
  let bestSpan = spans[0];
  let bestProduct = multiplyWithinSpan(bestSpan);
  for (let i = 1; i < spans.length; i++) {
    const product = multiplyWithinSpan(spans[i]);
    const better = spans[i].length !== bestSpan.length
      ? spans[i].length > bestSpan.length
      : product > bestProduct;
    if (better) {
      bestSpan = spans[i];
      bestProduct = product;
    }
  }
  return bestProduct;
}

/**
 * 클러스터 하나를 "단위 값"으로 변환한다.
 * @returns {{ unit: 'ml'|'g'|'m'|'count', totalValue: number, tokenCount: number } | null}
 */
function resolveCluster(tokens, text) {
  const measures = tokens.filter(t => t.category === 'volume' || t.category === 'weight' || t.category === 'length');
  const counts = tokens.filter(t => t.category === 'count');

  // "총N개"처럼 명시적 총합 라벨이 붙은 count 토큰이 있으면, 그 값이 다른 count 토큰들의
  // 곱과 일치하는지 확인한다. 일치하면 재진술(중복)이므로 그 항은 곱셈에서 제외하고
  // 나머지로 계산한 값을 그대로 쓴다. 일치하지 않으면 "총"이 더 권위 있는 최종 수치이므로
  // 그 값을 그대로 총합으로 채택한다 (다른 count는 부분 표기로 간주).
  const totalTagged = counts.filter(c => c.hasTotalPrefix);
  const untaggedCounts = counts.filter(c => !c.hasTotalPrefix);

  function resolveCounts() {
    if (totalTagged.length > 0) {
      const totalCandidate = totalTagged[0];
      const otherProduct = untaggedCounts.length > 0
        ? multiplyWithRestatementSkip(untaggedCounts, text)
        : null;
      if (otherProduct != null && Math.abs(totalCandidate.value - otherProduct) < 0.001 * otherProduct + 1e-9) {
        // 재진술 확인됨 -> 나머지 토큰들의 곱을 사용
        return otherProduct;
      }
      // 총합이 다른 조합과 안 맞거나 비교 대상이 없음 -> "총"이 유일/권위있는 값
      return totalCandidate.value;
    }
    return untaggedCounts.length > 0
      ? multiplyWithRestatementSkip(untaggedCounts, text)
      : null;
  }

  if (measures.length > 0) {
    const base = measures[0];
    const multiplier = resolveCounts();
    const unit = base.category === 'volume' ? 'ml' : base.category === 'weight' ? 'g' : 'm';
    return { unit, totalValue: base.baseValue * (multiplier != null ? multiplier : 1), tokenCount: tokens.length };
  }

  const resolvedCount = resolveCounts();
  if (resolvedCount != null) {
    return { unit: 'count', totalValue: resolvedCount, tokenCount: counts.length };
  }

  return null;
}

/**
 * 세그먼트(번들 하나) 안에서 "기준 용량/무게/길이" x "곱셈 관계의 개수 토큰들"을 계산한다.
 * 세그먼트 내에 여러 클러스터가 있으면:
 *  - 용량/무게/길이(measure) 클러스터가 있으면 그 중 첫 번째를 채택 (가장 신뢰도 높은 표기)
 *  - measure 클러스터가 없으면, 토큰 수가 가장 많은(=가장 상세히 풀어쓴) count 클러스터를 채택
 * @param {Array} tokens - extractTokens() 결과 중 이 세그먼트에 속하는 토큰들
 * @returns {{ unit: 'ml'|'g'|'m'|'count', totalValue: number } | null}
 */
function resolveSegment(tokens, text) {
  if (tokens.length === 0) return null;
  const clusters = clusterTokens(tokens).map(c => resolveCluster(c, text)).filter(Boolean);
  if (clusters.length === 0) return null;

  const measureClusters = clusters.filter(c => c.unit !== 'count');
  if (measureClusters.length > 0) {
    return measureClusters[0];
  }

  // count 전용: 토큰 수가 가장 많은(가장 상세한) 클러스터 채택, 동률이면 값이 큰 쪽
  const best = clusters.reduce((a, b) => {
    if (b.tokenCount !== a.tokenCount) return b.tokenCount > a.tokenCount ? b : a;
    return b.totalValue > a.totalValue ? b : a;
  });
  return best;
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
  const withoutParens = parseQuantityFromCleaned(stripParentheses(text));
  if (withoutParens) return withoutParens;
  // 괄호 제거 후 파싱이 실패했다면, 괄호 안에 유일한 수량 정보가 있었을 가능성이 있다
  // (예: "(46매x12팩)크리넥스 마이비데..."). 원본 텍스트로 재시도한다.
  return parseQuantityFromCleaned(text);
}

function parseQuantityFromCleaned(cleaned) {
  const segments = cleaned.split('+');

  const resolvedSegments = [];
  const allTokens = [];

  for (const seg of segments) {
    const tokens = extractTokens(seg);
    allTokens.push(...tokens);
    const resolved = resolveSegment(tokens, seg);
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
 * @param {number} [shippingFee=0] - 배송비(원). 지정하면 반환값에 배송비 포함 가격도 함께 계산된다.
 *   (쿠팡처럼 "무료배송"이 아니라 건별 배송비가 별도로 붙는 상품 비교 시 필요.
 *    배송비를 무시하고 상품가만으로 비교하면 실제 체감 가격과 크게 어긋날 수 있다 —
 *    예: 5,110원짜리 상품에 배송비 10,000원이 붙으면 실질 단가가 3배 가까이 뛴다.)
 * @returns {{
 *   unitPrice: number,            // 배송비 미포함 단위가격 (기존 동작과 100% 동일, 하위 호환)
 *   unitPriceWithShipping: number,// 배송비 포함 단위가격
 *   unit: string,
 *   displayUnit: string,
 *   totalValue: number,
 *   shippingFee: number
 * } | null}
 */
function calcUnitPrice(price, text, shippingFee) {
  if (typeof price !== 'number' || Number.isNaN(price) || price <= 0) return null;
  const qty = parseQuantity(text);
  if (!qty) return null;

  const fee = typeof shippingFee === 'number' && !Number.isNaN(shippingFee) && shippingFee > 0
    ? shippingFee
    : 0;

  let unitPrice, unitPriceWithShipping, displayUnit, perAmount;
  if (qty.unit === 'ml') {
    perAmount = 100; // 100ml당 가격
    unitPrice = (price / qty.totalValue) * perAmount;
    unitPriceWithShipping = ((price + fee) / qty.totalValue) * perAmount;
    displayUnit = '100ml';
  } else if (qty.unit === 'g') {
    perAmount = 100; // 100g당 가격
    unitPrice = (price / qty.totalValue) * perAmount;
    unitPriceWithShipping = ((price + fee) / qty.totalValue) * perAmount;
    displayUnit = '100g';
  } else if (qty.unit === 'm') {
    perAmount = 1; // 1m당 가격 (화장지/키친타월 등 "총 길이"가 핵심인 상품군)
    unitPrice = price / qty.totalValue;
    unitPriceWithShipping = (price + fee) / qty.totalValue;
    displayUnit = 'm';
  } else {
    // count
    unitPrice = price / qty.totalValue;
    unitPriceWithShipping = (price + fee) / qty.totalValue;
    displayUnit = '개';
  }

  return {
    unitPrice: Math.round(unitPrice * 100) / 100, // 소수 2자리
    unitPriceWithShipping: Math.round(unitPriceWithShipping * 100) / 100,
    unit: qty.unit,
    displayUnit,
    totalValue: qty.totalValue,
    shippingFee: fee,
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
