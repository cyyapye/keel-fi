import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/utils";

export type NavigationItem<Id extends string> = {
  badge?: ReactNode;
  id: Id;
  index: string;
  label: string;
};

type AppShellProps<Id extends string> = {
  activeItemId: Id;
  brandMark: ReactNode;
  brandName: string;
  brandSubtitle?: string;
  children: ReactNode;
  contextName: string;
  items: readonly NavigationItem<Id>[];
  onNavigate: (id: Id) => void;
  operatorInitials: string;
  operatorName: string;
  pageTitle: string;
  referenceLinks?: readonly { href: string; label: string }[];
  referenceLabel?: string;
};

export function AppShell<Id extends string>({
  activeItemId,
  brandMark,
  brandName,
  brandSubtitle,
  children,
  contextName,
  items,
  onNavigate,
  operatorInitials,
  operatorName,
  pageTitle,
  referenceLinks = [],
  referenceLabel = "Reference",
}: AppShellProps<Id>) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const navigationElement = mobileNavigationRef.current;
    const activeItem = navigationElement?.querySelector<HTMLButtonElement>(
      '[aria-current="page"]',
    );
    const focusFrame = window.requestAnimationFrame(() => activeItem?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
        window.requestAnimationFrame(() =>
          mobileMenuButtonRef.current?.focus(),
        );
        return;
      }

      if (event.key !== "Tab" || navigationElement === null) {
        return;
      }

      const navigationButtons = Array.from(
        navigationElement.querySelectorAll<HTMLElement>("button, a[href]"),
      );
      const lastButton = navigationButtons.at(-1);

      if (
        event.shiftKey &&
        document.activeElement === mobileMenuButtonRef.current &&
        lastButton !== undefined
      ) {
        event.preventDefault();
        lastButton.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === lastButton &&
        mobileMenuButtonRef.current !== null
      ) {
        event.preventDefault();
        mobileMenuButtonRef.current.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  };

  const navigateFromMobileMenu = (id: Id) => {
    onNavigate(id);
    closeMobileMenu();
  };

  const navigation = (mobile: boolean) =>
    items.map((item) => (
      <button
        aria-current={activeItemId === item.id ? "page" : undefined}
        className={cn(activeItemId === item.id && "active")}
        key={item.id}
        onClick={() =>
          mobile ? navigateFromMobileMenu(item.id) : onNavigate(item.id)
        }
        type="button"
      >
        <i>{item.index}</i>
        <span>{item.label}</span>
        {item.badge !== undefined && <b>{item.badge}</b>}
      </button>
    ));

  const references = referenceLinks.length > 0 && (
    <div
      className="navigation-reference"
      role="group"
      aria-label={referenceLabel}
    >
      <p className="navigation-reference__label">{referenceLabel}</p>
      {referenceLinks.map((link) => (
        <a href={link.href} key={link.href}>
          {link.label}
        </a>
      ))}
    </div>
  );

  return (
    <div className="app-shell" data-slot="app-shell">
      <aside className="sidebar" data-slot="sidebar">
        <div className="brand">
          {brandMark}
          <div>
            <strong>{brandName}</strong>
            {brandSubtitle !== undefined && <small>{brandSubtitle}</small>}
          </div>
        </div>
        <div className="sidebar__navigation">
          <nav aria-label="Primary navigation">{navigation(false)}</nav>
          {references}
        </div>
        <div className="sidebar__footer">
          <div className="user-avatar">{operatorInitials}</div>
          <div>
            <strong>{operatorName}</strong>
            <span>{contextName}</span>
          </div>
          <i aria-hidden="true">•••</i>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar__title">
            {brandMark}
            <span>{brandName} /</span> {pageTitle}
          </div>
          <button
            aria-controls="mobile-navigation"
            aria-expanded={mobileMenuOpen}
            aria-label={
              mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
            ref={mobileMenuButtonRef}
            type="button"
          >
            <span aria-hidden="true" className="mobile-menu-toggle__icon">
              <span />
              <span />
              <span />
            </span>
          </button>
        </header>
        <div className="content">{children}</div>
      </main>

      <nav
        aria-label="Mobile navigation"
        className="mobile-nav"
        hidden={!mobileMenuOpen}
        id="mobile-navigation"
        ref={mobileNavigationRef}
      >
        {navigation(true)}
        {references}
      </nav>
    </div>
  );
}
