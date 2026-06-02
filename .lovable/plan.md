# 재방문 정산 정리

## 동작 정의
- **업체 청구**: 재방문 그룹은 1차 행의 배송비(수도권/비고/지방)만 그대로 청구. 2차 행은 업체 청구서에 미반영. (현재 동작 유지)
- **팀장 정산**: 재방문 그룹 전체에 분배되는 총액 = **1차 행의 금액**.
  - 분배는 "재방문 완료 처리" 시 **팀장별 금액을 수기 입력**한 값으로 정산.
  - 수기 분배가 입력되지 않은 그룹은 **1차 행의 팀장1에게 전액 귀속**.
  - 2차 행에 별도 입력된 금액/팀장은 정산에 사용하지 않음(메모 보존만).
- **착불(COD)**: 1차 행의 cod_amount만 정산/청구에 반영(중복 방지).

## 데이터
`deliveries` 테이블에 컬럼 추가:
- `revisit_manual_shares jsonb` — 1차 행에만 저장. 예:
  ```json
  [{"leader_id":"...","leader_name":"홍길동","amount":40000},
   {"leader_id":"...","leader_name":"김철수","amount":20000}]
  ```
- `revisit_distributed boolean default false` — 수기 분배 완료 여부.

## UI
1. **재방문 분배 입력 다이얼로그** (신규 컴포넌트)
   - 헤더: 1차 날짜·고객·지역·1차 총액 표시
   - 본문: 팀장 추가 행(LeaderCombobox + 금액 입력). 그룹 내 등장 팀장(1차+2차) 자동 프리필.
   - 합계 / 1차 총액 대비 차액 실시간 표시(차액 0이 아니어도 저장 가능, 경고만)
   - 저장 시 1차 행 update: `revisit_manual_shares`, `revisit_distributed=true`, 2차 행 `revisit_done=true` 자동.

2. **진입점 2곳**
   - `Records.tsx` 단일폼 "재방문 진행" 토글 옆에 "분배 입력" 버튼 (revisit_group_id 있을 때만)
   - `RecordsBrowse.tsx` 재방문 배지 옆에 작은 "분배" 버튼

## 정산 로직 변경 (`src/lib/statementData.ts`)
`buildLeaderStatements`에서:
- 입력 deliveries를 `revisit_group_id`로 그룹화.
- 재방문 그룹은 개별 행 `allocateRow` 호출에서 제외하고, **그룹 합성 행 1건**으로 다음과 같이 처리:
  - 금액 베이스 = 1차 행의 metro/note/regional/cod
  - 수기 분배가 있으면: 각 leader_id에 대해 `LeaderShare` 생성(1차 region_type 기준 metro 또는 regional에 amount 배치, note_amount/cod=0, 마지막 한 명에게 잔액 보정). cod는 1차 팀장1에게 별도 share로 귀속.
  - 수기 분배가 없으면: 1차 행 그대로 `allocateRow`처럼 처리하되 leader1만 전액 (실질적으로 기존 single-leader 결과와 동일).
- 비재방문 행은 기존 경로 유지.

## 마이그레이션 / 타입
- 신규 SQL 마이그레이션: `ALTER TABLE deliveries ADD COLUMN revisit_manual_shares jsonb, ADD COLUMN revisit_distributed boolean NOT NULL DEFAULT false;`
- types.ts는 자동 갱신.

## 영향 파일
- `supabase/migrations/<new>.sql`
- `src/lib/statementData.ts` (`buildLeaderStatements` 수정, 타입에 두 컬럼 추가)
- `src/pages/Records.tsx` (분배 다이얼로그, 진입 버튼, payload 매핑)
- `src/pages/RecordsBrowse.tsx` (분배 버튼)
- 신규 `src/components/RevisitShareDialog.tsx`
- 테스트: `src/lib/statementData.test.ts`에 재방문 시 수기 분배/미입력 케이스 추가

## 제외
- 한눈요약/HQ 화면 로직 변경 없음(`buildLeaderStatements` 결과를 그대로 사용하므로 자동 반영).
- 업체 청구 로직은 현재 동작 그대로 유지(변경 없음, 주석만 보강).
