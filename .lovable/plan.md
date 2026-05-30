## 개요
기록입력 화면에 (1) 종합 오류 검사 기능과 (2) 정산마감 이후에도 가능한 누락분 추가 기능, 그리고 (3) 정산서 버전관리 체계를 추가합니다.

## 1단계: 데이터 모델 확장 (DB 마이그레이션)

**deliveries 테이블 컬럼 추가**
- `is_missing` (boolean, default false) — 누락분 여부
- `missing_reason` (text, nullable) — 누락 사유
- `settlement_locked_at` (timestamptz, nullable) — 정산마감 시점 스냅샷

**신규 테이블 `settlement_periods`** — 정산 기간/마감 상태 관리
- `scope` ('company'|'leader'), `target_id` (uuid), `period_start`, `period_end`
- `status` ('open'|'locked'|'regen_required'|'regen_done')
- `locked_at`, `last_modified_at`

**신규 테이블 `settlement_documents`** — 정산서 버전 관리
- `period_id` → settlement_periods, `version` (int), `file_path` (text)
- `change_reason` (text), `created_at`

## 2단계: 오류 검사 엔진 (`src/lib/recordValidation.ts`)

순수 함수로 13개 검사 룰 구현 + 단위 테스트:
1. 필수값 누락 (날짜/업체/팀장1/고객명/품목)
2. 금액 오류 (문자/음수)
3. 배송비총액 = 수도권+비고+지방
4. 미등록 업체 (경고)
5. 미등록 팀장 (경고, 팀장2 빈칸 허용)
6. 지역구분 vs 배송지 자동분류 불일치 (경고)
7. 결제유무 허용값 (미결제/결제완료)
8. 분할 허용값 (빈칸/3분할/형주동석)
9. 3분할 시 팀장1/2 필수
10. 거부팀장 충돌 (경고 + 가상기사 표시)
11. 휴무일 (본사=오류, 팀장=해당팀장 오류)
12. 중복 의심 (날짜+업체+고객+품목+총액)
13. 기간별 업체총액 vs 팀장총액 일치 (1-15/16-말/월전체)

각 결과: `{ rowId, severity: 'error'|'warning', code, message }`

## 3단계: 기록입력 UI 변경 (`src/pages/RecordInput.tsx`)

- 상단에 큰 "오류 검사" 버튼 + "누락분 추가" 버튼
- 검사 결과 패널: 전체/오류/경고/정상 카운트 + 색상 배지(빨강/주황/초록)
- 오류 목록 테이블: 행번호 / 종류 / 내용 / [수정] 버튼 → 해당 행 편집 모달
- 오류 존재 시 저장/정산마감 비활성화, 경고만 있으면 확인 다이얼로그
- 목록에 "일반/누락분" 구분 배지

## 4단계: 누락분 추가 모달

- 위 검사 항목 전체 필드 입력 폼 + 누락 사유 필수
- 저장 직전 자동으로 오류 검사 실행
- 저장 시 `is_missing=true`, `date` 기준으로 어느 정산기간에 귀속되는지 표시
- 해당 기간 `settlement_periods.status`를 'regen_required'로 갱신

## 5단계: 정산서 버전관리

- 회사/팀장 정산서 생성 코드에서 파일명 규칙: `{scope}_{name}_{YYYY-MM}_{1-15|16-말}_v{n}.png`
- 기존 파일 삭제 금지, version 자동 증가
- 정산 화면에 "재생성 필요" 뱃지 + "정산서 재생성" 버튼
- 재생성 시 새 row를 settlement_documents에 insert + status='regen_done'

## 6단계: 정산 화면 반영

- CompanySettlement / LeaderSettlement / Summary / HQSettlement에서 `is_missing` 포함 집계
- 정산서 목록에 버전 리스트 표시(최신 강조)

## 기술 세부

- 검증 엔진은 React와 분리된 순수 TS — Vitest 테스트 동반 (CI에서 자동 실행)
- 휴무일/거부팀장 검사를 위해 holidays / team_leaders.is_rejected 활용
- 정산기간 계산 유틸: `getPeriod(date)` → {year, month, half: '1-15'|'16-end'}
- UI는 기존 디자인 토큰(시맨틱 토큰) 사용, shadcn 컴포넌트 활용

## 작업 범위가 크기 때문에 확인

이 작업은 마이그레이션 1회 + 신규 파일 약 8개 + 기존 파일 수정 약 6개로, 한 번에 처리하면 변경 폭이 매우 큽니다. 아래 중 어떻게 진행할지 알려주세요:

**A. 한 번에 전체 구현** (1~6단계 모두)
**B. 단계별 분할 진행** — 먼저 1+2+3단계(오류 검사)만 → 확인 후 4+5+6단계(누락분/버전관리)
**C. 우선순위 지정** — 가장 급한 기능만 먼저
