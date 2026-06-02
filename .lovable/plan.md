# 기록입력 중복 체크/방지 기능 강화

## 범위
- 기록입력 화면(`src/pages/Records.tsx`)의 단건 입력 폼, "모두 저장"(다행 그리드), 엑셀 붙여넣기 다이얼로그 모두 대상
- `src/lib/duplicateCheck.ts` 보강 (필드 추가: 배송지/2일배송)
- DB: `deliveries.dedupe_key` 컬럼 + 유니크 인덱스 추가, 기존 데이터 백필
- 기존 정산/검산/팀장정산 로직, 재방문/공제 기준은 변경하지 않음

## 1. 중복 키 정의 (정정 사항)
사용자 요구의 "배송지"는 현재 스키마에 없습니다. `deliveries` 테이블 기준 가장 가까운 필드는 `region`(또는 `region_type`)이며, "2일배송"은 `two_person`이 아닌 별도 필드가 없으므로 `two_person`을 그대로 사용합니다. (실제 컬럼 매핑)

- 완전 중복 키: `date`, `company_id`, `customer_name`, `region`, `item`, `leader1_id`, `leader2_id`, `metro_fee`, `note_amount`, `regional_fee`, `cod_amount`, `two_person`, `split_type`, `paid`
- 유사 중복 키: `date`, `company_id`, `customer_name`, `region`, `item`

`duplicateCheck.ts`에 `region`, `two_person` 비교 추가. (현재 `note` 필드 비교는 완전 중복 기준에서 제거 — 사용자 요구에 비고는 빠져 있음)

## 2. DB 변경
새 마이그레이션:
- `deliveries.dedupe_key text` 추가
- 트리거: insert/update 시 `dedupe_key`를 정규화 문자열로 자동 생성
  - 형식: `date|company_id|lower(trim(customer_name))|lower(trim(region))|lower(trim(item))|leader1_id|leader2_id|metro_fee|note_amount|regional_fee|cod_amount|two_person|coalesce(split_type,'')|paid`
- 기존 데이터 백필 (트리거가 update에서 동작하도록 `UPDATE deliveries SET dedupe_key = NULL`)
- `CREATE UNIQUE INDEX deliveries_user_dedupe_key_uidx ON deliveries (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`
- 만약 기존에 이미 중복 row가 있으면 인덱스 생성이 실패하므로, 사전 진단 SELECT 결과 안내 후 user_id별 중복은 가장 오래된 row만 유지하고 dedupe_key를 비워두는 방식 (안전을 위해 삭제는 하지 않음, 대신 dedupe_key NULL → unique 검사 제외)

## 3. UI 변경 (`Records.tsx`)

### 단건 입력 폼 상단
- "오류 검사" 버튼 옆에 **[중복 체크]** 버튼 추가
- 결과 요약 박스 (폼 상단):
  - 빨간 박스: "이미 동일한 기록이 등록되어 있습니다 · 완전 중복 N건" + 매치 ID/날짜/업체/고객 표시
  - 노란 박스: "유사한 기록이 존재합니다. 저장 전 확인하세요 · 유사 중복 N건"
  - 초록 박스: "중복 없음"
- 저장 버튼 동작:
  - 완전 중복이 있으면 **저장 차단** (toast: "완전 중복이 있어 저장할 수 없습니다")
  - 유사 중복은 기존 confirm 다이얼로그 유지하되 한글 메시지 강화
- 저장 중 `saving=true`로 버튼 disable (이미 구현됨, 유지)
- 수정 모드: `form.id`가 있으면 update (현재 로직 유지), 자기 자신은 중복 비교 제외 (이미 `sameId`로 구현됨)

### 엑셀 붙여넣기 다이얼로그
- 저장 직전 요약 박스 추가:
  - "총 N건 · 신규 저장 N건 · 완전 중복 제외 N건 · 유사 중복 경고 N건"
- 완전 중복 행은 자동으로 제외하고 저장, 유사 중복은 confirm 후 진행
- DB unique 제약 위반 시 한국어 에러 toast: "동일 내용이 이미 등록되어 있어 일부 건이 저장되지 않았습니다"

### "모두 저장" (그리드)
- 동일하게 요약 박스 + 완전 중복 제외 로직 적용

## 4. 헬퍼 추가
- `duplicateCheck.ts`에 `summarizeBulk(candidates, existing)` 추가 → `{total, newCount, exactDupCount, suspectCount, newRows, exactDupRows}` 반환
- 모든 저장 경로에서 이 함수를 호출하도록 통일

## 5. 백필/진단
- 마이그레이션 안에 백필 포함
- 별도 안내: 진단용 SELECT는 마이그레이션 실행 후 안내 (사용자가 직접 확인 가능)

## 변경 파일
- `src/lib/duplicateCheck.ts` (+region/two_person, +summarizeBulk)
- `src/lib/duplicateCheck.test.ts` (테스트 보강)
- `src/pages/Records.tsx` (단건/엑셀/모두저장 UI 박스 + 차단 로직)
- 신규 마이그레이션 (dedupe_key 컬럼·트리거·인덱스·백필)

## 변경하지 않는 것
- 정산/검산/재방문/공제 계산
- 다른 페이지(CompanySettlement, LeaderSettlement, Verify 등)
- `note` 필드 (요구사항에서 빠짐 — 비고가 달라도 같은 배송이면 중복으로 판정)

## 확인 필요
1. **"배송지" 필드 매핑**: `region`(서울/지방 등 분류)으로 매핑할까요, 아니면 따로 컬럼 추가가 필요한가요? (현재는 `region` 사용 가정)
2. **"2일배송"**: `two_person`(2인배송) 필드를 의미한 것 맞나요?
3. **기존 중복 데이터 처리**: 마이그레이션 실행 시 이미 같은 키의 row가 여러 개 있으면 인덱스 생성이 실패합니다. 가장 오래된 row만 dedupe_key를 채우고 나머지는 NULL로 두는 방식(데이터 보존)으로 진행해도 될까요?
