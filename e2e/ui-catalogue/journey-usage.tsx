import { ActionGroup, TextLink } from "@keel/ui";
import { stepsUsing } from "./journey-spec";

export function JourneyUsage({ components }: { components: string[] }) {
  const steps = stepsUsing(components);
  if (!steps.length) return null;
  return (
    <div className="catalogue-journey-usage">
      <p className="catalogue-note">Used in Journeys</p>
      <ActionGroup wrap>
        {steps.map((step) => (
          <TextLink key={step.id} href={`#journeys/${step.id}`}>
            {step.title}
          </TextLink>
        ))}
      </ActionGroup>
    </div>
  );
}
