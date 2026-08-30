import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from "embla-carousel-react";
import {
  createContext,
  type ComponentProps,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { cn } from "../lib/utils";
import { Button } from "./button";

export type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugins = UseCarouselParameters[1];

type CarouselProps = {
  opts?: CarouselOptions;
  orientation?: "horizontal" | "vertical";
  plugins?: CarouselPlugins;
  setApi?: (api: CarouselApi) => void;
};

type CarouselContextValue = {
  api: CarouselApi;
  canScrollNext: boolean;
  canScrollPrevious: boolean;
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  orientation: "horizontal" | "vertical";
  scrollNext: () => void;
  scrollPrevious: () => void;
};

const CarouselContext = createContext<CarouselContextValue | null>(null);

function useCarousel() {
  const context = useContext(CarouselContext);

  if (context === null) {
    throw new Error("Carousel controls must be used within a Carousel.");
  }

  return context;
}

export function Carousel({
  children,
  className,
  onKeyDownCapture,
  orientation = "horizontal",
  opts,
  plugins,
  setApi,
  ...props
}: ComponentProps<"div"> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === "horizontal" ? "x" : "y",
    },
    plugins,
  );
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const updateControls = useCallback((carouselApi: CarouselApi) => {
    if (carouselApi === undefined) return;
    setCanScrollPrevious(carouselApi.canScrollPrev());
    setCanScrollNext(carouselApi.canScrollNext());
  }, []);

  const scrollPrevious = useCallback(() => api?.scrollPrev(), [api]);
  const scrollNext = useCallback(() => api?.scrollNext(), [api]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDownCapture?.(event);
      if (event.defaultPrevented) return;

      const previousKey =
        orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
      const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
      if (event.key === previousKey) {
        event.preventDefault();
        scrollPrevious();
      } else if (event.key === nextKey) {
        event.preventDefault();
        scrollNext();
      }
    },
    [onKeyDownCapture, orientation, scrollNext, scrollPrevious],
  );

  useEffect(() => {
    if (api === undefined) return;
    setApi?.(api);
  }, [api, setApi]);

  useEffect(() => {
    if (api === undefined) return;
    api.on("reInit", updateControls);
    api.on("select", updateControls);
    const frame = requestAnimationFrame(() => updateControls(api));

    return () => {
      cancelAnimationFrame(frame);
      api.off("reInit", updateControls);
      api.off("select", updateControls);
    };
  }, [api, updateControls]);

  return (
    <CarouselContext.Provider
      value={{
        api,
        canScrollNext,
        canScrollPrevious,
        carouselRef,
        orientation,
        scrollNext,
        scrollPrevious,
      }}
    >
      <div
        aria-roledescription="carousel"
        className={cn("carousel", className)}
        data-orientation={orientation}
        data-slot="carousel"
        onKeyDownCapture={handleKeyDown}
        role="region"
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  );
}

export function CarouselContent({
  className,
  ...props
}: ComponentProps<"div">) {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div
      className="carousel-viewport"
      data-slot="carousel-content"
      ref={carouselRef}
    >
      <div
        className={cn(
          "carousel-track",
          `carousel-track--${orientation}`,
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CarouselItem({ className, ...props }: ComponentProps<"div">) {
  const { orientation } = useCarousel();

  return (
    <div
      aria-roledescription="slide"
      className={cn(
        "carousel-item",
        `carousel-item--${orientation}`,
        className,
      )}
      data-slot="carousel-item"
      role="group"
      {...props}
    />
  );
}

export function CarouselPrevious({
  children,
  className,
  disabled,
  onClick,
  size = "icon",
  ...props
}: ComponentProps<typeof Button>) {
  const { canScrollPrevious, scrollPrevious } = useCarousel();

  return (
    <Button
      className={cn("carousel-control carousel-control--previous", className)}
      data-slot="carousel-previous"
      disabled={disabled === true || !canScrollPrevious}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) scrollPrevious();
      }}
      size={size}
      {...props}
    >
      {children ?? (
        <>
          <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
            <path d="m10.5 3.5-4.5 4.5 4.5 4.5M6 8h7" />
          </svg>
          <span className="visually-hidden">Previous slide</span>
        </>
      )}
    </Button>
  );
}

export function CarouselNext({
  children,
  className,
  disabled,
  onClick,
  size = "icon",
  ...props
}: ComponentProps<typeof Button>) {
  const { canScrollNext, scrollNext } = useCarousel();

  return (
    <Button
      className={cn("carousel-control carousel-control--next", className)}
      data-slot="carousel-next"
      disabled={disabled === true || !canScrollNext}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) scrollNext();
      }}
      size={size}
      {...props}
    >
      {children ?? (
        <>
          <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
            <path d="m5.5 3.5 4.5 4.5-4.5 4.5M10 8H3" />
          </svg>
          <span className="visually-hidden">Next slide</span>
        </>
      )}
    </Button>
  );
}
