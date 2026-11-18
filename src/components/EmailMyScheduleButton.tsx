"use client";

import { useState, useTransition } from "react";
import { emailMySchedule } from "@/actions/email-schedule";

function downloadBase64File(
  base64: string,
  fileName: string,
  mime: string
) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function EmailMyScheduleButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setStatus(null);
    setError(null);
    startTransition(async () => {
      const result = await emailMySchedule();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.mode === "sent") {
        const via =
          result.via === "gmail" ? "tryouts@altbsa.org (Google Workspace)" : "email";
        setStatus(
          `Sent ${result.count} sessions to ${result.to} from ${via}. Check your inbox.`
        );
        return;
      }
      downloadBase64File(
        result.icsBase64,
        result.icsFileName,
        "text/calendar;charset=utf-8"
      );
      window.location.href = result.mailto;
      setStatus(
        `Prepared ${result.count} sessions for ${result.to}. Your mail app should open, and an .ics file downloaded.`
      );
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded border border-[var(--maroon)] bg-[var(--maroon)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Preparing…" : "Email my schedule"}
      </button>
      {status && (
        <p className="max-w-sm text-right text-xs text-stone-600">{status}</p>
      )}
      {error && (
        <p className="max-w-sm text-right text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}
