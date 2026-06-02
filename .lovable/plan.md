
# 배송내역 비교·통합 워크플로우 (RecordsBrowse 전면 개편)

기존 기록입력(/records)·정산·검산·재방문 로직은 절대 변경하지 않습니다. 이 작업은 **분류/태깅/그룹 정리**만 수행하며, 정산 계산식·재방문 기준·공제 기준은 그대로 둡니다.

## 1. DB 변경 (migration 1건)

```text
ALTER TABLE deliveries
  ADD COLUMN companion boolean NOT NULL DEFAULT false,
  ADD COLUMN companion_reason text;
```

- 기존 dedupe_key 트리거에 `companion` 포함하도록 `compute_delivery_dedupe_key` 갱신
- 기존 unique index는 그대로 활용 (dedupe_key 재계산만 트리거)

## 2. 새 헬퍼 라이브러리 (`src/lib/recordGrouping.ts` + 테스트)

순수 함수만, 정산 로직 import 금지.

- `groupByLooseKey(rows)` — `날짜|고객|배송지|품목` 기준 그룹화 (2건 이상만)
- `classifyGroupRow(row, group)` — 각 행에 상태 라벨 부여:
  - `normal` / `exact_duplicate` / `suspect_duplicate` / `leader2_missing` / `two_person_mismatch` / `companion_needed`
- `recommendAction(group)` — `merge_companion` / `merge_two_person` / `keep_separate` / `dedupe` 중 1개 추천
- `validateMergePlan(plan)` — 저장 전 최종 검증 (2인배송인데 팀장2 없음, 반반인데 팀장2 없음 등)

## 3. 화면: `/records-browse` 전면 개편 (`src/pages/RecordsBrowse.tsx`)

기존 6슬롯 비교 UI는 제거하고 좌우 2패널로 교체.

```text
┌─ 상단 툴바 ──────────────────────────────────────────────┐
│ [월선택] [검색] [필터: 상태/유형] [중복체크] [일괄작업 ▾] │
└──────────────────────────────────────────────────────────┘
┌──── 좌측 패널 ────────┐ ┌──── 우측 패널 ───────────────┐
│ 그룹/단건 리스트       │ │ 선택 그룹의 행들을 가로 비교   │
│ ☐ 2025-05-12 홍길동   │ │ ┌──────┬──────┬──────┐       │
│   강남 · 식탁 [3건]   │ │ │ 행1  │ 행2  │ 행3  │       │
│   상태: 유사중복       │ │ │ 팀장1 강조 │ ...  │ ...  │       │
│ ☐ ...                │ │ └──────┴──────┴──────┘       │
│                      │ │ 문제 요약: 팀장2 누락 1건     │
│                      │ │ 추천: 동행 통합               │
│                      │ │ [동행통합][2인배송통합]       │
│                      │ │ [별도유지][직접수정]          │
└──────────────────────┘ └──────────────────────────────┘
```

좌측 리스트:
- 그룹화된 묶음(2건+) 우선 + 단건은 접힘
- 다중 체크박스, 상태 배지(색상 구분)

우측 패널:
- 가로 스크롤 비교 테이블 — 날짜/고객/배송지/품목/팀장1/팀장2/2인배송/동행/분할/수도권/지방/비고금액/착불/총액/상태
- 행 간 값이 다른 셀은 노란 배경, 누락값은 빨간 배경
- 액션 버튼: 동행통합 / 2인배송통합 / 별도유지 / 직접수정

## 4. 액션 동작 (모두 UPDATE만)

| 액션 | UPDATE 내용 |
|---|---|
| 동행 통합 | `companion=true`, `companion_reason`=입력값, `two_person=false` |
| 2인배송 통합 | `two_person=true`, `leader2_id` 필수 채움 |
| 별도 유지 | 변경 없음 (그룹에서만 제외 표시) |
| 직접 수정 | 사용자가 폼에서 수정한 값만 UPDATE |
| 중복 제거 | exact dup 중 하나 삭제(기록 입력 화면에서 했던 동일 confirm) |

INSERT 경로 없음. 모든 변경은 `supabase.from("deliveries").update().eq("id", id)`.

## 5. 일괄 처리 (상단 [일괄작업 ▾])

선택된 그룹 전체에 대해:
- 동행 통합 / 2인배송 통합 / 별도 유지 / 팀장2 일괄지정 / 분할 일괄지정

**적용 전 미리보기 모달** 표시 (대상 그룹 수, 변경 필드 요약).

## 6. 저장 전 최종 검토 모달

[수정 적용] 클릭 시:
- 동행 통합 N건 / 2인배송 통합 N건 / 별도 유지 N건 / 팀장2 추가 N건
- 충돌/오류 목록 (validateMergePlan 결과)
- [다시 검토] / [수정 적용] / [취소]

저장 차단 조건:
- 2인배송=true 인데 leader2_id 비어있음
- split_type='반반' 인데 leader2_id 비어있음
- 그룹 내 exact duplicate 남아 있음

## 7. 변경하지 않는 것

- `/records` (기록입력) 화면, 단건 저장/엑셀 붙여넣기 중복 로직
- `Verify`, `LeaderSettlement`, `CompanySettlement`, `Summary` 등 모든 정산 화면
- 재방문/공제/누락분 override 로직
- 기존 dedupe_key unique index 자체 (트리거 함수만 companion 포함하도록 갱신)

## 변경 파일

- `supabase/migrations/...` (companion 컬럼 + dedupe 함수 갱신) — migration
- `src/lib/recordGrouping.ts` (신규) + `recordGrouping.test.ts`
- `src/pages/RecordsBrowse.tsx` (전면 재작성)
- `src/integrations/supabase/types.ts` 는 마이그레이션 후 자동 갱신
