"use client";

import { useState } from "react";
import { Button, Card } from "@loadlane/ui";

/** Sends a photo or document (for example the signed delivery receipt) for this transport. */
export function DriverUpload({ token }: { token: string }) {
  const [type, setType] = useState("proof_of_delivery");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | undefined>();

  async function send(form: HTMLFormElement) {
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setResult({ ok: false, text: "Choose a photo or file first." });
      return;
    }
    setBusy(true);
    setResult(undefined);
    try {
      const response = await fetch(`/d/${encodeURIComponent(token)}/documents`, {
        method: "POST",
        body: data,
      });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (response.ok && json.ok) {
        setResult({ ok: true, text: "Sent. The dispatcher can see it now." });
        form.reset();
      } else {
        setResult({ ok: false, text: json.message ?? "That could not be sent. Please try again." });
      }
    } catch {
      setResult({ ok: false, text: "Loadlane could not be reached. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4" aria-label="Send a photo or document">
      <h2 className="text-lg font-semibold">Send a photo or document</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(event.currentTarget);
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="driver-doc-type" className="mb-1 block text-[13px] font-semibold">
            What is it?
          </label>
          <select
            id="driver-doc-type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-11 w-full rounded-control border border-border bg-card px-3 text-sm"
          >
            <option value="proof_of_delivery">Proof of delivery</option>
            <option value="photo">Photo</option>
            <option value="delivery_note">Delivery note</option>
            <option value="bill_of_lading">Bill of lading</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label htmlFor="driver-doc-file" className="mb-1 block text-[13px] font-semibold">
            Photo or file
          </label>
          <input
            id="driver-doc-file"
            name="file"
            type="file"
            accept="image/*,application/pdf"
            className="w-full text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, JPEG, PNG, WebP or HEIC, up to 10 MB.
          </p>
        </div>
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </Button>
        {result ? (
          <p role="status" className={result.ok ? "text-sm" : "text-sm text-danger"}>
            {result.text}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
