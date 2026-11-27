import { readPlanningBaseline } from "../../apps/web/src/portfolio-baseline-refresh";
import { useCallback, useEffect, useState } from "react";
import type { PortfolioBaselineState } from "../../packages/domain/src/index";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextLink,
} from "@keel/ui";
import {
  BaselineRefreshStatus,
  PortfolioBaselineExceptions,
} from "../../apps/web/src/PortfolioBaselineReconciliation";
import {
  exampleSource,
  savedExample,
  restartExample,
  routineExamples,
  reviewExamples,
  type Example,
} from "./baseline-fixture";
import { formatMoney } from "../../apps/web/src/format";

function BaselineExample({ example }: { example: Example }) {
  const [source] = useState(() => exampleSource(example));
  const [state, setState] = useState<PortfolioBaselineState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    (signal?: AbortSignal) =>
      readPlanningBaseline(
        {
          load: source.load,
          refresh: source.refresh,
          display: (next) => {
            setState(next);
            setError(null);
          },
        },
        signal,
      ),
    [source],
  );
  const retry = useCallback(
    (signal?: AbortSignal) => {
      void reload(signal).catch((failure: unknown) => {
        if (!signal?.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Planning values could not be refreshed.",
          );
      });
    },
    [reload],
  );
  useEffect(() => {
    const controller = new AbortController();
    retry(controller.signal);
    return () => controller.abort();
  }, [retry]);
  if (!state || state.automaticUpdateCount)
    return <BaselineRefreshStatus error={error} onRetry={() => retry()} />;
  if (state.exceptions?.length)
    return (
      <PortfolioBaselineExceptions
        state={state}
        onConfirm={source.confirm}
        onUpdated={reload}
      />
    );
  return (
    <p className="catalogue-note" role="status">
      Capture result · The plan now uses{" "}
      {formatMoney(state.planning.currentFiEligibleLiquidMinor)} in FI-eligible
      liquid. No sources need a decision in Holdings.
    </p>
  );
}

export function BaselineWalkthrough({ stepId }: { stepId: string }) {
  const routine = stepId === "baseline-refresh";
  const examples = routine ? routineExamples : reviewExamples;
  const [example, setExample] = useState<Example>(
    () => savedExample(routine) ?? examples[0],
  );
  const [run, setRun] = useState(0);
  return (
    <>
      <BaselineExample key={example + run} example={example} />
      <TextLink
        href={
          routine
            ? "#journeys/baseline-exceptions"
            : "#journeys/baseline-refresh"
        }
      >
        {routine
          ? "Inspect a source that needs review"
          : "See the routine refresh"}
      </TextLink>
      <Collapsible>
        <CollapsibleTrigger layout="inline">
          Capture controls and source <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Field label="Baseline example">
            <Select
              value={example}
              onValueChange={(value) => {
                const selected = examples.find((item) => item === value);
                if (selected && selected !== example) {
                  restartExample(routine);
                  setExample(selected);
                }
              }}
            >
              <SelectTrigger aria-label="Baseline example">
                <SelectValue>{example}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {examples.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ActionGroup>
            <Button
              tone="quiet"
              onClick={() => {
                restartExample(routine);
                setRun((current) => current + 1);
              }}
            >
              Restart example
            </Button>
          </ActionGroup>
          <p className="catalogue-note">
            Product reference · Holdings planning baseline at 32ee1909. This tab
            keeps synthetic decisions through a page reload. Restart example
            restores its starting values.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
