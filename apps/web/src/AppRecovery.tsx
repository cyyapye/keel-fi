import { Button, Notice, SectionHeader } from "@keel/ui";
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// A reload starts a fresh module graph; remounting a rejected lazy import would
// reuse the same rejection. Keep recovery explicit to preserve other drafts.
function ReloadKeel({ className }: { className?: string }) {
  return (
    <Button className={className} onClick={() => window.location.reload()}>
      Reload Keel
    </Button>
  );
}

export function AppRecovery() {
  return (
    <main className="startup-shell">
      <div className="startup-brand">Keel</div>
      <Notice className="startup-message" tone="error">
        <h1>Keel couldn’t open</h1>
        <p>Reload this page to try again.</p>
        <ReloadKeel className="startup-reload" />
      </Notice>
    </main>
  );
}

export function PortfolioRecovery() {
  return (
    <section aria-label="Portfolio snapshot" className="portfolio-snapshot">
      <SectionHeader eyebrow="Current portfolio" title="Portfolio snapshot" />
      <Notice className="portfolio-snapshot__error" tone="error">
        <p>The portfolio summary couldn’t load.</p>
        <ReloadKeel />
      </Notice>
    </section>
  );
}
