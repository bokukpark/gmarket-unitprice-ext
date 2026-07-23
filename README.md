# 지마켓 단위가격 비교 확장 프로그램 (v0.1.0, WIP)

## 현재 상태
- ✅ 핵심 파싱 로직(`src/parser/unitParser.js`) 구현 및 테스트 통과 (16/16)
- ✅ manifest.json, content script, CSS 뼈대 구성
- ⚠️ **지마켓 상품 카드 DOM 셀렉터 미확정** — 지마켓이 Cloudflare 봇 차단을 걸어둬서
  자동화 도구로 실제 검색 결과 페이지를 가져오지 못했습니다. 아래 "셀렉터 확정 방법" 참고.

## 구조
```
manifest.json
src/
  parser/unitParser.js     # 텍스트 -> 단위/수량 파싱, 단위가격 계산 (Node/브라우저 겸용)
  content/gmarketSearch.js # 지마켓 검색 결과 페이지에 배지 삽입 (content script)
  styles/badge.css         # 배지 스타일
tests/
  unitParser.test.js       # 파서 유닛 테스트 (node tests/unitParser.test.js 로 실행)
```

## 파서가 지원하는 표기
- `500ml`, `1.5L`, `1kg`, `210g` 등 단일 용량/무게
- `500ml x 20개`, `355ml 24캔`, `2L 6개입`, `210g x 12개` 등 용량 x 개수 조합
- `100매 x 3팩`, `12자루` 등 개수만 있는 상품(권/자루/매/입 등)
- 계산 결과는 100ml당, 100g당, 개당 가격으로 정규화됨

테스트 실행:
```
node tests/unitParser.test.js
```

## 셀렉터 확정 방법 (zero 님 액션 필요)
지마켓에서 "펩시 제로콜라" 검색 후, 상품 카드 하나에서:
1. 우클릭 → 검사(Inspect)
2. 개발자도구에서 상품 카드 전체를 감싸는 엘리먼트(리스트의 반복 단위) 선택
3. 해당 엘리먼트 우클릭 → Copy → Copy outerHTML
4. 그 HTML 텍스트를 공유해주시면 `src/content/gmarketSearch.js`의
   `SELECTORS.cardCandidates / nameCandidates / priceCandidates` 를 정확한 값으로 교체하겠습니다.

## 크롬에 로드해서 테스트하는 방법
1. `chrome://extensions` 접속
2. 우측 상단 "개발자 모드" 켜기
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 이 프로젝트 폴더(`gmarket-unitprice-ext`) 선택
5. 지마켓에서 "펩시 제로콜라" 등 검색 → 콘솔(F12)에서 에러 확인
   - 카드가 안 잡히면 `SELECTORS` 후보가 실제 DOM과 안 맞는 것 → 위 "셀렉터 확정 방법"으로 진행

## 다음 단계 (TODO)
- [ ] 실제 DOM 기반 셀렉터 확정
- [ ] 옵션(용량 선택 드롭다운 등)이 있는 상품의 처리 방식 결정
- [ ] 정렬 UI(예: "단위가격순 정렬" 토글 버튼) 추가
- [ ] 배지 위치/디자인이 지마켓 실제 카드 레이아웃과 겹치지 않는지 확인
- [ ] (추후) 여러 사이트 간 비교 확장 시 파서를 사이트 독립적으로 유지하도록 인터페이스 정리
