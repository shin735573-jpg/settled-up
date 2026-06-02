# 기록입력 2패널 개편 + 중복의심 비교/통합 패널

## 1. 화면 구조 변경 (`src/pages/Records.tsx`)

기존 단일 입력 폼 화면을 **좌측 목록 / 우측 상세** 2패널로 개편.

```text
┌────────────────────────┬──────────────────────────────────────┐
│ 좌: 배송내역 목록      │ 우: 배송내역상세 (선택 1건 기준)     │
│ - 월/검색/상태필터     │ ─ 기본 정보(편집 가능)               │
│ - 체크박스 다중선택    │ ─ [중복 의심 검색] 버튼              │
│ - 행 클릭 → 우측 선택  │ ─ 탭: 완전일치 | 유사건 | 비고유사   │
│ - 일괄 액션바          │ ─ 비교 테이블(현재행 vs 의심행 N개)  │
│ - + 새 기록 입력       │ ─ 통합/동행/2인배송/금액 처리        │
│                        │ ─ [저장 전 최종 확인] 모달           │
└────────────────────────┴──────────────────────────────────────┘
```

- 기존 입력 폼/엑셀 붙여넣기/팀장 자동완성/가격표 자동채움 로직은 **모두 유지**. 폼은 "+ 새 기록" 모드에서 우측 패널에 표시.
- 행을 클릭하면 우측이 "수정 + 중복의심" 모드로 전환.
- 모바일은 좌/우를 탭으로 전환(기존 반응형 컨벤션 유지).

## 2. 중복의심 검색 로직 (`src/lib/duplicateCheck.ts` 확장)

선택된 1건을 기준 행으로 받아 같은 user_id의 deliveries에서 후보를 찾는 함수 추가:

- `findDuplicateSuspects(baseRow, allRows)` → `{ exact: Row[], similar: Row[], noteSimilar: Row[] }`
  - **exact**: 기존 `dedupe_key` 동일
  - **similar**: 날짜+업체+고객명+배송지+품목 동일하지만 팀장/2인/동행/분할/금액 중 1개 이상 다름
  - **noteSimilar**: 날짜+고객명+배송지가 같고 비고내용이 부분 유사(정규화 후 토큰 50% 이상 겹침 또는 한쪽이 다른쪽 substring)
  - 품목이 다른 경우는 `similar`에서 제외하고 **참고건(reference)** 으로 별도 표시(낮은 우선순위).
- `classifySuspect(base, suspect)` → 상태 라벨 반환:
  `정상 | 완전중복 | 유사중복 | 비고유사 | 팀장누락의심 | 동행통합후보 | 2인배송통합후보 | 2인배송불일치 | 동행확인필요 | 정산불일치`
- `recommendAction(base, suspect)` → `merge_companion | merge_two_person | keep_separate | dedupe | none`
  - 날짜/고객/배송지/품목 동일 + 팀장만 다름 → `merge_two_person` 또는 `merge_companion`
  - `split_type='반반'` → `merge_two_person`
  - 비고까지 거의 같음 → 강한 중복 후보

기존 `recordGrouping.ts`의 그룹핑 함수는 그대로 두고 재사용.

## 3. 우측 패널 컴포넌트 (`src/components/records/RecordDetailPanel.tsx` 신규)

선택 행 1건 기준 단일 컴포넌트. 내부 상태:

- `mergeMode`: `none | companion | two_person | keep_separate`
- `amountMode`: `sum | manual` (통합 시 묻는 질문 결과)
- `manualTotal`: 직접입력 금액
- `splitRecommend`: 팀장2 존재 시 기본 `반반`

UI 섹션:

1. **기본 정보 폼** — 날짜/업체/고객/배송지/품목/비고/팀장1/팀장2/동행/2인배송/분할/금액 (모두 수정 가능)
2. **[중복 의심 검색]** 버튼 → 탭 3개(완전일치/유사건/비고유사) + 참고건 섹션
3. **비교 테이블** — 좌 첫 컬럼 = 현재 행, 우 각 컬럼 = 의심 행. 다른 값은 노란 배경, 누락 필수값은 빨간 배경, 상태 배지 표시
4. **통합 액션 카드** — 의심 행 하나 또는 여러 개 체크 후:
   - 라디오: 통합 안 함 / 동행 통합 / 2인배송 통합 / 별도 유지
   - 통합 선택 시 모달: **"각 팀장들 금액을 합산할까요?"** [합산][직접입력]
     - 합산 → metro_fee/regional_fee/note_amount/cod_amount 자동 합산해서 표시
     - 직접입력 → 청구금액 입력 필드 활성화
   - 2인배송 통합 시 `split_type` 기본 `반반`, `two_person=true`, `leader2_id` 필수
   - 동행 통합 시 `companion=true`, `two_person=false`, `companion_reason` 입력
5. **저장 전 최종 확인 모달** — 검토 항목/충돌 목록/버튼(다시수정/적용저장/취소)

## 4. 일괄 액션 (좌측 목록)

체크된 행에 대해 액션바 노출:
- 동행 통합 / 2인배송 통합 / 별도 유지 / 팀장2 일괄지정 / 동행여부 일괄지정 / 분할방식 일괄지정 / 청구금액 처리방식 일괄지정
- 모든 액션은 update 큐에 적재 → 저장 전 최종 확인 모달 → `supabase.from('deliveries').update().eq('id',...)` 일괄 실행
- 저장 버튼 disabled 처리, `isSaving` 상태로 더블클릭 방지

## 5. 검증 (`validateMergePlan` 확장)

저장 전 차단:
- 2인배송=true & leader2_id 없음
- split_type='반반' & leader2_id 없음
- 통합여부=동행/2인배송인데 amountMode 미선택
- amountMode=manual & manualTotal 비어있음
- 동일 그룹 내 exact 중복 잔존
- 2인 배송인데 반반 합계 불일치(자동합산 결과 ≠ manualTotal)

경고만(저장 허용): 팀장누락 의심, 동행 확인 필요, 비고 유사 강한 후보 등.

## 6. DB / dedupe_key

현재 `deliveries.dedupe_key`와 `compute_delivery_dedupe_key`는 이미 존재하지만 **비고(note)가 빠져 있음**. 요구사항대로 비고를 포함하는 새 마이그레이션 추가:

- `compute_delivery_dedupe_key` 함수에 `lower(btrim(coalesce(d.note,'')))` 추가
- `set_delivery_dedupe_key` 트리거 변경검사에 `note` 추가
- 기존 행 dedupe_key 백필(`UPDATE deliveries SET dedupe_key = compute_delivery_dedupe_key(deliveries.*)`)
- unique index는 이미 존재 → 충돌 가능성 점검(중복 행 진단 SELECT 결과를 사용자에게 보고)
- Postgres 23505 → 한국어 메시지 매핑은 기존 `mapDuplicateError` 재사용

## 7. 변경하지 않는 것

- 정산 페이지(Verify/LeaderSettlement/CompanySettlement/Summary) 로직
- 재방문/누락/조정/가상팀장 로직
- 엑셀 붙여넣기 자체의 파싱(중복검사는 기존 유지)
- `/records-browse`(직전에 만든 2패널 통합 화면)는 그대로 유지 — 관리자용 워크플로우로 공존

## 파일 변경 요약

- 신규 `src/components/records/RecordDetailPanel.tsx`
- 신규 `src/components/records/SuspectCompareTable.tsx`
- 신규 `src/components/records/MergeAmountDialog.tsx`
- 신규 `src/components/records/FinalReviewDialog.tsx`
- 수정 `src/pages/Records.tsx` — 2패널 레이아웃 도입, 기존 폼/엑셀/저장 로직은 우측 패널로 이동
- 수정 `src/lib/duplicateCheck.ts` — `findDuplicateSuspects`, `classifySuspect`, `recommendAction` 추가 + 테스트
- 신규 마이그레이션 — `compute_delivery_dedupe_key`에 note 포함 + 백필
