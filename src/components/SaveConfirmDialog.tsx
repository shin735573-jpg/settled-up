import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type SaveSummaryItem = { label: string; value: string };

export type SaveConfirmRequest = {
  title?: string;
  description?: string;
  summary: SaveSummaryItem[];
  confirmLabel?: string;
  cancelLabel?: string;
};

type Pending = SaveConfirmRequest & { action: () => void | Promise<void> };

/**
 * 공용 "저장 전 요약 확인" 다이얼로그.
 *
 * 사용 예:
 *   const { confirm, dialog } = useSaveConfirm();
 *   ...
 *   await confirm({ summary: [{label:"건수", value:"12건"}] }, async () => {
 *     await actuallySave();
 *   });
 *   ...
 *   return <>{dialog}{...}</>
 */
export function useSaveConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback(
    (req: SaveConfirmRequest, action: () => void | Promise<void>) => {
      setPending({ ...req, action });
    },
    [],
  );

  const onConfirm = async () => {
    const p = pendingRef.current;
    if (!p) return;
    setBusy(true);
    try {
      await p.action();
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const onCancel = () => {
    if (busy) return;
    setPending(null);
  };

  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title || "저장 확인"}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending?.description || "다음 내용으로 저장합니다. 확인해주세요."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <ul className="space-y-1">
            {(pending?.summary || []).map((it, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{it.label}</span>
                <span className="font-medium text-right break-all">{it.value}</span>
              </li>
            ))}
          </ul>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {pending?.cancelLabel || "취소"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={busy}
          >
            {busy ? "저장 중..." : pending?.confirmLabel || "저장"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog, isOpen: !!pending, busy };
}