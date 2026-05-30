# 팀장정산 화면 및 팀장명 인식 규칙 개선

## 1. DB 스키마 변경 (마이그레이션)

`team_leaders` 테이블에 컬럼 추가:
- `aliases text[] default '{}'` — 별칭 목록 (예: 강형주의 ["형주"])
- `display_suffix text` — 동명이인 구분 (예: "2", "3" 또는 직접 입력)

별칭 중복 방지용 부분 유니크 인덱스:
```sql
CREATE UNIQUE INDEX team_leaders_alias_unique
  ON team_leaders (user_id, lower(unnest))
  -- 실제로는 trigger로 별칭 중복 검사
```
(Postgres 한계상 trigger 기반 검증 함수 사용)

## 2. 이름 정규화 라이브러리 (`src/lib/leaderResolver.ts`)

순수 함수:
- `resolveLeaderName(input: string, leaders: Leader[]): Leader | null`
  - 정식 이름 → 매칭
  - 별칭(aliases) → 매칭
  - 공백/대소문자 무시
- `getDisplayName(leader: Leader): string`
  - `name + (display_suffix ? display_suffix : "")`
- `detectDuplicates(leaders: Leader[]): Map<name, count>`

기존 `companyMatch.ts` 패턴과 동일한 테스트 파일 추가
(`leaderResolver.test.ts`).

## 3. 적용 지점

`resolveLeaderName`을 다음 위치에 모두 적용:
- 엑셀 붙여넣기 파서 (Records 화면)
- 수기입력 leader1/leader2/leader3 필드
- 제목에서 팀장명 자동 추출 로직
- `recordValidation.ts`의 팀장 등록 검사

저장 시 `leader_name`은 항상 정식 이름(`leaders.name`)으로 정규화하여 기록.

## 4. 오은규 → 오동선 합산 표시 (팀장정산 화면)

`team_leaders.settle_to_id`가 이미 존재 → 활용.

팀장정산 상세에서 `leader1_id`가 자기 자신 외에 `settle_to_id = 본인` 인 팀장 건도 합산.

표시:
- 행 배경: `bg-amber-50` (연주황)
- 정산처리 컬럼: `오은규 → 오동선`
- 요약 카드에 별도 섹션:
  - "오은규 정산합산 포함" 뱃지 (연노랑)
  - 합산 건수 / 합산 금액

색상은 `index.css`에 semantic token 추가:
```css
--settle-merged-bg: 45 100% 95%;
--settle-merged-fg: 30 80% 30%;
```

## 5. 팀장관리 UI (Settings)

각 팀장 row에 추가 입력:
- 별칭 (쉼표 구분 입력 or 칩 형태 추가/삭제)
- 구분명 (display_suffix, 동명이인 시)

저장 시 검증:
- 별칭 중복 → 토스트 경고 + 저장 차단
- 동명이인 자동 감지 → 안내 메시지 (suffix 미입력 시 자동 "2","3" 제안)

## 6. 기존 데이터 마이그레이션

별도 SQL 마이그레이션 (idempotent):
- 강형주 team_leader에 aliases=['형주'] 자동 추가 (존재하면)
- 기존 deliveries 중 `leader1_name='형주'` → 강형주 ID로 업데이트, leader1_name='강형주'
- 동일 처리: leader2_name, leader3_name

(사용자 데이터별 처리는 trigger 없이 일회성 UPDATE.)

## 7. 집계 정합성

모든 집계는 `leader_id` 기준 group by (이미 그렇게 되어 있음). 표시명만 `getDisplayName()` 사용. 한눈요약/본사정산도 동일.

## 작업 순서

1. 마이그레이션: aliases, display_suffix 컬럼 + 기존 데이터 정리
2. `leaderResolver.ts` + 테스트
3. Records 화면 입력/붙여넣기에 resolver 적용
4. Settings 팀장관리 UI (별칭, 구분명)
5. 팀장정산 화면: 오은규 합산 표시 + 색상
6. 한눈요약/본사정산 표시명 통일 확인

## 예상 규모

대규모 작업 (5~6 크레딧 예상). 단계별 진행도 가능합니다.

## 진행 방식

- A. 한 번에 전체 구현
- B. 단계별 (먼저 1~4: 별칭/동명이인 → 확인 후 5~6: 오은규 합산 표시)
- C. 가장 시급한 것 먼저 (어느 항목?)
