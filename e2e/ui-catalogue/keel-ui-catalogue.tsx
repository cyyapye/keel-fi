import { formatHoldingsAmount } from "@keel/ui/money";
import { Journeys } from "./keel-journeys";
import { JourneyUsage } from "./journey-usage";
import { groups, pages, type Page } from "./catalogue-manifest";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as UI from "@keel/ui";
import {
  CheckboxExample,
  RadioExample,
  LoadingExample,
  FieldSaveExample,
  Compositions,
  CollectionLoading,
} from "./keel-ui-candidates";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

declare const CATALOGUE_REVISION: string;
declare const CATALOGUE_RETURN_URL: string;
declare const CATALOGUE_TOKENS: Record<string, string>;
const {
  AppShell,
  BrandMark,
  Button,
  ButtonLink,
  ActionGroup,
  PageHeader,
  Screen,
  SectionHeader,
  Panel,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SearchSelect,
  InfoTip,
  DatePicker,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  SectionNavigation,
  Field,
  Input,
  InputGroup,
  Textarea,
  SearchField,
  SearchHighlight,
  ChoiceGroup,
  Badge,
  Notice,
  FormMessage,
  EmptyState,
  TextLink,
  DataList,
  DataItem,
  Stat,
  StatGroup,
  MetricCard,
  ChartContainer,
  ChartTooltipContent,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselDots,
} = UI;

const catalogued = new Set(Object.values(groups).flatMap((g) => g.names));
const missing = Object.keys(UI).filter((name) => !catalogued.has(name));
if (missing.length)
  throw new Error(`Uncatalogued UI exports: ${missing.join(", ")}`);

function Example({
  title,
  components,
  children,
  wide = false,
}: {
  title: string;
  components: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`catalogue-example${wide ? " catalogue-example--wide" : ""}`}
      data-components={components.split(" · ").join(" ")}
    >
      <SectionHeader title={title} />
      <p className="catalogue-source">{components}</p>
      <div className="catalogue-example-content">{children}</div>
      <JourneyUsage components={components.split(" · ")} />
    </section>
  );
}
const taxOptions = [
  { value: "partnership", label: "Partnership" },
  { value: "corporation", label: "Corporation" },
  { value: "disregarded", label: "Disregarded entity" },
];
const companies = [
  { value: "northstar", label: "Northstar Robotics" },
  { value: "meridian", label: "Meridian Energy" },
  { value: "cedar", label: "Cedar Health" },
];

function ResponsiveSectionsExample() {
  const [section, setSection] = useState("profile");
  const [narrow, setNarrow] = useState(false);
  const items = [
    { value: "profile", label: "Profile", status: "Complete", complete: true },
    { value: "sources", label: "Source documents", status: "2 linked" },
    { value: "history", label: "Change history", status: "1 change" },
  ];
  return (
    <Example
      title="Tabs on narrow screens"
      components="SectionNavigation · Tabs · Select"
      wide
    >
      <div className="catalogue-usage-rules">
        <p>
          Use tabs for alternate views of the same record, with one panel
          visible at a time.
        </p>
        <p>
          Switch to a section dropdown when labels would wrap, truncate or
          require horizontal scrolling. Keep short tabs only when their full
          labels and touch targets fit comfortably.
        </p>
        <p>
          Keel’s SectionNavigation uses a dropdown at 700px or less of viewport
          or container width. It preserves the selected section and its content.
          A narrow column can need this even on a wide screen.
        </p>
        <p>
          If information must be compared together, use visible sections. Use a
          disclosure for optional supporting detail.
        </p>
      </div>
      <ActionGroup wrap aria-label="Section navigation preview width">
        <Button aria-pressed={!narrow} onClick={() => setNarrow(false)}>
          Available width
        </Button>
        <Button aria-pressed={narrow} onClick={() => setNarrow(true)}>
          Narrow column
        </Button>
      </ActionGroup>
      <div
        className="catalogue-navigation-preview"
        style={{ maxWidth: narrow ? 360 : undefined }}
      >
        <Tabs
          value={section}
          onValueChange={(value) => setSection(String(value))}
        >
          <SectionNavigation
            label="Record view"
            items={items}
            value={section}
            onValueChange={setSection}
          />
          <TabsContent value="profile">
            <UI.Text variant="primary">Northstar SPV I, LLC</UI.Text>
          </TabsContent>
          <TabsContent value="sources">
            <UI.Text>Formation certificate · Subscription agreement</UI.Text>
          </TabsContent>
          <TabsContent value="history">
            <UI.Text>Legal name updated · Oct 20, 2026</UI.Text>
          </TabsContent>
        </Tabs>
      </div>
      <p className="catalogue-note">
        Resize this example or select Narrow column to try the same component in
        its compact form. Selection stays in place when the control changes.
      </p>
    </Example>
  );
}

function Interactions() {
  const [tax, setTax] = useState<string | null>("partnership");
  const [company, setCompany] = useState("northstar");
  const [date, setDate] = useState("2026-10-20");
  return (
    <div className="catalogue-grid">
      <Example
        title="Collapsible"
        components="Collapsible · CollapsibleTrigger · CollapsibleContent · DisclosureIndicator"
      >
        <Collapsible>
          <CollapsibleTrigger layout="inline">
            Sources &amp; history <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="catalogue-stack">
              <p>Legal name updated · Oct 20, 2026, 10:30 AM</p>
              <div>
                <h4 className="candidate-source-heading">Source</h4>
                <p className="catalogue-note">
                  Demo formation certificate · May 14, 2024
                </p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible disabled>
          <CollapsibleTrigger layout="inline">
            Unavailable while saving <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>Disabled content</CollapsibleContent>
        </Collapsible>
      </Example>
      <Example
        title="Dropdown selection"
        components="Select · SelectTrigger · SelectValue · SelectContent · SelectItem"
      >
        <Field label="Tax classification">
          <Select
            items={taxOptions}
            value={tax}
            onValueChange={(v) => setTax(v as string | null)}
          >
            <SelectTrigger aria-label="Tax classification">
              <SelectValue placeholder="Choose classification" />
            </SelectTrigger>
            <SelectContent>
              {taxOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Unavailable selection">
          <Select disabled items={taxOptions}>
            <SelectTrigger aria-label="Unavailable selection">
              <SelectValue placeholder="Choose classification" />
            </SelectTrigger>
            <SelectContent>
              {taxOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Example>
      <Example title="Searchable dropdown" components="SearchSelect">
        <SearchSelect
          label="Underlying company"
          searchLabel="Find a company"
          items={companies}
          value={company}
          onChange={setCompany}
        />
        <SearchSelect
          label="Unavailable company selection"
          searchLabel="Find another company"
          disabled
          items={companies}
          value=""
          onChange={() => {}}
        />
      </Example>
      <Example title="Information popup" components="InfoTip · Button">
        <ActionGroup>
          <span>Source references</span>
          <InfoTip label="About source references">
            References let you trace a displayed fact to its source. Demo
            sources contain synthetic records.
          </InfoTip>
        </ActionGroup>
        <ActionGroup>
          <span>Unavailable while saving</span>
          <InfoTip label="Unavailable source information" disabled>
            Disabled popup
          </InfoTip>
        </ActionGroup>
      </Example>
      <Example title="Date picker" components="DatePicker">
        <Field
          label="Formation date"
          description="Use the date on the document."
          error={date === "" ? "Choose the date on the document." : undefined}
        >
          {(control) => (
            <DatePicker
              {...control}
              aria-label="Formation date"
              value={date}
              onValueChange={setDate}
              min="2026-01-01"
              max="2026-12-31"
            />
          )}
        </Field>
        <Field label="Unavailable date">
          {(control) => (
            <DatePicker
              {...control}
              aria-label="Unavailable date"
              value=""
              onValueChange={() => {}}
              disabled
            />
          )}
        </Field>
      </Example>
      <Example
        title="Tabs"
        components="Tabs · TabsList · TabsTrigger · TabsContent"
      >
        <Tabs defaultValue="profile">
          <TabsList aria-label="Record sections">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="unavailable" disabled>
              Unavailable
            </TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            <p>Northstar SPV I, LLC</p>
          </TabsContent>
          <TabsContent value="history">
            <p>Legal name updated · Oct 20, 2026</p>
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="all">
          <TabsList variant="line" aria-label="Source filters">
            <TabsTrigger value="all">All sources</TabsTrigger>
            <TabsTrigger value="review">Needs review</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <p>Demo formation certificate</p>
          </TabsContent>
          <TabsContent value="review">
            <p>No sources need review.</p>
          </TabsContent>
        </Tabs>
      </Example>
      <ResponsiveSectionsExample />
    </div>
  );
}

function Forms({ navigate }: { navigate: (page: Page) => void }) {
  const [note, setNote] = useState("Subscription signed June 3, 2024.");
  const [saved, setSaved] = useState(note);
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "success">(
    "idle",
  );
  const [fail, setFail] = useState(true);
  const [ein, setEin] = useState("48");
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState("formation");
  const [action, setAction] = useState("");
  const matches = companies.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const save = () => {
    setStatus("saving");
    setTimeout(() => {
      if (fail) setStatus("error");
      else {
        setSaved(note);
        setStatus("success");
      }
    }, 650);
  };
  return (
    <div className="catalogue-grid candidate-examples">
      <Example
        title="Buttons & links"
        components="Button · ButtonLink · TextLink · ActionGroup"
        wide
      >
        <ActionGroup wrap>
          {(["primary", "secondary", "quiet", "plain", "danger"] as const).map(
            (tone) => (
              <Button
                key={tone}
                tone={tone}
                onClick={() => setAction(`${tone} action activated.`)}
              >
                {tone.charAt(0).toUpperCase() + tone.slice(1)}
              </Button>
            ),
          )}
          <Button disabled>Disabled</Button>
          <Button
            size="compact"
            onClick={() => setAction("Compact action activated.")}
          >
            Compact
          </Button>
          <Button
            size="icon"
            aria-label="Add example"
            onClick={() => setAction("Icon action activated.")}
          >
            +
          </Button>
        </ActionGroup>
        <ActionGroup wrap>
          <ButtonLink
            href="#inventory"
            onClick={(e) => {
              e.preventDefault();
              navigate("inventory");
            }}
          >
            Browse inventory
          </ButtonLink>
          <TextLink onClick={() => navigate("foundations")}>
            View foundations
          </TextLink>
        </ActionGroup>
        {action && <FormMessage>{action}</FormMessage>}
      </Example>
      <Example
        title="Fields & validation"
        components="Field · Input · InputGroup · Textarea · FormMessage"
      >
        <Field label="Legal name" variant="filled">
          <Input defaultValue="Northstar SPV I, LLC" />
        </Field>
        <Field
          variant="filled"
          label="EIN last four"
          description={
            ein && !/^\d{4}$/.test(ein)
              ? "Enter four digits, or leave this blank."
              : undefined
          }
        >
          <Input
            value={ein}
            onChange={(e) => setEin(e.target.value)}
            inputMode="numeric"
            maxLength={4}
            aria-invalid={Boolean(ein && !/^\d{4}$/.test(ein))}
          />
        </Field>
        <Field label="Committed capital" variant="filled">
          <InputGroup prefix="$" suffix="USD">
            <Input
              inputMode="numeric"
              defaultValue="50000"
              aria-label="Committed capital in US dollars"
            />
          </InputGroup>
        </Field>
        <Field label="Source" variant="filled">
          <Input readOnly value="Demo subscription agreement" />
        </Field>
        <Field label="Unavailable field" variant="filled">
          <Input disabled value="Waiting for source" />
        </Field>
      </Example>
      <Example
        title="Save, failure & retry"
        components="Textarea · Button · FormMessage · Notice"
      >
        <Field label="Notes" variant="filled">
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setStatus("idle");
            }}
            disabled={status === "saving"}
          />
        </Field>
        <ActionGroup>
          <Button
            aria-pressed={fail}
            onClick={() => setFail(!fail)}
            disabled={status === "saving"}
          >
            Simulate save failure
          </Button>
        </ActionGroup>
        <ActionGroup>
          <Button
            tone="primary"
            onClick={save}
            disabled={note === saved || status === "saving"}
          >
            {status === "saving"
              ? "Saving…"
              : status === "error"
                ? "Try again"
                : "Save changes"}
          </Button>
          <Button
            tone="quiet"
            onClick={() => {
              setNote(saved);
              setStatus("idle");
            }}
            disabled={status === "saving" || note === saved}
          >
            Cancel
          </Button>
        </ActionGroup>
        {status === "error" && (
          <Notice tone="error">
            Couldn’t save your changes. Your edits are still here.
          </Notice>
        )}
        {status === "success" && (
          <FormMessage tone="success">Changes saved.</FormMessage>
        )}
      </Example>
      <CheckboxExample />
      <RadioExample />
      <FieldSaveExample />
      <LoadingExample />
      <Example
        title="Search"
        components="SearchField · SearchHighlight · EmptyState"
      >
        <SearchField
          label="Search companies"
          placeholder="Search companies"
          value={query}
          onValueChange={setQuery}
          resultLabel={`${matches.length} ${matches.length === 1 ? "match" : "matches"}`}
        />
        {matches.length ? (
          <div className="catalogue-stack">
            {matches.map((c) => (
              <p key={c.value}>
                <SearchHighlight query={query}>{c.label}</SearchHighlight>
              </p>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No companies match your search."
            compact
            icon={null}
          />
        )}
      </Example>
      <Example title="Visible alternatives" components="ChoiceGroup">
        <ChoiceGroup
          label="Choose the legal-name source"
          value={choice}
          onValueChange={setChoice}
          options={[
            {
              value: "formation",
              label: "Formation certificate",
              content: "Northstar SPV I, LLC",
            },
            {
              value: "subscription",
              label: "Subscription agreement",
              content: "Northstar SPV 1, LLC",
            },
            {
              value: "statement",
              label: "Latest statement",
              content: "No legal name supplied",
              disabled: true,
            },
          ]}
        />
      </Example>
      <Example
        title="Feedback"
        components="Badge · Notice · FormMessage · EmptyState"
        wide
      >
        <ActionGroup wrap>
          {(
            ["neutral", "accent", "positive", "negative", "warning"] as const
          ).map((tone) => (
            <Badge tone={tone} key={tone}>
              {tone}
            </Badge>
          ))}
        </ActionGroup>
        <Notice>Demo sources</Notice>
        <FormMessage>Ready to edit.</FormMessage>
        <FormMessage tone="error">Enter a legal name.</FormMessage>
        <FormMessage tone="success">Changes saved.</FormMessage>
        <EmptyState
          actions={<TextLink href="/holdings/sources">Manage sources</TextLink>}
          title="No matching sources"
          icon={null}
          compact
        >
          Try another search.
        </EmptyState>
      </Example>
    </div>
  );
}

const sourceSlides = [
  { title: "Formation certificate", date: "May 14, 2024", pages: "2" },
  { title: "Subscription agreement", date: "June 3, 2024", pages: "4" },
  { title: "Quarterly statement", date: "September 30, 2026", pages: "6" },
];

function SourceCarousel() {
  const [api, setApi] = useState<UI.CarouselApi>();
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!api) return;
    const select = () => setCurrent(api.selectedScrollSnap());
    api.on("select", select);
    api.on("reInit", select);
    return () => {
      api.off("select", select);
      api.off("reInit", select);
    };
  }, [api]);
  return (
    <section className="hero hero--carousel">
      <Carousel
        aria-label="Source examples"
        className="hero-carousel"
        setApi={setApi}
      >
        <CarouselContent>
          {sourceSlides.map((source, index) => (
            <CarouselItem
              key={source.title}
              className="hero-carousel__slide"
              aria-hidden={index !== current}
              aria-label={`${index + 1} of ${sourceSlides.length}: ${source.title}`}
            >
              <article className="hero__slide">
                <div>
                  <p className="eyebrow">Northstar SPV I, LLC</p>
                  <h3 className="catalogue-carousel-title">{source.title}</h3>
                  <p className="hero__copy">{source.date}</p>
                </div>
                <div className="hero__runway">
                  <span>Pages</span>
                  <strong>{source.pages}</strong>
                </div>
              </article>
            </CarouselItem>
          ))}
        </CarouselContent>
        <footer className="hero-carousel__footer">
          <CarouselDots
            aria-label="Choose a source"
            getDotLabel={(index) => `Show ${sourceSlides[index]?.title}`}
          />
          <span
            className="visually-hidden"
            aria-live="polite"
            aria-atomic="true"
          >
            Source {current + 1} of {sourceSlides.length}:{" "}
            {sourceSlides[current]?.title}
          </span>
        </footer>
      </Carousel>
    </section>
  );
}

function Display() {
  const [metricMessage, setMetricMessage] = useState("");
  return (
    <div className="catalogue-grid">
      <Example
        title="Facts when labels add meaning"
        components="DataList · DataItem"
      >
        <DataList layout="rows">
          <DataItem label="Previous legal name" value="Northstar SPV 1, LLC" />
          <DataItem label="Accepted legal name" value="Northstar SPV I, LLC" />
        </DataList>
        <UI.Text variant="supporting">
          2 linked sources · 1 reviewed change
        </UI.Text>
        <p className="catalogue-note">
          Use a natural phrase for simple counts. Label/value rows are useful
          when the relationship would otherwise be ambiguous, as above.
        </p>
      </Example>
      <Example title="Reading view" components="Panel · SectionHeader · Text">
        <Panel title="Northstar SPV I, LLC" className="catalogue-reading-view">
          <div className="catalogue-fact-values">
            <UI.Text>Northstar Robotics</UI.Text>
            <UI.Text variant="supporting">Demo Investor</UI.Text>
          </div>
          <UI.Text variant="small" className="catalogue-reading-metadata">
            <span>May 14, 2024 in Delaware, US</span>
            <span aria-hidden="true"> · </span>
            <span>EIN •••4821</span>
          </UI.Text>
        </Panel>
        <p className="catalogue-note">
          A value gets a label only when the surrounding context leaves its
          meaning ambiguous.
        </p>
      </Example>
      <Example
        title="Section heading with total"
        components="SectionHeader · Stat"
        wide
      >
        <SectionHeader
          headingAs="h3"
          title="Cash"
          trailingStat={
            <Stat
              label="Total cash"
              value={formatHoldingsAmount(4_250_000)}
              detail="3 accounts · USD"
            />
          }
        />
        <UI.Text variant="supporting">
          Align the total with the heading on wide screens and below it on
          narrow screens. Keep list controls below the header.
        </UI.Text>
      </Example>
      <Example
        title="Statistics & metrics"
        components="Stat · StatGroup · MetricCard"
        wide
      >
        <StatGroup
          className="goal-signal__stats"
          aria-label="Record statistics"
        >
          <Stat
            label="Linked sources"
            value="2"
            valueFirst
            labelClassName="text-role--supporting"
          />
          <Stat
            label="Reviewed change"
            labelClassName="text-role--supporting"
            detailClassName="text-role--small"
            value="1"
            valueFirst
            detail="Oct 20, 2026"
          />
        </StatGroup>
        <div className="catalogue-metrics">
          <MetricCard label="Documents" value="12" detail="Demo sources" />
          <MetricCard label="Reviewed" value="10" tone="dark" />
          <MetricCard
            label="Needs review"
            value="2"
            tone="accent"
            actionLabel="View examples"
            onClick={() =>
              setMetricMessage(
                "Formation certificate and subscription agreement need comparison.",
              )
            }
          />
        </div>
        {metricMessage && <FormMessage>{metricMessage}</FormMessage>}
      </Example>
      <Example
        title="Chart & tooltip"
        components="ChartContainer · ChartTooltipContent"
        wide
      >
        <ChartContainer
          className="catalogue-chart"
          config={{
            reviewed: { label: "Documents reviewed", color: "var(--ink)" },
          }}
          aria-label="Synthetic reviewed document counts: July 3, August 5, September 8, October 10."
        >
          <AreaChart
            accessibilityLayer
            margin={{ top: 12, right: 16, bottom: 12, left: 0 }}
            data={[
              { month: "Jul", reviewed: 3 },
              { month: "Aug", reviewed: 5 },
              { month: "Sep", reviewed: 8 },
              { month: "Oct", reviewed: 10 },
            ]}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--line-soft)"
              strokeDasharray="2 5"
            />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tickMargin={12}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tickMargin={12}
              width={36}
            />
            <Tooltip
              content={<ChartTooltipContent />}
              isAnimationActive={false}
              cursor={{ stroke: "var(--line)" }}
            />
            <Area
              type="linear"
              dataKey="reviewed"
              stroke="var(--ink)"
              strokeWidth={2.5}
              dot={{
                r: 4,
                fill: "var(--canvas)",
                stroke: "var(--ink)",
                strokeWidth: 2,
              }}
              activeDot={{
                r: 6,
                fill: "var(--ink)",
                stroke: "var(--canvas)",
                strokeWidth: 2,
              }}
              fill="var(--wash)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </Example>
      <Example
        title="Carousel"
        components="Carousel · CarouselContent · CarouselItem · CarouselDots"
        wide
      >
        <SourceCarousel />
        <p className="catalogue-note">
          Use the homepage treatment for a small set of featured items: ink
          background, generous padding, a clear title and supporting detail.
          Navigate with dots, swipe or arrow keys. No automatic rotation or
          previous/next arrows in this pattern.
        </p>
      </Example>
    </div>
  );
}

function Foundations() {
  const colors = [
    ["Ink", "--ink", "Primary text and actions"],
    ["Canvas", "--canvas", "Page surface"],
    ["Muted", "--muted", "Supporting text"],
    ["Faint", "--faint", "Low-emphasis metadata"],
    ["Line", "--line", "Field and control edges"],
    ["Soft line", "--line-soft", "Subtle dividers"],
    ["Wash", "--wash", "Subtle surface fill"],
  ] as const;
  const spaces = Object.entries(CATALOGUE_TOKENS).filter(([name]) =>
    name.startsWith("--space-"),
  );
  return (
    <div className="catalogue-foundations">
      <section>
        <SectionHeader
          title="Color palette"
          description="Keel’s existing ink and canvas, with tonal hierarchy."
        />
        <div className="catalogue-swatches">
          {colors.map(([name, token, role]) => (
            <div key={token}>
              <div
                className="catalogue-swatch"
                style={{ background: `var(${token})` }}
              />
              <strong>{name}</strong>
              <p>{role}</p>
              <code>{CATALOGUE_TOKENS[token]}</code>
            </div>
          ))}
        </div>
        <div className="catalogue-surface-pair">
          <div className="catalogue-surface">
            <strong>Northstar Robotics</strong>
            <p>Supporting information on canvas.</p>
          </div>
          <div className="catalogue-surface catalogue-surface--inverse">
            <strong>Your portfolio</strong>
            <p>Canvas text on an ink surface.</p>
          </div>
        </div>
      </section>
      <section>
        <SectionHeader
          title="Typography"
          description="Inter with system fallbacks. Real component headings alongside the source text tokens."
        />
        <div className="catalogue-type-row">
          <div className="catalogue-type-label">
            Page title<code>{CATALOGUE_TOKENS["--text-title"]} · 600</code>
          </div>
          <div className="catalogue-type-example catalogue-type-example--title">
            <PageHeader title="Your portfolio" />
          </div>
        </div>
        <div className="catalogue-type-row">
          <div className="catalogue-type-label">
            Section heading<code>SectionHeader</code>
          </div>
          <div className="catalogue-type-example">
            <SectionHeader title="Investment details" />
          </div>
        </div>
        <div className="catalogue-type-row">
          <div className="catalogue-type-label">
            Panel heading<code>Panel</code>
          </div>
          <div className="catalogue-type-example">
            <Panel title="Northstar SPV I, LLC" />
          </div>
        </div>
        <div className="catalogue-type-row">
          <div className="catalogue-type-label">
            Body<code>{CATALOGUE_TOKENS["--text-body"]} · 400</code>
          </div>
          <UI.Text>Formed May 14, 2024 in Delaware, US.</UI.Text>
        </div>
        <div className="catalogue-type-row">
          <div className="catalogue-type-label">
            Supporting detail<code>Holding metadata · 13px</code>
          </div>
          <p className="holding-metadata">
            Demo formation certificate · Oct 20, 2026
          </p>
        </div>
        <div className="catalogue-type-row">
          <div className="catalogue-type-label">
            Small token<code>{CATALOGUE_TOKENS["--text-sm"]}</code>
          </div>
          <p className="catalogue-type-small">Source references</p>
        </div>
        <div className="catalogue-type-row">
          <div className="catalogue-type-label">
            Field label<code>{CATALOGUE_TOKENS["--text-xs"]} · 800</code>
          </div>
          <div className="catalogue-type-example">
            <Field label="Tax classification">
              <Input readOnly value="Partnership" />
            </Field>
          </div>
        </div>
      </section>
      <section>
        <SectionHeader
          title="Hierarchy within & between groups"
          description="Type roles explain relationships within a group and between groups; the size scale alone does not."
        />
        <div className="catalogue-hierarchy">
          <div className="catalogue-group-stack">
            <section className="catalogue-fact-group">
              <h3>Legal identity</h3>
              <div className="catalogue-fact-values">
                <p className="catalogue-fact-primary">Northstar SPV I, LLC</p>
                <p>Formed May 14, 2024 · Delaware, US</p>
                <p>EIN ending 4821</p>
              </div>
            </section>
            <section className="catalogue-fact-group">
              <h3>Source</h3>
              <div className="catalogue-fact-values">
                <p className="catalogue-fact-primary">
                  Demo formation certificate
                </p>
                <p className="catalogue-fact-support">
                  Page 1 · Recorded Oct 20, 2026
                </p>
              </div>
            </section>
          </div>
          <div className="catalogue-hierarchy-rules">
            <DataList layout="rows">
              <DataItem
                label="Group heading"
                value="18px / 600 · same role for sibling groups"
              />
              <DataItem
                label="Primary fact"
                value="14px / 600 · the identifying answer"
              />
              <DataItem
                label="Related fact"
                value="14px / 400 · normal reading content"
              />
              <DataItem
                label="Provenance"
                value="13px / 400 · muted supporting detail"
              />
              <DataItem
                label="Auxiliary help"
                value="12px / 400 · never the main task"
              />
            </DataList>
            <p className="catalogue-note">
              Choose h2, h3 or h4 for document structure independently of visual
              size. Keep important caveats and actions at body size. Omit labels
              when the value and group make the meaning clear.
            </p>
          </div>
        </div>
        <p className="catalogue-note">
          A page’s main answer may be more prominent than a heading. This
          compact recipe does not impose a fixed hierarchy on every financial
          summary.
        </p>
      </section>
      <section>
        <SectionHeader
          title="Spacing"
          description="The current 4px scale, shown at its actual size."
        />
        <div className="catalogue-spacing">
          {spaces.map(([name, value]) => (
            <div className="catalogue-spacing-item" key={name}>
              <code>{value}</code>
              <div
                className="catalogue-space-bar"
                style={{ width: `var(${name})` }}
              />
              <span>{name}</span>
            </div>
          ))}
        </div>
        <p className="catalogue-note">
          The hierarchy recipe above applies 8px within related facts, 12px
          after a group heading and 24px between sibling groups.
        </p>
      </section>
      <section>
        <SectionHeader
          title="Surfaces & controls"
          description="Choose the field treatment for the editing context, then use it consistently within that form."
        />
        <div className="catalogue-grid">
          <div className="catalogue-stack">
            <h3>Compact inline editing</h3>
            <p className="catalogue-note">
              Use line fields for a small set of short values edited in place
              beside a record. The underline keeps the control visible without
              adding a filled block.
            </p>
            <Field label="Legal name">
              <Input defaultValue="Northstar SPV I, LLC" />
            </Field>
          </div>
          <div className="catalogue-stack">
            <h3>Dedicated forms & longer text</h3>
            <p className="catalogue-note">
              Use the quiet filled surface when entering or reviewing several
              fields. Multiline text always uses this treatment so the editable
              area is clear.
            </p>
            <Field label="Company" variant="filled">
              <Input defaultValue="Northstar Robotics" />
            </Field>
          </div>
        </div>
        <p className="catalogue-note">
          These are two layout treatments, not editable versus read-only states.
          Do not mix them arbitrarily by field type. Use plain text for facts
          that cannot be edited here.
        </p>
      </section>
      <section>
        <SectionHeader
          title="Selected, unselected, disabled & focused"
          description="This example shows tabs. Their appearance tells you which panel is open and which controls are available."
        />
        <Tabs defaultValue="profile">
          <TabsList aria-label="Foundation tabs" activateOnFocus={false}>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="unavailable" disabled>
              Unavailable
            </TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            <div className="catalogue-fact-values">
              <p className="catalogue-fact-primary">Northstar SPV I, LLC</p>
              <p>Formed May 14, 2024 · Delaware, US</p>
            </div>
          </TabsContent>
          <TabsContent value="history">
            <div className="catalogue-fact-values">
              <p>Legal name updated</p>
              <p className="catalogue-fact-support">Oct 20, 2026, 10:30 AM</p>
            </div>
          </TabsContent>
        </Tabs>
        <dl className="catalogue-state-key">
          <div>
            <dt>Selected</dt>
            <dd>
              Profile starts selected. The dark fill marks the panel currently
              shown.
            </dd>
          </div>
          <div>
            <dt>Unselected</dt>
            <dd>History is available. Selecting it opens that panel.</dd>
          </div>
          <div>
            <dt>Disabled</dt>
            <dd>Unavailable is faded and cannot be selected.</dd>
          </div>
          <div>
            <dt>Keyboard focus</dt>
            <dd>
              An outline marks the control that will receive your next key
              press. It can be focused without being selected.
            </dd>
          </div>
        </dl>
        <p className="catalogue-keyboard-help">
          Try <kbd>Tab</kbd> to focus, arrow keys to move, and <kbd>Enter</kbd>{" "}
          to select. In this example, moving focus does not change the panel
          until you select it.
        </p>
        <p className="catalogue-note">
          Ordinary action buttons do not have a selected state: a dark primary
          button indicates importance, not selection. Toggle buttons can remain
          pressed; disclosures separately show open or closed content.
        </p>
        <p className="catalogue-note">
          Disclosures use the existing 180ms height and 120ms opacity
          transitions. Reduced-motion preferences are respected by the shared
          stylesheet.
        </p>
      </section>
      <section>
        <SectionHeader title="Reading-view rules" />
        <div className="catalogue-stack">
          <p>
            Show each fact once. Let values, hierarchy and context convey
            meaning.
          </p>
          <p>
            Keep labels where they resolve ambiguity. Keep explicit, accessible
            labels in forms.
          </p>
          <p>
            Use whitespace before containers. Reserve badges for meaningful
            exceptions.
          </p>
        </div>
      </section>
      <section>
        <SectionHeader title="Shared library contract" />
        <p className="catalogue-note">
          Current Keel tokens and shared controls. Meaningful values and
          hierarchy replace redundant labels; forms retain accessible labels.
          Source fixtures live in e2e/ui-catalogue and import the production
          library.
        </p>
      </section>
    </div>
  );
}

function Inventory({ navigate }: { navigate: (page: Page) => void }) {
  return (
    <Screen>
      <p>
        Find a component and its examples. This index stays useful as Keel
        grows; the export check catches shared components missing from the
        catalogue.
      </p>
      <p className="catalogue-note">
        {Object.keys(UI).length} exports across {Object.keys(groups).length}{" "}
        groups. An entry confirms a documented use, not complete accessibility
        or state coverage.
      </p>
      <div className="catalogue-inventory">
        {Object.entries(groups).map(([name, g]) => (
          <section key={name}>
            <SectionHeader
              title={name}
              action={
                <TextLink onClick={() => navigate(g.page)}>
                  View examples
                </TextLink>
              }
            />
            <p>{g.names.join(" · ")}</p>
            <p className="catalogue-note">{g.states}</p>
          </section>
        ))}
      </div>
    </Screen>
  );
}

type CataloguePage = Page | "journeys";
function pageFromHash(): CataloguePage {
  if (location.hash.startsWith("#journeys")) return "journeys";
  const hash = location.hash.split("?")[0]!;
  return pages.some((p) => p.id === hash.slice(1))
    ? (hash.slice(1) as Page)
    : hash === "#additions"
      ? "forms"
      : hash === "#audit"
        ? "inventory"
        : "foundations";
}

function App() {
  const [page, setPage] = useState<CataloguePage>(pageFromHash);
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const followLink = () => {
      setPage(pageFromHash());
      setRoute(location.hash);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", followLink);
    return () => window.removeEventListener("hashchange", followLink);
  }, []);
  const navigate = (next: CataloguePage) => {
    setPage(next);
    history.replaceState(null, "", `#${next}`);
    setRoute(`#${next}`);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const component = new URLSearchParams(route.split("?")[1]).get("component");
    if (!component || !catalogued.has(component)) return;
    const card = [
      ...document.querySelectorAll<HTMLElement>(".catalogue-example"),
    ].find((element) =>
      element.dataset.components?.split(" ").includes(component),
    );
    if (card) {
      card.tabIndex = -1;
      card.focus();
      card.scrollIntoView({ block: "start" });
    }
  }, [route]);
  const title =
    page === "journeys" ? "Journeys" : pages.find((p) => p.id === page)!.label;
  return (
    <AppShell
      referenceLabel="Application"
      referenceLinks={[{ href: CATALOGUE_RETURN_URL, label: "Back to Keel" }]}
      activeItemId={page}
      brandMark={<BrandMark />}
      brandName="keel"
      contextName="Demo sources"
      items={[...pages, { id: "journeys", index: "08", label: "Journeys" }]}
      onNavigate={navigate}
      operatorInitials="UI"
      operatorName="Theme & components"
      pageTitle={title}
    >
      <Screen>
        <PageHeader
          title={title}
          description={`Keel @keel/ui · ${CATALOGUE_REVISION} · synthetic browser fixtures`}
        />
        {page === "journeys" ? (
          <Journeys stepId={route.split("/")[1]} />
        ) : page === "collection-loading" ? (
          <CollectionLoading />
        ) : page === "compositions" ? (
          <Compositions />
        ) : page === "interactions" ? (
          <Interactions />
        ) : page === "forms" ? (
          <Forms navigate={navigate} />
        ) : page === "display" ? (
          <Display />
        ) : page === "foundations" ? (
          <Foundations />
        ) : (
          <Inventory navigate={navigate} />
        )}
      </Screen>
    </AppShell>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
