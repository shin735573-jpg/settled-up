## 작업 범위 요약

기존 정산 계산 코어(`statementData.ts`의 배분/공제/VAT/재방문 로직)는 절대 변경하지 않고, 그 **입력 단계에서 누락분 override 기간을 적용**하는 얇은 어댑터 레이어를 추가합니다. UI는 현 스타일과 정렬을 유지합니다.

---

## 1. 누락분 정산 반영월 (핵심)

### 데이터 저장 방식
- `deliveries` 스키마는 변경하지 않음. 기존 `missing_reason` 컬럼에 **구조화 prefix**로 저장:
  ```
  [SETTLE:2026-05:H1] 실제 사유 텍스트
  ```
  - 구간 코드: `H1` (1~15일) · `H2` (16~말일) · `FULL` (월전체)
- 신규 헬퍼 `src/lib/missingOverride.ts`:
  - `parseMissingReason(raw) → { settleMonth, half, reason }`
  - `buildMissingReason({ settleMonth, half, reason }) → string`
  - `getEffectiveSettleDate(delivery)` → override 있으면 가상의 정산 날짜(예: `2026-05-01` 또는 `2026-05-16`) 반환, 없으면 `delivery.date`
  - `isDeliveryInPeriod(delivery, period)` → 모든 화면이 공통으로 쓰는 단일 진실 함수

### 정산 코어 변경 금지 — 어댑터 패턴
- `statementData.ts`의 모든 build 함수는 호출자가 **이미 기간 필터된 deliveries 배열**을 넘기는 구조 활용
- 각 화면(업체정산/팀장정산/한눈요약/Verify)에서 deliveries fetch 후 `isDeliveryInPeriod(d, period)`로 필터 → 그 결과를 기존 build 함수에 그대로 전달
- 효과: 일반 건은 `date`, 누락분 override 건은 지정 월/반기로 정산 포함. 원래 배송일 달에서는 자동 제외.

### 영향 화면
- `CompanySettlement.tsx`, `LeaderSettlement.tsx`, `Summary.tsx`, `Verify.tsx` — deliveries 필터링 부분만 `isDeliveryInPeriod`로 교체

### 기록입력 UI (`Records.tsx`)
- 누락분 체크 시 추가 필드:
  - 누락 사유 (text)
  - 정산 반영월 (`<input type="month">` YYYY-MM)
  - 반영 구간 (Select: 1~15일 / 16~말일 / 월전체)
- 안내: "배송일은 유지되고, 정산에는 선택한 월/구간으로 포함됩니다."
- 누락분 체크 시 정산 반영월 필수 검증
- 저장 시 `buildMissingReason()`으로 직렬화, 불러올 때 `parseMissingReason()`으로 복원
- 기존 grid 정렬·라벨·높이 유지

### 이월착불(carry) 보정
- carry 계산 위치를 찾아(`LeaderSettlement` / `CompanySettlement`의 미결제 누적 부분) override 있는 건은 원래 배송일 기준 carry에서 제외, 지정 정산월 기준으로만 카운트

---

## 2. 기록입력 중복 검수
- 신규 `src/lib/duplicateCheck.ts`:
  - `findExactDuplicates(candidate, existing)` — 날짜/업체/고객/품목/배송합계/착불/팀장1/팀장2/분할/결제여부/비고
  - `findSuspectDuplicates(candidate, existing)` — 날짜/업체/고객/품목/배송합계
- `Records.tsx` 단건 저장 + 엑셀 붙여넣기 저장 직전 confirm dialog:
  ```
  정확 중복 N건 / 의심 중복 M건
  - [기존ID] 2026-05-12 업체명 고객명 …
  계속 저장하시겠습니까?
  ```
- 테스트: `duplicateCheck.test.ts`

---

## 3. 금액 검수 경고 (recordValidation + verifyChecks)
신규 코드:
- `ZERO_ALL`: 배송비·착불 모두 0
- `COD_ONLY`: 배송비 0인데 착불 > 0
- `COD_GT_FEE`: 착불 > 배송비 합
- `PAID_BUT_COD`: paid=true인데 cod_amount > 0
기존 `recordValidation.ts`와 `verifyChecks.ts` 양쪽에 같은 규칙 추가. 기존 ZERO_FEE 정책(0원 정상)은 유지하되 위 4개는 별도 코드로.

---

## 4. 기록입력 첫 사용 안내
`Records.tsx` 상단에 회사 0 또는 팀장 0일 때 Alert 카드 + "설정으로 이동" 버튼 (`/settings`)

---

## 5. 로그인 화면 정리 (`Auth.tsx`)
- 기본값 자동 입력 제거 → `useState("")`
- placeholder 추가
- 빈 값으로 submit 시 `toast.error("이메일과 비밀번호를 입력해 주세요")`
- 이미 빈 상태로 보이지만 코드 확인 후 정리

---

## 6. Verify 중복 경고 그룹당 1건
`verifyChecks.ts`의 DUPLICATE issue를 그룹당 첫 1건만 push하도록 변경 (대신 메시지에 "외 N건" 표기)

---

## 7. 기록입력 정렬 유지
누락분 추가 필드는 기존 grid row 아래 확장 영역으로 conditional render — 기존 셀 width/높이 영향 없음

---

## 테스트
- `missingOverride.test.ts` — parse/build round-trip, getEffectiveSettleDate, isDeliveryInPeriod (override vs date)
- `duplicateCheck.test.ts` — exact/suspect 분리
- `verifyChecks.test.ts` 보강 — 신규 4개 경고 코드, DUPLICATE 그룹화
- 기존 테스트 전부 통과 유지

---

## 변경 금지
- `statementData.ts` 계산 로직 / 재방문·공제·VAT 기준
- DB 스키마 (`deliveries.missing_reason` 컬럼 사용만)
- 업체정산/팀장정산/본사정산 금액 계산식

## 새 파일
- `src/lib/missingOverride.ts` + test
- `src/lib/duplicateCheck.ts` + test

## 수정 파일
- `Records.tsx` (UI, 저장 hook), `Auth.tsx`, `CompanySettlement.tsx`, `LeaderSettlement.tsx`, `Summary.tsx`, `Verify.tsx`, `verifyChecks.ts`, `recordValidation.ts`

진행해도 될까요?
