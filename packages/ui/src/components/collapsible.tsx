import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

export function Collapsible(
  props: React.ComponentProps<typeof CollapsiblePrimitive.Root>,
) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger({
  layout,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
  layout?: "inline";
}) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      data-layout={layout}
      {...props}
    />
  );
}

export function CollapsibleContent(
  props: React.ComponentProps<typeof CollapsiblePrimitive.Panel>,
) {
  return (
    <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
  );
}
