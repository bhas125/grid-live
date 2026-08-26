import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Layers as LayersIcon } from "lucide-react";
import countiesJson from "@/data/counties.json";
import type {
  Alert,
  County,
  CrimeAgencies,
  CrimeAgency,
  CrimeIncident,
  CrimeKind,
  CrimeLayers,
  CrimeWindow,
  ElectYear,
  GeoFeature,
  LayerId,
  Layers,
  Precinct,
  Race,
  RaceLayers,
  RaceSlice,
  TabId,
  WxNow,
  ZipRace,
} from "@/data/types";
import { COUNTY_XY } from "@/lib/county-xy";
import { centroid, countyFipsAt, geomLonLatBBox, nearestCountyName, type MapPin } from "@/lib/geo";
import { filterCrime, isDispatch } from "@/lib/crime-window";
import { prefetchNews } from "@/lib/news-cache";
import { cn } from "@/lib/utils";
import { AddressSearch } from "./address-search";
import { CrimeShare, FeedPanel } from "./feed-panel";
import { LayerToggles } from "./layer-toggles";
import { MarketTicker } from "./market-ticker";
import { DebtClock } from "./debt-clock";
import { FinanceTicker } from "./finance-ticker";
import { TnMap } from "./tn-map";

const COUNTIES = countiesJson as County[];
const BY_FIPS = new Map(COUNTIES.map((c) => [c.fips, c]));

const DEFAULT_LAYERS: Layers = {
  interstates: true,
  weather: false,
  sites: false,
  flock: false,
  cameras: false,
  flights: false,
  p24: false,
  p26: false,
  race: false,
  crime: false,
  house: false,
};

const DEFAULT_CRIME: CrimeLayers = { hom: true, sht: true, h48: false, reg: false };
const DEFAULT_RACE: RaceLayers = { w: true, b: true, h: true, a: true, o: true };
const DEFAULT_AGENCY: CrimeAgencies = { mem: true, nash: true, cha: true, rest: true };

type FeedSize = "hidden" | "dock" | "open";

const zipMem = new Map<string, ZipRace[]>();
const zipWarm = new Set<string>();

function warmZips(fips: string) {
  if (zipMem.has(fips) || zipWarm.has(fips)) return;
  zipWarm.add(fips);
  void fetch(`/zips/${fips}.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((d: ZipRace[]) => {
      zipMem.set(fips, Array.isArray(d) ? d : []);
    })
    .catch(() => undefined)
    .then(() => {
      zipWarm.delete(fips);
    });
}

const FALLBACK_WX: WxNow = { temp: 87, code: 2, label: "MEM · BNA · TYS", live: false };

async function loadWx(lat?: number, lon?: number): Promise<WxNow> {
  const q = lat != null && lon != null ? `?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}` : "";
  try {
    const res = await fetch(`/api/wx${q}`);
    if (!res.ok) return FALLBACK_WX;
    return (await res.json()) as WxNow;
  } catch {
    return FALLBACK_WX;
  }
}

export function GridApp() {
  const [selected, setSelected] = useState<County | null>(null);
  const [tab, setTab] = useState<TabId>("news");
  const [wx, setWx] = useState<WxNow | null>(null);
  const [geo, setGeo] = useState<GeoFeature[] | null>(null);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [precinct, setPrecinct] = useState<Precinct | null>(null);
  const [races, setRaces] = useState<Race[] | undefined>(undefined);
  const [briefs, setBriefs] = useState<Record<string, string>>({});
  const [crime, setCrime] = useState<CrimeIncident[]>([]);
  const [crimeLayers, setCrimeLayers] = useState<CrimeLayers>(DEFAULT_CRIME);
  const [crimeAgency, setCrimeAgency] = useState<CrimeAgencies>(DEFAULT_AGENCY);
  const [crimeWindow, setCrimeWindow] = useState<CrimeWindow>("7d");
  const [feedSize, setFeedSize] = useState<FeedSize>("dock");
  const [layersOpen, setLayersOpen] = useState(true);
  const [pin, setPin] = useState<MapPin | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [focusCrimeId, setFocusCrimeId] = useState<string | null>(null);
  const [electYear, setElectYear] = useState<ElectYear>("2024");
  const [raceLayers, setRaceLayers] = useState<RaceLayers>(DEFAULT_RACE);
  const [zips, setZips] = useState<ZipRace[] | null>(null);
  const [pickedZip, setPickedZip] = useState<string | null>(null);
  const [zipFocus, setZipFocus] = useState<{ lon: number; lat: number } | null>(null);
  const crimeLoaded = useRef(false);

  useEffect(() => {
    fetch("/tn-counties.geojson")
      .then((r) => r.json())
      .then((d: { features: GeoFeature[] }) => setGeo(d.features))
      .catch(() => undefined);
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((d: { alerts?: Alert[] }) => setAlerts(d.alerts ?? []))
      .catch(() => undefined);
    fetch("/tn-briefs.json")
      .then((r) => r.json())
      .then((d: Record<string, string>) => setBriefs(d))
      .catch(() => undefined);
    try {
      const size = sessionStorage.getItem("grid-feed-size");
      if (size === "hidden" || size === "dock" || size === "open") setFeedSize(size);
      else if (sessionStorage.getItem("grid-feed-expanded") === "1") setFeedSize("open");
      const layers = sessionStorage.getItem("grid-layers-open");
      if (layers === "0") setLayersOpen(false);
    } catch {
      /* ignore */
    }
    const idle = window.setTimeout(() => {
      prefetchNews(null);
    }, 2200);
    return () => window.clearTimeout(idle);
  }, []);

  useEffect(() => {
    if (tab !== "crime" && !layers.crime) return;
    let live = true;
    const mergeCad = (next: CrimeIncident[]) => {
      if (!live || !next.length) return;
      setCrime((prev) => {
        const have = new Map(prev.map((r) => [r.id, r]));
        for (const r of next) {
          if (isDispatch(r)) have.set(r.id, r);
          else if (!have.has(r.id)) have.set(r.id, r);
        }
        return [...have.values()];
      });
    };
    const loadSnap = () => {
      fetch("/crime-tn.json")
        .then((r) => r.json())
        .then((d: CrimeIncident[]) => {
          if (!live) return;
          crimeLoaded.current = true;
          const rows = Array.isArray(d) ? d : [];
          setCrime((prev) => {
            const cad = prev.filter(isDispatch);
            return cad.length ? rows.concat(cad) : rows;
          });
        })
        .catch(() => undefined);
    };
    const loadLive = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/crime-live", { signal: AbortSignal.timeout(2800) })
        .then((r) => r.json())
        .then((d: { incidents?: CrimeIncident[] }) => {
          if (live) mergeCad(d.incidents ?? []);
        })
        .catch(() => undefined);
    };
    if (!crimeLoaded.current) {
      crimeLoaded.current = true;
      loadSnap();
    }
    const wait = window.setTimeout(loadLive, 900);
    const poll = window.setInterval(loadLive, 60 * 60_000);
    let waitR = 0;
    try {
      const last = Number(sessionStorage.getItem("grid-crime-refresh") || 0);
      if (Date.now() - last > 24 * 60 * 60_000) {
        waitR = window.setTimeout(() => {
          fetch("/api/crime-refresh", { signal: AbortSignal.timeout(8000) })
            .then((r) => r.json())
            .then(() => {
              try {
                sessionStorage.setItem("grid-crime-refresh", String(Date.now()));
              } catch {
                /* ignore */
              }
              if (live) loadLive();
            })
            .catch(() => undefined);
        }, 8000);
      }
    } catch {
      /* ignore */
    }
    const onVis = () => {
      if (document.visibilityState === "visible") loadLive();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      window.clearTimeout(wait);
      if (waitR) window.clearTimeout(waitR);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tab, layers.crime]);

  useEffect(() => {
    if (!selected || !layers.race) {
      setZips(null);
      return;
    }
    const hit = zipMem.get(selected.fips);
    if (hit) {
      setZips(hit);
      return;
    }
    let live = true;
    setZips(null);
    fetch(`/zips/${selected.fips}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: ZipRace[]) => {
        const rows = Array.isArray(d) ? d : [];
        zipMem.set(selected.fips, rows);
        if (live) setZips(rows);
      })
      .catch(() => {
        if (live) setZips([]);
      });
    return () => {
      live = false;
    };
  }, [selected, layers.race]);

  useEffect(() => {
    let live = true;
    if (!selected) {
      void loadWx().then((w) => {
        if (live) setWx(w);
      });
      return () => {
        live = false;
      };
    }
    const feat = geo?.find((f) => f.properties.fips === selected.fips);
    const pt = pin ?? (feat ? centroid(feat) : { lat: 36.16, lon: -86.78 });
    void loadWx(pt.lat, pt.lon).then((w) => {
      if (live) setWx(w);
    });
    return () => {
      live = false;
    };
  }, [selected, geo, pin]);

  function countyAt(lon: number, lat: number): County | null {
    if (geo) {
      const fips = countyFipsAt(lon, lat, geo);
      if (fips) return BY_FIPS.get(fips) ?? null;
      const hits: County[] = [];
      for (const f of geo) {
        const b = geomLonLatBBox(f.geometry);
        if (!b || lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
        const c = BY_FIPS.get(f.properties.fips);
        if (c) hits.push(c);
      }
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        let best = hits[0];
        let bd = Infinity;
        for (const c of hits) {
          const xy = COUNTY_XY[c.name];
          if (!xy) continue;
          const d = (xy[0] - lat) ** 2 + (xy[1] - lon) ** 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        return best;
      }
    }
    const name = nearestCountyName(lat, lon, COUNTY_XY);
    return COUNTIES.find((c) => c.name === name) ?? null;
  }

  function pickCounty(c: County) {
    if (pin) {
      const at = countyAt(pin.lon, pin.lat);
      if (at?.fips === c.fips) {
        setSelected(c);
        setPrecinct(null);
        setRaces(undefined);
        setPickedZip(null);
        setZipFocus(null);
        setFocusTick((n) => n + 1);
        prefetchNews(c.name, c.seat, c.market);
        return;
      }
    }
    setPin(null);
    setSelected(c);
    setTab((t) => (t === "crime" || t === "sit" || t === "vote" || t === "gov" ? t : "news"));
    setPrecinct(null);
    setRaces(undefined);
    setPickedZip(null);
    setZipFocus(null);
    prefetchNews(c.name, c.seat, c.market);
  }

  function goToPlace(hit: MapPin & { county?: string }) {
    const county = hit.county ? (COUNTIES.find((c) => c.name === hit.county) ?? null) : countyAt(hit.lon, hit.lat);
    setPin({ lat: hit.lat, lon: hit.lon, label: hit.label });
    setFocusTick((n) => n + 1);
    if (county) {
      setSelected(county);
      setPrecinct(null);
      setRaces(undefined);
      setPickedZip(null);
      setZipFocus(null);
      prefetchNews(county.name, county.seat, county.market);
    }
  }

  function goToIncident(c: CrimeIncident) {
    goToPlace({
      lat: c.lat,
      lon: c.lon,
      label: c.address || c.type,
      county: c.county,
    });
    setTab("crime");
    setFocusCrimeId(c.id);
  }

  function backToState() {
    setSelected(null);
    setPin(null);
    setPrecinct(null);
    setRaces(undefined);
    setPickedZip(null);
    setZipFocus(null);
    setTab((t) => (t === "crime" ? "crime" : "news"));
  }

  function clearPin() {
    setPin(null);
    setFocusCrimeId(null);
    setFocusTick((n) => n + 1);
  }

  function pickPrecinct(p: Precinct, next?: Race[]) {
    setPrecinct(p);
    setRaces(next);
    setElectYear("2024");
    setTab("vote");
    setLayers((prev) => ({ ...prev, p24: true, p26: false }));
  }

  function handleTab(t: TabId) {
    if (t === "crime") {
      setCrimeLayers(DEFAULT_CRIME);
      setLayers((prev) => ({
        ...prev,
        crime: true,
        p24: false,
        p26: false,
      }));
    } else {
      setLayers((prev) => {
        if (t === "vote") {
          return { ...prev, p24: electYear === "2024", p26: electYear === "2026" };
        }
        if (prev.p24 || prev.p26) return { ...prev, p24: false, p26: false };
        return prev;
      });
    }
    setTab(t);
  }

  function pickZip(z: ZipRace) {
    setPickedZip(z.z);
  }

  function handleElectYear(y: ElectYear) {
    setElectYear(y);
    setLayers((prev) => ({ ...prev, p24: y === "2024", p26: y === "2026" }));
    if (y === "2026") {
      setPrecinct(null);
      setRaces(undefined);
    }
  }

  function toggleCrime(kind: CrimeKind) {
    setCrimeLayers((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  function toggleAgency(id: CrimeAgency) {
    setCrimeAgency((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const visibleCrime = useMemo(
    () =>
      filterCrime(crime, {
        window: crimeWindow,
        agency: crimeAgency,
        includeGva: crimeWindow === "ytd",
      }),
    [crime, crimeWindow, crimeAgency],
  );

  function toggle(id: LayerId) {
    if (id === "race" && layers.race) {
      setPickedZip(null);
      setZipFocus(null);
    }
    if (id === "crime" && !layers.crime) setTab("crime");
    setLayers((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleRace(id: RaceSlice) {
    setRaceLayers((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setFeed(next: FeedSize) {
    setFeedSize(next);
    try {
      sessionStorage.setItem("grid-feed-size", next);
    } catch {
      /* ignore */
    }
  }

  function toggleLayersOpen(next?: boolean) {
    setLayersOpen((v) => {
      const on = next ?? !v;
      try {
        sessionStorage.setItem("grid-layers-open", on ? "1" : "0");
      } catch {
        /* ignore */
      }
      return on;
    });
  }

  function toggleFeed() {
    setFeed(feedSize === "open" ? "dock" : "open");
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-fg">
      <header className="shrink-0 py-3 pr-2 pl-4 sm:pr-3 sm:pl-6">
        <div className="flex items-start justify-between gap-3">
        <div>
          {selected ? (
            <button
              type="button"
              onClick={backToState}
              className="flex h-11 items-center gap-2 text-fg hover:opacity-80"
              aria-label="Back to state"
            >
              <ArrowLeft className="size-5" />
              <span className="font-display text-3xl leading-none font-semibold tracking-wide uppercase">
                {selected.name}
              </span>
            </button>
          ) : (
            <div className="flex h-11 items-center gap-3">
              <span className="grid grid-cols-2 gap-px" aria-hidden="true">
                <span className="size-1.5 bg-grid shadow-glow" />
                <span className="size-1.5 bg-grid/40" />
                <span className="size-1.5 bg-grid/40" />
                <span className="size-1.5 bg-grid shadow-glow" />
              </span>
              <h1 className="font-display text-3xl leading-none font-semibold tracking-[0.18em]">
                GRID
              </h1>
            </div>
          )}
          <p className="font-mono text-xs tracking-widest text-faint uppercase">
            {selected ? `${selected.seat} · ${selected.division}` : "Tennessee"}
          </p>
          <div className="relative mt-1 flex flex-col items-start">
            <AddressSearch pin={pin} onGo={goToPlace} onClear={clearPin} />
            <button
              type="button"
              onClick={() => toggleLayersOpen()}
              aria-pressed={layersOpen}
              aria-label={layersOpen ? "Collapse layers" : "Show layers"}
              title="Layers"
              className={cn(
                "grid size-8 place-items-center hover:text-fg",
                layersOpen ? "text-grid" : "text-faint hover:text-grid",
              )}
            >
              <LayersIcon className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end text-right">
          {wx ? (
            <>
              <div className="font-display text-4xl leading-none tabular">{wx.temp}°</div>
              <div className="mt-0.5 font-mono text-xs tracking-widest text-faint uppercase">
                {wx.label}
              </div>
            </>
          ) : (
            <div className="h-10 w-16 animate-pulse bg-elevated/80" />
          )}
          <div className={selected ? "hidden w-48" : "w-48"}>
            <MarketTicker active={!selected} />
            <DebtClock />
            <FinanceTicker active={!selected} />
          </div>
        </div>
        </div>
      </header>
      <div className={layersOpen || feedSize === "open" ? "shrink-0 px-2 pb-1 sm:px-3" : "hidden"}>
        {feedSize === "open" ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={toggleFeed}
              aria-expanded="true"
              aria-label="Minimize panel"
              title="Minimize"
              className="grid size-8 place-items-center text-grid hover:text-fg"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
        ) : null}
        {layersOpen ? (
          <LayerToggles
            layers={layers}
            onToggle={toggle}
            raceLayers={raceLayers}
            onToggleRace={toggleRace}
            crimeLayers={crimeLayers}
            onToggleCrime={toggleCrime}
            crimeAgency={crimeAgency}
            onToggleAgency={toggleAgency}
            crimeWindow={crimeWindow}
            onCrimeWindow={setCrimeWindow}
          />
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <TnMap
          geo={geo}
          selected={selected}
          onSelect={pickCounty}
          onPickPrecinct={pickPrecinct}
          pickedId={precinct?.id ?? null}
          layers={layers}
          alerts={alerts}
          crime={visibleCrime}
          showCrime={layers.crime}
          crimeLayers={crimeLayers}
          showSor={layers.crime && crimeLayers.reg}
          pin={pin}
          onClearPin={clearPin}
          focusTick={focusTick}
          focusCrimeId={focusCrimeId}
          showZips={!!selected && layers.race}
          zips={zips ?? []}
          raceLayers={raceLayers}
          pickedZip={pickedZip}
          onPickZip={pickZip}
          onWarmZips={layers.race ? warmZips : undefined}
          focusZip={zipFocus}
          feedHidden={feedSize === "hidden"}
        />
        {feedSize === "hidden" ? (
          <button
            type="button"
            onClick={() => setFeed("dock")}
            aria-label="Show panel"
            title="Show panel"
            className="absolute bottom-2 left-1/2 z-30 grid size-8 -translate-x-1/2 place-items-center border border-line bg-elevated/90 text-grid hover:border-grid"
          >
            <ChevronUp className="size-3.5" />
          </button>
        ) : null}
      </div>
      {selected && layers.crime && feedSize !== "hidden" ? (
        <CrimeShare county={selected} incidents={visibleCrime} layers={crimeLayers} />
      ) : null}
      {feedSize === "hidden" ? null : (
      <FeedPanel
        county={selected}
        tab={tab}
        onTab={handleTab}
        alerts={alerts}
        precinct={precinct}
        races={races}
        briefs={briefs}
        expanded={feedSize === "open"}
        onToggleExpand={toggleFeed}
        onHide={() => setFeed("hidden")}
        crime={visibleCrime}
        crimeLayers={crimeLayers}
        onPickCrime={goToIncident}
        electYear={electYear}
        onElectYear={handleElectYear}
        raceOn={layers.race}
        raceLayers={raceLayers}
        zips={zips}
        pickedZip={pickedZip}
        onPickZip={pickZip}
      />
      )}
    </div>
  );
}
