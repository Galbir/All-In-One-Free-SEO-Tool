import { accountsEnabled, canManageSettings, currentUser } from "@/lib/auth";

/**
 * Settings are the owner's. They hold integration keys, SMTP, webhooks,
 * backups and the team itself — the role description for a manager is
 * literally "can't change integration keys". The actions behind these
 * screens refuse non-owners on their own (see lib/action-guard.ts); this
 * stops the screens rendering the configuration to them in the first
 * place.
 *
 * Solo and shared-password installs have no roles, so nothing changes.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (accountsEnabled()) {
    const me = await currentUser();
    if (me && !canManageSettings(me.role)) {
      return (
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="text-lg font-semibold">Settings are owner-only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Integration keys, email, backups and the team are managed by the
            workspace owner. Ask them if something here needs changing.
          </p>
        </div>
      );
    }
  }
  return <>{children}</>;
}
