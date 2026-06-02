## 재방문 (다른 날짜 두 번 방문) 기능

### 요약
- 같은 배송을 다른 날짜에 2번 방문한 경우 → 1차/2차 행을 각각 입력
- **팀장 정산**: 각 행의 팀장이 본인 입력 금액 그대로 받음 (기존 분배 규칙 그대로)
- **업체 청구**: 두 행을 1건으로 합산하여 청구 (날짜 = 1차 방문일)
- 입력 시 1차 행에 "재방문 필요" 체크하면 바로 아래에 2차 방문 행이 자동 복제 생성

### 식별 방법
- DB에 `revisit_group_id` (uuid)로 묶음
- `revisit_visit_no` (1 또는 2)로 차수 구분
- `revisit_required`, `revisit_done` 체크 상태 저장

### 변경 사항

**1. DB 마이그레이션** (`deliveries` 테이블)
- `revisit_group_id uuid` (nullable) — 같은 묶음 식별
- `revisit_visit_no int default 1` — 1차/2차
- `revisit_required boolean default false` — 1차 행에 표시
- `revisit_done boolean default false` — 2차가 실제로 진행됐는지

**2. `src/lib/statementData.ts`** (업체 청구만)
- 회사별 rows 집계 후 `revisit_group_id`로 그룹핑
- 그룹 → 1행으로 합산: metro/regional/note/cod 모두 합, 날짜 = min(date), 팀장칸 = 1차 행 기준
- 팀장 정산 경로(`buildLeaderStatements`, `allocateRow`)는 **변경 없음** — 행별 그대로

**3. `src/pages/Records.tsx`** (입력 폼)
- 단일 입력 폼에 "재방문 필요" / "재방문 진행" 체크박스 추가
- 저장 시 "재방문 필요" 체크되어 있고 아직 그룹이 없으면 → 원본 저장 후 같은 데이터를 한 번 더 복제 저장 (`revisit_group_id` 공유, visit_no=2, revisit_done=false)
- 수정 모드에서는 두 행 모두 독립적으로 수정 가능 (날짜/팀장/금액 변경 OK)
- 배송내역 상세 표시: 2차 행은 작은 "재방문" 배지로 구분

**4. `src/lib/statementData.test.ts`** 테스트 추가
- 1차 5만/2차 3만 → 업체 청구 1행 8만, 팀장은 각자 본인 금액
- 다른 팀장이 2차에 들어간 케이스 검증

### 영향 없는 부분
- `splitAllocation.ts` 분배 규칙 (강형주/신동석, 오은규→오동선 등 모두 그대로)
- 팀장 정산 화면
- 한눈요약 집계 (개별 행 기반 그대로)

### 미확정/디폴트 결정
- 1차 입력 시 자동 복제되는 2차 행의 초기 날짜는 1차와 동일하게 둠 (사용자가 실제 2차 방문일로 수정)
- 업체 청구서 표시 팀장은 1차 행의 팀장 (2차는 비고에 자동 표기하지 않음 — 너무 길어질 우려)
