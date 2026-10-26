"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearGoogleAds,
  saveGoogleAds,
  testGoogleAds,
  type SaveAdsResult,
  type TestAdsResult,
} from "./ads-actions";

export function GoogleAdsForm({
  hasToken,
  customerId,
  loginCustomerId,
  authorized,
  canConnect,
}: {
  hasToken: boolean;
  customerId: string | null;
  loginCustomerId: string | null;
  authorized: boolean;
  /** The Google OAuth client is set, so the adwords consent can be asked for. */
  canConnect: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    SaveAdsResult | null,
    FormData
  >(saveGoogleAds, null);
  const [test, setTest] = useState<TestAdsResult | null>(null);
  const [busy, startBusy] = useTransition();
  const errors = state && !state.ok ? state.errors : {};

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="developerToken">Developer token</Label>
          <Input
            id="developerToken"
            name="developerToken"
            type="password"
            placeholder={
              hasToken ? "•••••••••••• (saved)" : "Google Ads → Tools → API Center"
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="customerId">Customer ID</Label>
            <Input
              id="customerId"
              name="customerId"
              placeholder="123-456-7890"
              defaultValue={customerId ?? ""}
              aria-invalid={Boolean(errors.customerId)}
            />
            {errors.customerId && (
              <p className="text-xs text-destructive">{errors.customerId}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loginCustomerId">Manager ID (optional)</Label>
            <Input
              id="loginCustomerId"
              name="loginCustomerId"
              placeholder="Only when signing in through a manager"
              defaultValue={loginCustomerId ?? ""}
              aria-invalid={Boolean(errors.loginCustomerId)}
            />
            {errors.loginCustomerId && (
              <p className="text-xs text-destructive">
                {errors.loginCustomerId}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {state?.ok && <span className="text-xs text-emerald-300">Saved.</span>}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
        {canConnect ? (
          <a href="/api/google/auth?ads=1">
            <Button type="button" variant="outline">
              {authorized ? "Reconnect Google Ads" : "Connect Google Ads"}
            </Button>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">
            Save the Google OAuth client first.
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busy || !hasToken || !authorized}
          onClick={() => startBusy(async () => setTest(await testGoogleAds()))}
        >
          {busy ? "Working…" : "Test Keyword Planner"}
        </Button>
        {hasToken && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              startBusy(async () => {
                await clearGoogleAds();
                setTest(null);
              })
            }
          >
            Remove
          </Button>
        )}
        <span
          className={`text-xs ${authorized ? "text-emerald-300" : "text-muted-foreground"}`}
        >
          {authorized ? "Signed in to Google Ads" : "Not signed in yet"}
        </span>
      </div>
      {test && (
        <p
          className={`text-xs ${test.ok ? "text-emerald-300" : "text-destructive"}`}
        >
          {test.message}
        </p>
      )}
    </div>
  );
}
