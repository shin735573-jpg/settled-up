## 목표

재방문 그룹에서 **업체는 1차 원금**으로, **팀장은 차감된 금액**으로 모든 화면이 일관되게 보이도록 정리.

## 현재 상태

| 화면 | 1차 행 표시 금액 | 2차 행 표시 | 비고 |
|---|---|---|---|
| 업체정산 | 130k ✓ | 숨김 ✓ | 정상 |
| 팀장정산 (LeaderSettlement) | 65k ✓ | 65k(2차팀장) ✓ | 정상 |
| 본사정산 (HQSettlement) | 130k ✗ | 65k(중복) ✗ | **+65k 부풀림** |
| RecordsBrowse (팀장조회) | 130k ✗ | 130k 1차에도 노출 ✗ | **이중 노출** |
| Summary | 130k ✗ | — | 1차 원금만 |
| Records 입력 | 130k 편집 가능 ✗ | — | 수동 수정 위험 |

## 수정 계획

### 1) 공통 헬퍼 추가 — `src/lib/revisitRedistribute.ts`
- `computeRevisitRedistribution(rows, virtualIds)` → `Map<rowId, RevisitShare[] | null>`
- LeaderSettlement·statementData의 중복 로직 1곳으로 통합
- `getLeaderViewFee(row, leaderId, overrideMap)` → 팀장 관점 (metro, regional, note, cod) 반환

### 2) HQSettlement.tsx — 재방문 override 적용
- `allocations`/`yearAllocations`에서 헬퍼 사용
- 2차 행 = 정산 제외, 1차 행 = 차감 후 분배

### 3) RecordsBrowse.tsx — 팀장 관점 표시
- 선택된 팀장 기준으로 1차 행은 차감된 금액, 2차 행은 청구 금액 표시
- 해당 팀장과 무관한 재방문 행은 목록에서 제외 (예: 1차 팀장 조회 시 2차 행 숨김, 단 1차 행은 차감된 금액으로 표시)

### 4) Records.tsx — 1차 행 금액 잠금
- 재방문 1차 행(`revisit_group_id` 있고 `revisit_visit_no === 1`)의 `metro_fee` / `regional_fee` 입력칸 readonly
- 마우스오버 안내: "재방문 1차는 자동 분배 — 2차 금액으로 차감됨"
- `note_amount` / `cod_amount` 는 그대로 편집 가능 (1차 팀장1 고정 귀속)

### 5) Summary.tsx — 팀장별 합계 시 헬퍼 사용
- 팀장별 metro/regional 집계에 redistribution 반영

## 검증

- 마조드까사 그룹(2026-05-20→05-22) 기준 모든 화면에서:
  - 업체 = 130,000 / 맹광식 = 65,000 / 오동선(오은규) = 65,000 / 합 = 130,000
- 기존 테스트 165건 통과 유지 + 신규 헬퍼 단위 테스트 추가

진행하면 약 6~8개 파일 수정됩니다.
