import { DisclosureIndicator, TextLink } from "@keel/ui";

/** Catalogue-local composition of existing controls, not a new shared API. */
export function DetailLink({ href, label }: { href: string; label: string }) {
  return (
    <TextLink
      href={href}
      aria-label={label}
      className="catalogue-position-link"
    >
      <DisclosureIndicator />
    </TextLink>
  );
}
