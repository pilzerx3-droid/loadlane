"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  CONSENT_COPY,
  DRIVER_STATUS_LABELS,
  type DRIVER_REPORTABLE_STATUSES,
} from "@loadlane/shared";
import { Button, Card } from "@loadlane/ui";
import {
  driverConsentAction,
  driverPositionAction,
  driverStatusAction,
  driverWithdrawAction,
  type DriverActionResult,
} from "../app/driver-actions";
import { DRIVER_FAILURE_MESSAGES, type DriverJobView as Job } from "../lib/driver-api";
import { DriverJobView } from "./driver-job-view";
import { DriverUpload } from "./driver-upload";
import { Notice } from "./notices";

/** A position is sent at most this often, however often the phone reports one. */
const SEND_INTERVAL_MS = 30_000;

type Geo =
  | { state: "idle" }
  | { state: "waiting" }
  | { state: "sent"; at: string }
  | { state: "denied" | "unsupported" | "unavailable" };

type Reportable = (typeof DRIVER_REPORTABLE_STATUSES)[number];

/**
 * The driver's page (ADR 0015). Nothing asks the browser for a location before the driver agreed
 * on the consent screen. Sharing only works while this page is open; the page says so.
 */
export function DriverConsole({ token, initial }: { token: string; initial: Job }) {
  const [job, setJob] = useState(initial);
  const [message, setMessage] = useState<string | undefined>();
  const [declined, setDeclined] = useState(false);
  const [geo, setGeo] = useState<Geo>({ state: "idle" });
  const [pending, startTransition] = useTransition();
  const lastSent = useRef(0);

  function apply(result: DriverActionResult) {
    if (result.ok) {
      setJob(result.job);
      setMessage(undefined);
    } else {
      setMessage(DRIVER_FAILURE_MESSAGES[result.reason]);
    }
  }

  function run(action: () => Promise<DriverActionResult>) {
    startTransition(async () => {
      apply(await action());
    });
  }

  const sharing = job.sharing;
  useEffect(() => {
    if (!sharing) {
      setGeo({ state: "idle" });
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeo({ state: "unsupported" });
      return;
    }
    let cancelled = false;
    let wakeLock: WakeLockSentinel | undefined;
    // Keeps the screen on so the phone keeps reporting; it is a request the phone may refuse.
    navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        wakeLock = lock;
      })
      .catch(() => undefined);
    setGeo({ state: "waiting" });
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastSent.current < SEND_INTERVAL_MS) return;
        lastSent.current = now;
        void driverPositionAction(token, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          recordedAt: new Date(position.timestamp).toISOString(),
        }).then((result) => {
          if (cancelled) return;
          if (result.ok) {
            setGeo({ state: "sent", at: new Date().toISOString() });
          } else {
            setGeo({ state: "unavailable" });
            setMessage(DRIVER_FAILURE_MESSAGES[result.reason]);
          }
        });
      },
      (error) => {
        setGeo({ state: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" });
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      void wakeLock?.release().catch(() => undefined);
    };
  }, [sharing, token]);

  const closed = job.nextStatuses.length === 0;
  return (
    <div className="space-y-5">
      <DriverJobView job={job} />
      {message ? <Notice>{message}</Notice> : null}

      {!closed ? (
        <Card className="space-y-3 p-4" aria-label="Position sharing">
          {sharing ? (
            <>
              <p className="font-semibold">Sharing your position</p>
              <p className="text-sm text-muted-foreground">{geoText(geo)}</p>
              <p className="text-sm text-muted-foreground">
                This works only while this page is open and the screen is on. If you close the page
                or lock the phone, sharing pauses.
              </p>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => run(() => driverWithdrawAction(token))}
              >
                Stop sharing
              </Button>
            </>
          ) : declined ? (
            <>
              <p className="font-semibold">Position sharing is off</p>
              <p className="text-sm text-muted-foreground">
                You can still report status updates below.
              </p>
              <Button variant="outline" onClick={() => setDeclined(false)}>
                Review again
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">{CONSENT_COPY.title}</h2>
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {CONSENT_COPY.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <div className="flex flex-col gap-2">
                <Button
                  variant="solid"
                  disabled={pending}
                  onClick={() => run(() => driverConsentAction(token))}
                >
                  {CONSENT_COPY.accept}
                </Button>
                <Button variant="outline" onClick={() => setDeclined(true)}>
                  {CONSENT_COPY.decline}
                </Button>
              </div>
            </>
          )}
        </Card>
      ) : (
        <Notice>This transport is finished. Thank you.</Notice>
      )}

      <DriverUpload token={token} />

      {job.nextStatuses.length > 0 ? (
        <Card className="space-y-3 p-4" aria-label="Report a status">
          <h2 className="text-lg font-semibold">Report status</h2>
          <div className="flex flex-col gap-2">
            {job.nextStatuses.map((status) => (
              <Button
                key={status}
                variant="outline"
                disabled={pending}
                onClick={() => run(() => driverStatusAction(token, status))}
              >
                {DRIVER_STATUS_LABELS[status as Reportable] ?? status}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function geoText(geo: Geo): string {
  switch (geo.state) {
    case "waiting":
      return "Waiting for your phone to report a location…";
    case "sent":
      return `Last position sent at ${new Date(geo.at).toLocaleTimeString("en-US")}.`;
    case "denied":
      return "Your phone did not allow location access. Allow it in the browser settings, or stop sharing.";
    case "unsupported":
      return "This browser cannot report a location. You can still report status updates.";
    case "unavailable":
      return "No position could be sent right now. It will try again.";
    case "idle":
      return "";
  }
}
