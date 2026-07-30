const assert = require('assert');
const { parseQuantity, calcUnitPrice, parsePrice } = require('../src/parser/unitParser');

function approxEqual(a, b, eps = 0.01) {
  assert(Math.abs(a - b) < eps, `expected ${a} ~= ${b}`);
}

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

test('단일 용량: 500ml', () => {
  const q = parseQuantity('펩시 제로 콜라 500ml');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 500);
});

test('용량 x 개수: 500ml x 20개', () => {
  const q = parseQuantity('펩시 제로 콜라 500ml x 20개');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 10000);
});

test('용량 + 개수 붙어있음: 355ml 24캔', () => {
  const q = parseQuantity('펩시 제로 콜라 355ml 24캔');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 8520);
});

test('리터 변환: 1.5L', () => {
  const q = parseQuantity('코카콜라 제로 1.5L');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 1500);
});

test('리터 x 개수: 2L 6개입', () => {
  const q = parseQuantity('삼다수 2L 6개입');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 12000);
});

test('무게 x 개수: 210g x 12개', () => {
  const q = parseQuantity('즉석밥 210g x 12개');
  assert.strictEqual(q.unit, 'g');
  approxEqual(q.totalValue, 2520);
});

test('kg 변환: 1kg', () => {
  const q = parseQuantity('설탕 1kg');
  assert.strictEqual(q.unit, 'g');
  approxEqual(q.totalValue, 1000);
});

test('개수만: 매 x 팩 (100매 x 3팩)', () => {
  const q = parseQuantity('물티슈 100매 x 3팩');
  assert.strictEqual(q.unit, 'count');
  approxEqual(q.totalValue, 300);
});

test('개수만 단일: 12자루', () => {
  const q = parseQuantity('볼펜 12자루');
  assert.strictEqual(q.unit, 'count');
  approxEqual(q.totalValue, 12);
});

test('파싱 불가 텍스트', () => {
  const q = parseQuantity('그냥 상품명 아무거나');
  assert.strictEqual(q, null);
});

test('가격 파싱: 콤마/원 제거', () => {
  assert.strictEqual(parsePrice('12,900원'), 12900);
  assert.strictEqual(parsePrice('8500'), 8500);
  assert.strictEqual(parsePrice(3000), 3000);
});

test('단위가격 계산: 500ml x 20개, 12900원 -> 100ml당', () => {
  const r = calcUnitPrice(12900, '펩시 제로 콜라 500ml x 20개');
  assert.strictEqual(r.unit, 'ml');
  assert.strictEqual(r.displayUnit, '100ml');
  approxEqual(r.unitPrice, (12900 / 10000) * 100); // 129
});

test('단위가격 계산: 무게 기준 (즉석밥)', () => {
  const r = calcUnitPrice(15900, '즉석밥 210g x 12개');
  assert.strictEqual(r.displayUnit, '100g');
  approxEqual(r.unitPrice, (15900 / 2520) * 100);
});

test('단위가격 계산: 개수 기준', () => {
  const r = calcUnitPrice(3900, '볼펜 12자루');
  assert.strictEqual(r.displayUnit, '개');
  approxEqual(r.unitPrice, 3900 / 12);
});

test('단위가격: 가격 없거나 0이면 null', () => {
  assert.strictEqual(calcUnitPrice(0, '500ml'), null);
  assert.strictEqual(calcUnitPrice(null, '500ml'), null);
});

test('실전 예시: 같은 펩시 제로콜라, 용량 다른 두 상품 비교', () => {
  const a = calcUnitPrice(19800, '펩시 제로슈거 355ml x 24캔');
  const b = calcUnitPrice(8900, '펩시 제로슈거 500ml x 6개');
  assert(a.unitPrice < b.unitPrice, `a(${a.unitPrice}) should be cheaper per 100ml than b(${b.unitPrice})`);
});

// --- 실제 지마켓 데이터(patchright로 확보) 기반 회귀 테스트 ---
// "펩시 제로콜라", "화장지", "마이비데" 검색 결과에서 파서가 실패하거나
// 완전히 틀린 값을 냈던 케이스들. 재발 방지용.

test('번들 상품(+): 서로 다른 상품 두 개를 합산', () => {
  const q = parseQuantity('펩시제로 210ml 30캔 +사이다제로 210ml 30캔 제로칼로리');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 210 * 30 + 210 * 30); // 12600
});

test('공백 없는 배수 표기: "210mlx30캔"', () => {
  const q = parseQuantity('펩시콜라 제로라임 210mlx30캔');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 6300);
});

test('PET 단위 인식: "1.25L x 12PET"', () => {
  const q = parseQuantity('롯데 펩시콜라 제로슈거 라임 업소용 1.25L x 12PET');
  assert.strictEqual(q.unit, 'ml');
  approxEqual(q.totalValue, 15000);
});

test('길이 단위(화장지): "28m 60롤" -> m 기준', () => {
  const q = parseQuantity('깨끗한나라 벚꽃 3겹 롤화장지 천연펄프 휴지 28m 60롤 최신리뉴얼');
  assert.strictEqual(q.unit, 'm');
  approxEqual(q.totalValue, 1680);
});

test('길이 단위(화장지): "25M X 24롤 2팩" -> 길이 x 롤 x 팩', () => {
  const q = parseQuantity('크리넥스 3겹 울트라클린 화이트 25M X 24롤 2팩 화장지 휴지');
  assert.strictEqual(q.unit, 'm');
  approxEqual(q.totalValue, 1200); // 25 * 24 * 2
});

test('멀리 떨어진 재진술 숫자 무시: "6000매 ... 100매 60팩 ... 6000매"', () => {
  const q = parseQuantity('천연펄프 리필티슈 6000매 숙박업소용 대용량 100매 60팩 리필미용티슈6000매');
  assert.strictEqual(q.unit, 'count');
  // 100*60=6000 이 재진술과 일치 -> 6000 채택 (곱셈 폭발 방지가 핵심)
  approxEqual(q.totalValue, 6000);
});

test('연쇄 배수 중 마지막이 재진술: "100매 1박스 24입 2400매"', () => {
  const q = parseQuantity('베스토 물티슈 100매 1박스 24입 2400매');
  assert.strictEqual(q.unit, 'count');
  approxEqual(q.totalValue, 2400); // 100*1*24=2400 과 일치 -> 재진술 skip
});

test('"총" 라벨이 재진술인 경우: "46매/4개x8개-총32개"', () => {
  const q = parseQuantity('크리넥스 마이비데 물티슈 캡형 46매/4개x8개-총32개');
  assert.strictEqual(q.unit, 'count');
  // 4*8=32와 "총32개"가 일치 -> 재진술, 46매는 별도 클러스터(단일 상품 단위)라 채택 안 됨
  approxEqual(q.totalValue, 32);
});

test('"총" 라벨이 유일한 정보인 경우: "1팩 총 30롤"', () => {
  const q = parseQuantity('헬로키티 4겹 천연펄프 화장지 핑크리본 1팩 총 30롤');
  assert.strictEqual(q.unit, 'count');
  // 1(팩)과 30(총 라벨)이 일치하지 않음 -> "총"이 권위있는 값으로 채택
  approxEqual(q.totalValue, 30);
});

test('괄호 안에 유일한 수량 정보가 있는 경우: "(46매x12팩)상품명..."', () => {
  const q = parseQuantity('(46매x12팩)크리넥스 마이비데 물티슈 리필 클린게어');
  assert.strictEqual(q.unit, 'count');
  approxEqual(q.totalValue, 552); // 46 * 12, 괄호 밖엔 수량 정보 없음 -> 괄호 안으로 폴백
});

test('"평량"(종이 두께 스펙)은 총량이 아니므로 무시: "75g 고평량 ... 70매 10팩"', () => {
  const q = parseQuantity('마이케어 헤이그린 75g 고평량 저자극 두꺼운 물티슈 캡형 70매 10팩');
  assert.strictEqual(q.unit, 'count'); // 75g은 재질 스펙이라 무게 기준이 아니라 개수 기준이 되어야 함
  approxEqual(q.totalValue, 700); // 70 * 10
});

// --- 배송비 포함/불포함 단위가격 (쿠팡 등 배송비 별도 상품 대응) ---

test('배송비 미지정 시 기존 동작과 100% 동일 (하위 호환)', () => {
  const withoutFee = calcUnitPrice(12900, '펩시 제로 콜라 500ml x 20개');
  assert.strictEqual(withoutFee.unitPrice, 129);
  assert.strictEqual(withoutFee.unitPriceWithShipping, 129); // shippingFee 없으면 동일
  assert.strictEqual(withoutFee.shippingFee, 0);
});

test('배송비 반영: 쿠팡 실사례 - 5,110원 상품 + 배송비 10,000원 (1.25L x 12개)', () => {
  const r = calcUnitPrice(5110, '펩시 콜라 제로슈거 라임향, 1.25L, 12개', 10000);
  // 총 용량 1250 * 12 = 15000ml
  approxEqual(r.unitPrice, (5110 / 15000) * 100); // ~34.07원 (쿠팡 표시값과 일치)
  approxEqual(r.unitPriceWithShipping, ((5110 + 10000) / 15000) * 100); // ~100.73원, 배송비 반영시 3배 가까이 뜀
  assert(r.unitPriceWithShipping > r.unitPrice * 2, '배송비 포함시 가격이 대폭 상승해야 함');
});

test('배송비 반영 후 순위가 뒤바뀔 수 있음 (정렬 시나리오 검증)', () => {
  // A: 배송비 미포함 단가는 훨씬 싸 보이지만, 비싼 배송비 때문에 실제로는 더 비쌀 수 있음
  const a = calcUnitPrice(5110, '상품A 1.25L 12개', 10000);      // 미포함 34.07 / 포함 100.73
  const b = calcUnitPrice(8000, '상품B 355ml 24개', 0);          // 무료배송, 93.9원 (배송비 무관하게 동일)
  assert(a.unitPrice < b.unitPrice, '배송비 미포함 기준으로는 A가 더 쌈');
  assert(a.unitPriceWithShipping > b.unitPriceWithShipping, '배송비 포함 기준으로는 순위가 역전됨');
});

test('쿠팡 실사례: 콤마로 구분된 여러 스팬이 같은 총량의 재진술인 경우 - "30m 30롤 3팩, 30개입, 3개"', () => {
  const q = parseQuantity('깨끗한나라 순수프리미엄 30m 30롤 3팩, 30개입, 3개');
  assert.strictEqual(q.unit, 'm');
  // 30롤*3팩=90 과 30개입/3개(콤마로 나뉜 재진술 스팬)가 같은 정보 -> 상세한 스팬(90) 채택, 이중곱 방지
  approxEqual(q.totalValue, 2700); // 30m * 90
});

let pass = 0, fail = 0;
for (const c of cases) {
  try {
    c.fn();
    console.log(`✅ ${c.name}`);
    pass++;
  } catch (e) {
    console.error(`❌ ${c.name}`);
    console.error(`   ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed (total ${cases.length})`);
process.exit(fail > 0 ? 1 : 0);
