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
