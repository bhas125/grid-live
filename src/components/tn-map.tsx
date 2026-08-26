import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus, X } from "lucide-react";
import countiesJson from "@/data/counties.json";
import roadsJson from "@/data/roads.json";
import sitesJson from "@/data/sites.json";
import { popWeight } from "@/data/intel";
import { isFresh48 } from "@/lib/crime-fresh";
import { clusterXY } from "@/lib/crime-cluster";
import { hdLine, houseAtLonLat } from "@/lib/house-at";
import {
  crimeLabel,
  inferGeo,
  isDenseCounty,
  isDispatch,
  isHomicide,
  isImprecise,
  isShooting,
} from "@/lib/crime-window";
import type {
  Alert,
  AlprPoint,
  County,
  CrimeIncident,
  CrimeKind,
  CrimeLayers,
  CrimeNames,
  CrimePerson,
  Flight,
  GeoFeature,
  HouseDistrict,
  Layers,
  Precinct,
  Race,
  RaceLayers,
  RaceSlice,
  Road,
  Site,
  SorPerson,
  SorPoint,
  TrafficCam,
  ZipRace,
} from "@/data/types";
import { RACE_META } from "@/data/types";
import { prefetchNews } from "@/lib/news-cache";
import { fetchCrimeNames, readCrimeNames } from "@/lib/crime-names";
import { CamPlayer } from "./cam-player";
import { WxSky, wxHint } from "./wx-sky";
import {
  FULL_VIEW,
  MAP_H,
  MAP_W,
  easeOutCubic,
  featureBounds,
  lonLatIn,
  makeProject,
  makeUnproject,
  pathFromGeom,
  pathFromPts,
  pointInGeom,
  shortPinLabel,
  viewAround,
  type BBox,
  type MapPin,
  type ViewBox,
} from "@/lib/geo";
import { tilesForView } from "@/lib/map-tiles";
import { zipTone } from "@/lib/race-tone";
import { cn } from "@/lib/utils";

const COUNTIES = countiesJson as County[];
const ROADS = roadsJson as Road[];
const SITES = sitesJson as Site[];
const BY_FIPS = new Map(COUNTIES.map((c) => [c.fips, c]));

const overlayMem: {
  alpr: AlprPoint[] | null;
  cams: TrafficCam[] | null;
  sor: SorPoint[] | null;
  house: HouseDistrict[] | null;
} = { alpr: null, cams: null, sor: null, house: null };

function hdFor(c: CrimeIncident) {
  const list = overlayMem.house;
  if (!list?.length) return null;
  const h = houseAtLonLat(list, c.lon, c.lat);
  return h ? hdLine(h) : null;
}

const TIP_W = 224;
const TIP_GAP = 28;
const ZOOM_IN = 1 / 1.55;
const ZOOM_OUT = 1.55;
const MAX_ZOOM = 40;
const CRIME_CAP = 720;
const ALPR_CAP = 420;
const CAM_CAP = 560;
const SOR_CAP = 900;

type XY = { x: number; y: number };
type CrimePt = CrimeIncident & XY;
type AlprPt = AlprPoint & XY;
type CamPt = TrafficCam & XY;
type SorPt = SorPoint & XY;
type HousePt = {
  d: number;
  n: string;
  p: string;
  x: number;
  y: number;
  ring: XY[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function pip(x: number, y: number, ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const dy = b.y - a.y;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (dy || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

type ZipPt = {
  z: ZipRace;
  rings: XY[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function geomRings(geom: GeoFeature["geometry"], project: (lon: number, lat: number) => XY): XY[][] {
  const rings: XY[][] = [];
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates as number[][][]) {
      if (ring.length > 2) rings.push(ring.map(([lon, lat]) => project(lon, lat)));
    }
  } else {
    for (const poly of geom.coordinates as number[][][][]) {
      for (const ring of poly) {
        if (ring.length > 2) rings.push(ring.map(([lon, lat]) => project(lon, lat)));
      }
    }
  }
  return rings;
}

function pipZip(x: number, y: number, rings: XY[][]) {
  if (!rings[0] || !pip(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pip(x, y, rings[i])) return false;
  }
  return true;
}

type Hit = {
  title: string;
  lines: string[];
  x: number;
  y: number;
  r: number;
  crime?: CrimeIncident;
  cam?: TrafficCam;
  sor?: SorPoint;
  flight?: Flight;
  cluster?: { x: number; y: number; n: number };
};

type Tip = {
  title: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
};

function tipStyle(t: Tip) {
  const h = 36 + t.lines.length * 16;
  const leftSide = t.x >= t.w * 0.5;
  const topHalf = t.y < t.h * 0.45;
  return {
    left: leftSide
      ? Math.max(8, t.x - TIP_W - TIP_GAP)
      : Math.min(t.x + TIP_GAP, t.w - TIP_W - 8),
    top: topHalf ? Math.min(t.y + TIP_GAP, t.h - h - 8) : Math.max(8, t.y - h - TIP_GAP),
    width: TIP_W,
  };
}

function fillColor(pop: number, selected: boolean, dim: boolean, alert: boolean, street: boolean) {
  if (dim) return "#03050c";
  const w = popWeight(pop);
  if (street && selected) {
    return "transparent";
  }
  if (alert) {
    return `color-mix(in oklab, var(--color-watch) ${Math.round((0.28 + w * 0.25) * 100)}%, #020308)`;
  }
  if (selected) {
    return `color-mix(in oklab, var(--color-grid) ${Math.round((0.22 + w * 0.35) * 100)}%, #020308)`;
  }
  const a = 0.06 + w * 0.28;
  return `color-mix(in oklab, var(--color-grid) ${Math.round(a * 100)}%, #020308)`;
}

function zipHud(z: ZipRace, layers: RaceLayers) {
  const short: Record<RaceSlice, string> = { w: "W", b: "B", h: "H", a: "A", o: "O" };
  const bits = RACE_META.filter((s) => layers[s.id]).map((s) => {
    const pct = z.t ? Math.round((z[s.id] / z.t) * 100) : 0;
    return `${short[s.id]} ${pct}%`;
  });
  return {
    a: `ZIP ${z.z} · ${z.t.toLocaleString()} people`,
    b: bits.join(" · ") || "No groups on",
  };
}

function kindOf(type: string): CrimeKind | null {
  if (type === "Dispatch") return null;
  if (isHomicide(type)) return "hom";
  if (isShooting(type)) return "sht";
  return null;
}

function fmtCrimeDate(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m) - 1];
  if (!month || !d) return iso;
  return `${month} ${Number(d)} ${y}`;
}

function crimeZip(c: CrimeIncident) {
  if (c.zip) return c.zip;
  const m = (c.address || "").match(/\b(3[7-8]\d{3})\b/);
  return m?.[1] ?? "";
}

function personLine(p: CrimePerson) {
  const age = p.age != null ? `, ${p.age}` : "";
  return `${p.name}${age}`;
}

function sorTip(k: SorPoint["k"]) {
  if (k === "V") return "Violent";
  if (k === "C") return "Against children";
  return "Sexual offender";
}

function nearPin(lat: number, lon: number, pin: MapPin | null, deg = 0.08) {
  if (!pin) return true;
  const dlat = lat - pin.lat;
  const dlon = lon - pin.lon;
  return dlat * dlat + dlon * dlon <= deg * deg;
}

function crimeTipLines(c: CrimeIncident) {
  const lines: string[] = [];
  const when = fmtCrimeDate(c.date);
  if (when) lines.push(when);
  lines.push(c.address || `${c.city}, ${c.county} County`);
  const zip = crimeZip(c);
  if (zip) lines.push(`ZIP ${zip}`);
  return lines;
}

function crimeHud(c: CrimeIncident) {
  const when = fmtCrimeDate(c.date);
  const where = c.address || [c.city, c.county ? `${c.county} County` : ""].filter(Boolean).join(", ");
  const zip = crimeZip(c);
  const geo = inferGeo(c);
  const tag = isDispatch(c) ? "Dispatch" : crimeLabel(c.type);
  const fuzzy = isImprecise(geo) ? geo : "";
  return {
    a: `${tag}${when ? ` · ${when}` : ""}${fuzzy ? ` · ${fuzzy}` : ""}`,
    b: zip ? `${where} · ${zip}` : where,
  };
}

function flightHud(f: Flight) {
  const alt = f.ground || f.alt == null ? "On ground" : `${Math.round(f.alt).toLocaleString()} ft`;
  const spd = f.gs ? `${Math.round(f.gs)} kt` : "";
  const hdg = f.gs || !f.ground ? `HDG ${String(Math.round(f.hdg) % 360).padStart(3, "0")}` : "";
  const bits = [alt, spd, hdg].filter(Boolean);
  const who = [f.call, f.ac || f.reg].filter(Boolean).join(" · ");
  return { a: who, b: bits.join(" · ") };
}

function deadReckon(f: Flight, now: number) {
  const dt = Math.min(14, Math.max(0, (now - f.at) / 1000));
  if (f.ground || f.gs < 4 || dt === 0) return { lat: f.lat, lon: f.lon };
  const rad = (f.hdg * Math.PI) / 180;
  const nm = (f.gs / 3600) * dt;
  return {
    lat: f.lat + (nm * Math.cos(rad)) / 60,
    lon: f.lon + (nm * Math.sin(rad)) / (60 * Math.max(0.2, Math.cos((f.lat * Math.PI) / 180))),
  };
}

function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hdg: number,
  size: number,
) {
  const rad = (hdg * Math.PI) / 180;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.72, size * 0.95);
  ctx.lineTo(0, size * 0.38);
  ctx.lineTo(-size * 0.72, size * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function camHref(id: number) {
  return `https://smartway.tn.gov/allcams/camera/${id}`;
}

function camTipLines(c: TrafficCam) {
  const lines: string[] = ["TDOT SmartWay"];
  const loc = camMeta(c);
  if (loc) lines.push(loc);
  lines.push(`${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`);
  return lines;
}

function camMeta(c: TrafficCam) {
  const bits: string[] = [];
  const title = c.title.toLowerCase();
  if (c.route && !title.includes(c.route.toLowerCase())) bits.push(c.route);
  const mile = Number(c.mile);
  if (c.mile && mile > 0 && mile < 500 && !/\bmm\s*\d/i.test(c.title)) bits.push(`MM ${c.mile}`);
  if (c.city) bits.push(c.city);
  return bits.join(" · ");
}

function roadsInView(view: BBox | null) {
  if (!view) return ROADS;
  return ROADS.filter((r) => r.pts.some(([lon, lat]) => lonLatIn(view, lon, lat)));
}

function countyFit(feat: GeoFeature, project: (lon: number, lat: number) => { x: number; y: number }): ViewBox {
  const b = featureBounds(feat, project);
  const i = Math.max(b.maxX - b.minX, 8);
  const a = Math.max(b.maxY - b.minY, 8);
  const pad = Math.max(i, a) * 0.07;
  return { x: b.minX - pad, y: b.minY - pad, w: i + pad * 2, h: a + pad * 2 };
}

function clampView(next: ViewBox, fit: ViewBox): ViewBox {
  const minW = fit.w / MAX_ZOOM;
  const minH = fit.h / MAX_ZOOM;
  const w = Math.min(fit.w, Math.max(minW, next.w));
  const h = Math.min(fit.h, Math.max(minH, next.h));
  const x = Math.min(fit.x + fit.w - w, Math.max(fit.x, next.x));
  const y = Math.min(fit.y + fit.h - h, Math.max(fit.y, next.y));
  return { x, y, w, h };
}

function viewScale(box: { width?: number; height?: number; w?: number; h?: number }, view: ViewBox) {
  const width = box.width ?? box.w ?? 1;
  const height = box.height ?? box.h ?? 1;
  const s = Math.min(width / view.w, height / view.h);
  return {
    s,
    ox: (width - view.w * s) / 2,
    oy: (height - view.h * s) / 2,
  };
}

function ringBBox(geom: GeoFeature["geometry"]): BBox | null {
  const rings =
    geom.type === "Polygon"
      ? (geom.coordinates as number[][][])
      : (geom.coordinates as number[][][][]).flat();
  if (!rings?.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minX) minX = lon;
      if (lat < minY) minY = lat;
      if (lon > maxX) maxX = lon;
      if (lat > maxY) maxY = lat;
    }
  }
  return { minX, minY, maxX, maxY };
}

export function TnMap({
  geo,
  selected,
  onSelect,
  onPickPrecinct,
  pickedId,
  layers,
  alerts,
  crime,
  showCrime,
  crimeLayers,
  showSor,
  pin,
  onClearPin,
  focusTick,
  focusCrimeId,
  showZips = false,
  zips = [],
  raceLayers,
  pickedZip = null,
  onPickZip,
  onWarmZips,
  focusZip = null,
  feedHidden = false,
}: {
  geo: GeoFeature[] | null;
  selected: County | null;
  onSelect: (c: County) => void;
  onPickPrecinct: (p: Precinct, races?: Race[]) => void;
  pickedId: string | null;
  layers: Layers;
  alerts: Alert[];
  crime: CrimeIncident[];
  showCrime: boolean;
  crimeLayers: CrimeLayers;
  showSor: boolean;
  pin: MapPin | null;
  onClearPin?: () => void;
  focusTick: number;
  focusCrimeId: string | null;
  showZips?: boolean;
  zips?: ZipRace[];
  raceLayers?: RaceLayers;
  pickedZip?: string | null;
  onPickZip?: (z: ZipRace) => void;
  onWarmZips?: (fips: string) => void;
  focusZip?: { lon: number; lat: number } | null;
  feedHidden?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const [tip, setTip] = useState<Tip | null>(null);
  const [hoverZip, setHoverZip] = useState<{ a: string; b: string } | null>(null);
  const [hoverCrime, setHoverCrime] = useState<{ a: string; b: string } | null>(null);
  const [hoverFlight, setHoverFlight] = useState<{ a: string; b: string } | null>(null);
  const [hoverHouse, setHoverHouse] = useState<{ a: string; b: string } | null>(null);
  const [house, setHouse] = useState<HouseDistrict[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [picked, setPicked] = useState<{
    crime: CrimeIncident;
    names: CrimeNames | null | undefined;
    hd: string | null;
  } | null>(null);
  const [pickedCam, setPickedCam] = useState<TrafficCam | null>(null);
  const [pickedSor, setPickedSor] = useState<{ point: SorPoint; person: SorPerson | null | undefined } | null>(null);
  const [sor, setSor] = useState<SorPoint[]>([]);
  const skipSelect = useRef(false);
  const stealClick = useRef(false);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [alpr, setAlpr] = useState<AlprPoint[]>([]);
  const [cams, setCams] = useState<TrafficCam[]>([]);
  const [precincts, setPrecincts] = useState<Precinct[]>([]);
  const [races, setRaces] = useState<Record<string, Race[]>>({});
  const [view, setView] = useState(FULL_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitRef = useRef<ViewBox>(FULL_VIEW);
  const raf = useRef<number | null>(null);
  const drawRaf = useRef<number | null>(null);
  const commitTimer = useRef<number | null>(null);
  const hits = useRef<Hit[]>([]);
  const busy = useRef(false);
  const pickedHdRef = useRef<HouseDistrict | null>(null);
  const pinEl = useRef<HTMLDivElement>(null);
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const tileHost = useRef<HTMLDivElement>(null);
  const tileImgs = useRef(new Map<string, HTMLImageElement>());
  const [streets, setStreets] = useState(false);

  const project = useMemo(() => (geo ? makeProject(geo, MAP_W, MAP_H) : null), [geo]);
  const unproject = useMemo(() => (geo ? makeUnproject(geo, MAP_W, MAP_H) : null), [geo]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const unprojectRef = useRef(unproject);
  unprojectRef.current = unproject;

  useEffect(() => {
    if (!layers.flock) return;
    if (overlayMem.alpr) {
      setAlpr(overlayMem.alpr);
      return;
    }
    let live = true;
    fetch("/alpr-tn.json")
      .then((r) => r.json())
      .then((d: AlprPoint[]) => {
        overlayMem.alpr = Array.isArray(d) ? d : [];
        if (live) setAlpr(overlayMem.alpr);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [layers.flock]);

  useEffect(() => {
    if (!layers.house && !showCrime) return;
    if (overlayMem.house) {
      if (layers.house) setHouse(overlayMem.house);
      return;
    }
    let live = true;
    fetch("/house-tn.json")
      .then((r) => r.json())
      .then((d: HouseDistrict[]) => {
        overlayMem.house = Array.isArray(d) ? d : [];
        if (live && layers.house) setHouse(overlayMem.house);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [layers.house, showCrime]);

  useEffect(() => {
    if (!layers.cameras) return;
    if (overlayMem.cams) {
      setCams(overlayMem.cams);
      return;
    }
    let live = true;
    fetch("/tdot-cameras.json")
      .then((r) => r.json())
      .then((d: TrafficCam[]) => {
        overlayMem.cams = Array.isArray(d) ? d : [];
        if (live) setCams(overlayMem.cams);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [layers.cameras]);

  useEffect(() => {
    if (!layers.flights) {
      setHoverFlight(null);
      setFlights([]);
      return;
    }
    let live = true;
    const pull = () => {
      fetch("/api/flights")
        .then((r) => (r.ok ? r.json() : { flights: [] }))
        .then((d: { flights?: Flight[] }) => {
          if (!live) return;
          const next = Array.isArray(d.flights) ? d.flights : [];
          const now = Date.now();
          setFlights((prev) => {
            const fresh = new Map(next.map((f) => [f.id, { ...f, at: now }]));
            for (const f of prev) {
              if (!fresh.has(f.id) && now - f.at < 22_000) fresh.set(f.id, f);
            }
            return [...fresh.values()];
          });
        })
        .catch(() => undefined);
    };
    pull();
    const tick = window.setInterval(pull, 8_000);
    return () => {
      live = false;
      window.clearInterval(tick);
    };
  }, [layers.flights]);

  useEffect(() => {
    if (!showSor) return;
    if (overlayMem.sor) {
      setSor(overlayMem.sor);
      return;
    }
    let live = true;
    fetch("/sor-tn.json")
      .then((r) => r.json())
      .then((d: SorPoint[]) => {
        overlayMem.sor = Array.isArray(d) ? d : [];
        if (live) setSor(overlayMem.sor);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [showSor]);

  useEffect(() => {
    if (!selected || !layers.p24) {
      setPrecincts([]);
      setRaces({});
      return;
    }
    let live = true;
    fetch(`/precincts/${selected.fips}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Precinct[]) => {
        if (live) setPrecincts(d);
      })
      .catch(() => {
        if (live) setPrecincts([]);
      });
    fetch(`/precincts/${selected.fips}-races.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: Record<string, Race[]>) => {
        if (live) setRaces(d);
      })
      .catch(() => {
        if (live) setRaces({});
      });
    return () => {
      live = false;
    };
  }, [selected, layers.p24]);

  const paths = useMemo(() => {
    if (!geo || !project) return [];
    return geo.map((f) => ({
      fips: f.properties.fips,
      feature: f,
      d: pathFromGeom(f.geometry, project),
    }));
  }, [geo, project]);

  const zipPts = useMemo(() => {
    if (!showZips || !project || !zips.length) return [] as ZipPt[];
    return zips.map((z) => {
      const rings = geomRings(z.g, project);
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const ring of rings) {
        for (const p of ring) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      return { z, rings, minX, minY, maxX, maxY };
    });
  }, [showZips, project, zips]);
  const zipPtsRef = useRef(zipPts);
  zipPtsRef.current = zipPts;
  const countyClipRef = useRef("");
  const countyGeomRef = useRef<GeoFeature["geometry"] | null>(null);
  countyClipRef.current = selected ? (paths.find((p) => p.fips === selected.fips)?.d ?? "") : "";
  countyGeomRef.current = selected ? (paths.find((p) => p.fips === selected.fips)?.feature.geometry ?? null) : null;

  useEffect(() => {
    if (!pickedZip || !showZips) return;
    const row = zipPts.find((r) => r.z.z === pickedZip);
    if (!row) return;
    const layersOn = raceLayers ?? { w: false, b: false, h: false, a: false, o: false };
    setHoverZip(zipHud(row.z, layersOn));
  }, [pickedZip, showZips, zipPts, raceLayers]);

  function showTip(e: React.MouseEvent, title: string, lines: string[]) {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    setTip({
      title,
      lines,
      x: e.clientX - box.left,
      y: e.clientY - box.top,
      w: box.width,
      h: box.height,
    });
  }

  const crimePts = useMemo(() => {
    if (!project || !showCrime) return [] as CrimePt[];
    let rows = crime;
    if (!crimeLayers.hom && !crimeLayers.sht && !crimeLayers.h48) {
      rows = rows.filter((c) => isDispatch(c) && (!selected || c.county === selected.name));
    } else {
      rows = rows.filter((c) => {
        if (isDispatch(c)) return !selected || c.county === selected.name;
        if (!(c.date ?? "").startsWith("2026")) return false;
        if (c.source === "News") {
          const t = `${c.address ?? ""} ${c.offense ?? ""}`;
          if (/\b2025\b|\b2024\b/.test(t) && !/\b2026\b/.test(t)) return false;
        }
        if (selected && c.county !== selected.name) return false;
        const k = kindOf(c.type);
        if (!k) return false;
        const fresh = isFresh48(c.date);
        if (crimeLayers.h48 && fresh) return true;
        if (k === "hom") return crimeLayers.hom;
        if (k === "sht") return crimeLayers.sht;
        return false;
      });
    }
    if (pin) rows = rows.filter((c) => nearPin(c.lat, c.lon, pin));
    return rows.map((c) => {
      const p = project(c.lon, c.lat);
      return { ...c, x: p.x, y: p.y };
    });
  }, [project, crime, showCrime, crimeLayers, pin, selected]);
  const crimePtsRef = useRef(crimePts);
  crimePtsRef.current = crimePts;

  const visibleRoads = useMemo(() => {
    if (!project) return [];
    if (!selected) return ROADS;
    const feat = paths.find((p) => p.fips === selected.fips);
    if (!feat) return [];
    const box = ringBBox(feat.feature.geometry);
    return roadsInView(box);
  }, [project, selected, paths]);

  const housePts = useMemo(() => {
    if (!project || !layers.house || !house.length) return [] as HousePt[];
    return house.map((h) => {
      const ring = (h.g[0] ?? []).map(([lon, lat]) => project(lon, lat));
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of ring) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      const c = project(h.x, h.y);
      return { d: h.d, n: h.n, p: h.p, x: c.x, y: c.y, ring, minX, minY, maxX, maxY };
    });
  }, [project, layers.house, house]);
  const housePtsRef = useRef(housePts);
  housePtsRef.current = housePts;

  const sitePts = useMemo(() => {
    if (!project) return [];
    return SITES.filter((s) => !selected || s.county === selected.name).map((s) => ({
      ...s,
      ...project(s.lon, s.lat),
    }));
  }, [project, selected]);

  const sitePtsRef = useRef(sitePts);
  sitePtsRef.current = sitePts;
  const alprPts = useMemo(() => {
    if (!project || !layers.flock || !alpr.length) return [] as AlprPt[];
    let pts = alpr;
    if (!selected) {
      pts = alpr.filter((_, i) => i % 8 === 0);
    } else {
      const feat = paths.find((p) => p.fips === selected.fips);
      const box = feat ? ringBBox(feat.feature.geometry) : null;
      if (box) pts = alpr.filter((p) => p.lon >= box.minX && p.lon <= box.maxX && p.lat >= box.minY && p.lat <= box.maxY);
    }
    return pts.map((p) => ({ ...p, ...project(p.lon, p.lat) }));
  }, [project, alpr, selected, paths, layers.flock]);
  const alprPtsRef = useRef(alprPts);
  alprPtsRef.current = alprPts;

  const camPts = useMemo(() => {
    if (!project || !layers.cameras || !cams.length) return [] as CamPt[];
    let pts = cams;
    if (selected) {
      const feat = paths.find((p) => p.fips === selected.fips);
      const box = feat ? ringBBox(feat.feature.geometry) : null;
      if (box) pts = cams.filter((p) => p.lon >= box.minX && p.lon <= box.maxX && p.lat >= box.minY && p.lat <= box.maxY);
    }
    return pts.map((p) => ({ ...p, ...project(p.lon, p.lat) }));
  }, [project, cams, selected, paths, layers.cameras]);
  const camPtsRef = useRef(camPts);
  camPtsRef.current = camPts;

  const sorPts = useMemo(() => {
    if (!project || !showSor || !sor.length) return [] as SorPt[];
    let pts = selected ? sor.filter((p) => p.co === selected.name) : sor;
    if (pin) pts = pts.filter((p) => nearPin(p.lat, p.lon, pin));
    if (!selected && !pin) pts = pts.filter((_, i) => i % 4 === 0);
    return pts.map((p) => ({ ...p, ...project(p.lon, p.lat) }));
  }, [project, sor, selected, showSor, pin]);
  const sorPtsRef = useRef(sorPts);
  sorPtsRef.current = sorPts;
  const crimeKindRef = useRef(crimeLayers);
  crimeKindRef.current = crimeLayers;
  const showCrimeRef = useRef(showCrime);
  showCrimeRef.current = showCrime;
  const showSorRef = useRef(showSor);
  showSorRef.current = showSor;
  const flockRef = useRef(layers.flock);
  flockRef.current = layers.flock;
  const camsOnRef = useRef(layers.cameras);
  camsOnRef.current = layers.cameras;
  const sitesOnRef = useRef(layers.sites);
  sitesOnRef.current = layers.sites;
  const flightsOnRef = useRef(layers.flights);
  flightsOnRef.current = layers.flights;
  const houseOnRef = useRef(layers.house);
  houseOnRef.current = layers.house;
  const showZipsRef = useRef(showZips);
  showZipsRef.current = showZips;
  const raceLayersRef = useRef(raceLayers);
  raceLayersRef.current = raceLayers;
  const pickedZipRef = useRef(pickedZip);
  pickedZipRef.current = pickedZip;
  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  function paintTiles(next: ViewBox) {
    const host = tileHost.current;
    const proj = projectRef.current;
    const unproj = unprojectRef.current;
    if (!host || !proj || !unproj) return;
    const size = sizeRef.current;
    const { s, ox, oy } = viewScale(size, next);
    const tiles = tilesForView(next, proj, unproj, size, ox, oy, s, !!selectedRef.current);
    const on = tiles.length > 0;
    host.style.display = on ? "block" : "none";
    setStreets((prev) => (prev === on ? prev : on));
    if (!on) {
      for (const img of tileImgs.current.values()) img.remove();
      tileImgs.current.clear();
      return;
    }
    const keep = new Set<string>();
    for (const t of tiles) {
      keep.add(t.key);
      let img = tileImgs.current.get(t.key);
      if (!img) {
        img = new Image();
        img.alt = "";
        img.decoding = "async";
        img.src = t.url;
        img.className = "pointer-events-none absolute top-0 left-0 max-w-none";
        img.style.filter = "brightness(1.55) contrast(1.22) saturate(0.95)";
        host.appendChild(img);
        tileImgs.current.set(t.key, img);
      }
      img.style.width = `${Math.max(1, t.w)}px`;
      img.style.height = `${Math.max(1, t.h)}px`;
      img.style.transform = `translate(${t.x}px, ${t.y}px)`;
    }
    for (const [key, img] of tileImgs.current) {
      if (keep.has(key)) continue;
      img.remove();
      tileImgs.current.delete(key);
    }
  }

  function prefetchTiles(next: ViewBox) {
    const proj = projectRef.current;
    const unproj = unprojectRef.current;
    if (!proj || !unproj) return;
    const size = sizeRef.current;
    const { s, ox, oy } = viewScale(size, next);
    const tiles = tilesForView(next, proj, unproj, size, ox, oy, s, true);
    for (const t of tiles) {
      const img = new Image();
      img.decoding = "async";
      img.src = t.url;
    }
  }

  function placePin(next: ViewBox) {
    const el = pinEl.current;
    const mark = pinRef.current;
    const proj = projectRef.current;
    if (!el) return;
    if (!mark || !proj) {
      el.style.display = "none";
      return;
    }
    const p = proj(mark.lon, mark.lat);
    const size = sizeRef.current;
    const { s, ox, oy } = viewScale(size, next);
    const x = (p.x - next.x) * s + ox;
    const y = (p.y - next.y) * s + oy;
    if (x < -40 || y < -40 || x > size.w + 40 || y > size.h + 40) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.transform = `translate(${x}px, ${y}px) translate(-5px, -50%)`;
  }

  function paintView(next: ViewBox, commit = false) {
    viewRef.current = next;
    svgRef.current?.setAttribute("viewBox", `${next.x} ${next.y} ${next.w} ${next.h}`);
    placePin(next);
    paintTiles(next);
    if (drawRaf.current) cancelAnimationFrame(drawRaf.current);
    drawRaf.current = requestAnimationFrame(drawDots);
    if (commit) setView(next);
  }

  function scheduleCommit() {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      setView({ ...viewRef.current });
    }, 90);
  }

  function drawDots() {
    drawRaf.current = null;
    const canvas = canvasRef.current;
    const size = sizeRef.current;
    hits.current = [];
    if (!canvas) return;
    let ctx = ctxRef.current;
    if (!ctx || ctx.canvas !== canvas) {
      ctx = canvas.getContext("2d", { alpha: true });
      ctxRef.current = ctx;
    }
    if (!ctx) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = size.w;
    const h = size.h;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const crimeOn = showCrimeRef.current;
    const flockOn = flockRef.current;
    const camsOn = camsOnRef.current;
    const sitesOn = sitesOnRef.current;
    const pts = crimePtsRef.current;
    const cameras = alprPtsRef.current;
    const tdots = camPtsRef.current;
    const sors = sorPtsRef.current;
    const sites = sitePtsRef.current;
    const sorOn = showSorRef.current;
    const flightsOn = flightsOnRef.current;
    const planes = flightsRef.current;
    const houseOn = houseOnRef.current;
    const districts = housePtsRef.current;
    const zipOn = showZipsRef.current;
    const zipRows = zipPtsRef.current;
    if (
      (!crimeOn || !pts.length) &&
      (!flockOn || !cameras.length) &&
      (!camsOn || !tdots.length) &&
      (!sorOn || !sors.length) &&
      (!sitesOn || !sites.length) &&
      !flightsOn &&
      !(houseOn && districts.length) &&
      !(zipOn && zipRows.length)
    )
      return;
    const cur = viewRef.current;
    const { s, ox, oy } = viewScale(size, cur);
    const zoomedNow = !!selectedRef.current;
    const pad = 10;
    const tight = cur.w < 90;
    const cell = tight ? (s > 6 ? 4 : s > 2.4 ? 6 : 8) : 9;
    const cols = Math.max(1, Math.ceil(w / cell));
    const seen = new Uint8Array(cols * Math.max(1, Math.ceil(h / cell)));
    const record = !busy.current;

    const stamp = (sx: number, sy: number, force: boolean) => {
      const gi = ((sy / cell) | 0) * cols + ((sx / cell) | 0);
      if (gi < 0 || gi >= seen.length) return force;
      if (seen[gi] && !force) return false;
      seen[gi] = 1;
      return true;
    };

    if (zipOn && zipRows.length) {
      const layersOn = raceLayersRef.current ?? { w: false, b: false, h: false, a: false, o: false };
      const fitW = fitRef.current.w || cur.w;
      const ratio = fitW / Math.max(1, cur.w);
      const fade =
        ratio <= 1.04 ? 0.8 : ratio < 1.7 ? 0.8 - ((ratio - 1.04) / 0.66) * 0.42 : Math.max(0.15, 0.38 - (ratio - 1.7) * 0.06);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);
      ctx.translate(-cur.x, -cur.y);
      const clipD = countyClipRef.current;
      if (clipD) ctx.clip(new Path2D(clipD));
      ctx.lineJoin = "round";
      ctx.lineWidth = 0.55 / Math.max(0.4, s);
      for (const row of zipRows) {
        if (row.maxX < cur.x - 2 || row.minX > cur.x + cur.w + 2 || row.maxY < cur.y - 2 || row.minY > cur.y + cur.h + 2)
          continue;
        const tone = zipTone(row.z, layersOn);
        ctx.fillStyle = tone.fill;
        ctx.strokeStyle = tone.tone === "white" ? "#f4f4f2" : tone.tone === "black" ? "#4a4c50" : "#84888e";
        ctx.globalAlpha = tone.opacity * fade;
        ctx.beginPath();
        for (const ring of row.rings) {
          ctx.moveTo(ring[0].x, ring[0].y);
          for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
          ctx.closePath();
        }
        ctx.fill("evenodd");
        ctx.globalAlpha = fade * 0.4;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (flockOn && cameras.length) {
      const r = zoomedNow ? 2.8 : 2.5;
      ctx.fillStyle = "#ffb347";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      let n = 0;
      for (const p of cameras) {
        const sx = (p.x - cur.x) * s + ox;
        const sy = (p.y - cur.y) * s + oy;
        if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
        if (!stamp(sx, sy, false)) continue;
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        if (record && zoomedNow) {
          hits.current.push({
            title: p.op,
            lines: ["ALPR · DeFlock / OSM", p.dir ? `Facing ${p.dir}°` : "Direction unlisted", `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`],
            x: sx,
            y: sy,
            r: r + 5,
          });
        }
        if (++n >= ALPR_CAP) break;
      }
      ctx.fill();
    }

    if (camsOn && tdots.length) {
      const r = zoomedNow ? 3.8 : 3.1;
      ctx.fillStyle = "#3de0ff";
      ctx.strokeStyle = "#9aefff";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      let n = 0;
      for (const p of tdots) {
        const sx = (p.x - cur.x) * s + ox;
        const sy = (p.y - cur.y) * s + oy;
        if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
        if (!stamp(sx, sy, zoomedNow)) continue;
        ctx.rect(sx - r, sy - r, r * 2, r * 2);
        if (record) {
          hits.current.push({
            title: p.title,
            lines: camTipLines(p),
            x: sx,
            y: sy,
            r: r + 6,
            cam: p,
          });
        }
        if (++n >= CAM_CAP) break;
      }
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.stroke();
    }

    if (sorOn && sors.length) {
      ctx.fillStyle = "#8ec8e0";
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      let n = 0;
      for (const p of sors) {
        const sx = (p.x - cur.x) * s + ox;
        const sy = (p.y - cur.y) * s + oy;
        if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
        if (!stamp(sx, sy, zoomedNow && p.k === "V")) continue;
        const r = p.k === "V" ? (zoomedNow ? 4.4 : 3.2) : zoomedNow ? 3.4 : 2.5;
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        if (record) {
          hits.current.push({
            title: sorTip(p.k),
            lines: ["TBI registry", p.co ? `${p.co} County` : "Tennessee"],
            x: sx,
            y: sy,
            r: r + 6,
            sor: p,
          });
        }
        if (++n >= SOR_CAP) break;
      }
      ctx.fill();
    }

    if (crimeOn && pts.length) {
      const kinds = crimeKindRef.current;
      const now = Date.now();
      const cad: CrimePt[] = [];
      const plot: CrimePt[] = [];
      for (const c of pts) {
        if (isDispatch(c)) {
          cad.push(c);
          continue;
        }
        if (kinds.h48 && isFresh48(c.date, now)) {
          plot.push(c);
          continue;
        }
        const k = kindOf(c.type);
        if (k === "hom" && kinds.hom) plot.push(c);
        else if (k === "sht" && kinds.sht) plot.push(c);
        else if (kinds.h48 && isFresh48(c.date, now)) plot.push(c);
      }

      const clipD = zoomedNow ? countyClipRef.current : "";
      if (clipD) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(s, s);
        ctx.translate(-cur.x, -cur.y);
        ctx.clip(new Path2D(clipD));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const fitW = fitRef.current.w || cur.w;
      const ratio = fitW / Math.max(1, cur.w);
      const dense = isDenseCounty(selectedRef.current?.name);
      const wantCluster = !zoomedNow || (dense && ratio < 2.2);
      const cell = !zoomedNow ? 22 : 5.8;

      const pinColor = (c: CrimePt) => {
        if (kinds.h48 && isFresh48(c.date, now)) return "#c45cff";
        if (isHomicide(c.type)) return "#ff4d4d";
        return "#ffb347";
      };

      const drawPin = (c: CrimePt, force: boolean) => {
        const sx = (c.x - cur.x) * s + ox;
        const sy = (c.y - cur.y) * s + oy;
        if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) return;
        if (!stamp(sx, sy, force)) return;
        const geo = inferGeo(c);
        const fuzzy = isImprecise(geo);
        const hom = isHomicide(c.type);
        const r = hom ? (s > 4 ? 3.1 : s > 1.4 ? 2.5 : 2.05) : s > 4 ? 2.15 : s > 1.4 ? 1.7 : 1.35;
        const col = pinColor(c);
        ctx.beginPath();
        ctx.arc(sx, sy, fuzzy ? r + 1.1 : r, 0, Math.PI * 2);
        if (fuzzy) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.15;
          ctx.globalAlpha = 0.85;
          ctx.stroke();
        } else {
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.82;
          ctx.fill();
          if (hom || (kinds.h48 && isFresh48(c.date, now))) {
            ctx.strokeStyle = "#ffd6d6";
            ctx.lineWidth = 0.7;
            ctx.globalAlpha = 0.9;
            ctx.stroke();
          }
        }
        if (record) {
          hits.current.push({
            title: crimeLabel(c.type),
            lines: crimeTipLines(c),
            x: sx,
            y: sy,
            r: r + (fuzzy ? 10 : 8),
            crime: c,
          });
        }
      };

      if (wantCluster) {
        const groups = clusterXY(plot, cell);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "600 10px 'IBM Plex Mono', ui-monospace, monospace";
        for (const g of groups) {
          const sx = (g.x - cur.x) * s + ox;
          const sy = (g.y - cur.y) * s + oy;
          if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
          if (g.n === 1) {
            drawPin(g.items[0], true);
            continue;
          }
          if (!stamp(sx, sy, true)) continue;
          const homN = g.items.filter((it) => isHomicide(it.type)).length;
          const freshN = g.items.filter((it) => kinds.h48 && isFresh48(it.date, now)).length;
          const fill = freshN === g.n ? "#c45cff" : homN === g.n ? "#ff4d4d" : homN ? "#ff7a4d" : "#ffb347";
          const rr = Math.min(16, 7 + Math.log2(g.n) * 2.2);
          ctx.beginPath();
          ctx.fillStyle = fill;
          ctx.globalAlpha = 0.88;
          ctx.arc(sx, sy, rr, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = "#020308";
          ctx.fillText(String(g.n), sx, sy + 0.5);
          if (record) {
            hits.current.push({
              title: `${g.n} incidents`,
              lines: [`${homN} hom · ${g.n - homN} sht`],
              x: sx,
              y: sy,
              r: rr + 8,
              cluster: { x: g.x, y: g.y, n: g.n },
            });
          }
        }
      } else {
        for (const c of plot) drawPin(c, true);
      }

      if (cad.length) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#8ec8e0";
        ctx.strokeStyle = "#c5e6f2";
        const cadGroups = wantCluster ? clusterXY(cad, cell) : cad.map((c) => ({ x: c.x, y: c.y, n: 1, items: [c] }));
        for (const g of cadGroups) {
          const c0 = g.items[0];
          const sx = (g.x - cur.x) * s + ox;
          const sy = (g.y - cur.y) * s + oy;
          if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
          stamp(sx, sy, true);
          const rr = g.n > 1 ? Math.min(12, 6 + g.n) : 3.2;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(Math.PI / 4);
          ctx.beginPath();
          ctx.rect(-rr, -rr, rr * 2, rr * 2);
          ctx.fill();
          ctx.restore();
          if (record) {
            hits.current.push({
              title: "Dispatch",
              lines: g.n > 1 ? [`${g.n} active calls`] : crimeTipLines(c0),
              x: sx,
              y: sy,
              r: rr + 8,
              crime: g.n === 1 ? c0 : undefined,
              cluster: g.n > 1 ? { x: g.x, y: g.y, n: g.n } : undefined,
            });
          }
        }
      }

      const one = pickedHdRef.current;
      if (one && projectRef.current && !houseOn) {
        const ring = (one.g[0] ?? []).map(([lon, lat]) => projectRef.current!(lon, lat));
        if (ring.length > 2) {
          ctx.beginPath();
          ctx.strokeStyle = "#c9a45c";
          ctx.lineWidth = 1.4;
          ctx.globalAlpha = 0.9;
          const p0 = ring[0];
          ctx.moveTo((p0.x - cur.x) * s + ox, (p0.y - cur.y) * s + oy);
          for (let i = 1; i < ring.length; i++) {
            const p = ring[i];
            ctx.lineTo((p.x - cur.x) * s + ox, (p.y - cur.y) * s + oy);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }

      if (clipD) ctx.restore();
    }

    if (sitesOn && sites.length) {
      ctx.shadowColor = "rgba(255, 77, 77, 0.7)";
      ctx.shadowBlur = zoomedNow ? 10 : 8;
      ctx.fillStyle = "#ff4d4d";
      ctx.strokeStyle = "#ffd6d6";
      ctx.lineWidth = 1.15;
      ctx.globalAlpha = 1;
      const r = zoomedNow ? 6.5 : 5.5;
      for (const p of sites) {
        const sx = (p.x - cur.x) * s + ox;
        const sy = (p.y - cur.y) * s + oy;
        if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
        stamp(sx, sy, true);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-r, -r, r * 2, r * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.restore();
        if (record) {
          hits.current.push({
            title: p.name,
            lines: [`${p.kind} data center`, `${p.county} County`, `${p.lat.toFixed(2)}N ${Math.abs(p.lon).toFixed(2)}W`],
            x: sx,
            y: sy,
            r: r + 8,
          });
        }
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
    }

    if (flightsOn && planes.length && projectRef.current) {
      const now = Date.now();
      const proj = projectRef.current;
      const size = zoomedNow ? 7.2 : 5.4;
      ctx.fillStyle = "#3de0ff";
      ctx.globalAlpha = 0.92;
      for (const f of planes) {
        const pos = deadReckon(f, now);
        const p = proj(pos.lon, pos.lat);
        const sx = (p.x - cur.x) * s + ox;
        const sy = (p.y - cur.y) * s + oy;
        if (sx < -pad || sy < -pad || sx > w + pad || sy > h + pad) continue;
        ctx.globalAlpha = f.ground ? 0.55 : 0.92;
        drawPlane(ctx, sx, sy, f.hdg, f.ground ? size * 0.72 : size);
        if (record) {
          hits.current.push({
            title: f.call,
            lines: [],
            x: sx,
            y: sy,
            r: size + 10,
            flight: f,
          });
        }
      }
    }
    ctx.globalAlpha = 1;
    if (houseOn && districts.length) {
      ctx.save();
      ctx.strokeStyle = "#c9a45c";
      ctx.fillStyle = "#c9a45c";
      ctx.lineWidth = zoomedNow ? 1.15 : 0.85;
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      for (const h of districts) {
        if (h.maxX < cur.x - 2 || h.minX > cur.x + cur.w + 2 || h.maxY < cur.y - 2 || h.minY > cur.y + cur.h + 2) continue;
        const ring = h.ring;
        if (ring.length < 3) continue;
        const p0 = ring[0];
        ctx.moveTo((p0.x - cur.x) * s + ox, (p0.y - cur.y) * s + oy);
        for (let i = 1; i < ring.length; i++) {
          const p = ring[i];
          ctx.lineTo((p.x - cur.x) * s + ox, (p.y - cur.y) * s + oy);
        }
        ctx.closePath();
      }
      ctx.stroke();
      if (zoomedNow) {
        ctx.font = "600 10px 'IBM Plex Mono', ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = 0.92;
        for (const hd of districts) {
          const bw = (hd.maxX - hd.minX) * s;
          if (bw < 26) continue;
          const sx = (hd.x - cur.x) * s + ox;
          const sy = (hd.y - cur.y) * s + oy;
          if (sx < 8 || sy < 8 || sx > w - 8 || sy > h - 8) continue;
          ctx.fillText(String(hd.d), sx, sy);
        }
      }
      ctx.restore();
    }
    if (flightsOn) drawRaf.current = requestAnimationFrame(drawDots);
  }

  useEffect(() => {
    if (!showCrime || !selected) setPicked(null);
  }, [showCrime, selected]);

  useEffect(() => {
    if (!focusCrimeId) return;
    const c = crime.find((x) => x.id === focusCrimeId);
    if (!c) return;
    const cached = readCrimeNames(c.id);
    setPicked({ crime: c, names: cached, hd: hdFor(c) });
    pickedHdRef.current = overlayMem.house ? houseAtLonLat(overlayMem.house, c.lon, c.lat) : null;
    if (cached !== undefined) return;
    void fetchCrimeNames(c).then((names) => {
      setPicked((cur) => (cur?.crime.id === c.id ? { ...cur, names } : cur));
    });
    // crime list is live; pin zoom is driven by focusTick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCrimeId, focusTick]);

  useEffect(() => {
    if (!showCrime) setHoverCrime(null);
  }, [showCrime]);

  useEffect(() => {
    if (!showSor) setPickedSor(null);
  }, [showSor]);

  useEffect(() => {
    if (drawRaf.current) cancelAnimationFrame(drawRaf.current);
    drawRaf.current = requestAnimationFrame(drawDots);
  }, [crimePts, alprPts, camPts, sorPts, sitePts, showCrime, showSor, selected, layers.flock, layers.cameras, layers.sites, layers.flights, layers.house, crimeLayers, flights, housePts, zipPts, showZips, raceLayers, pickedZip]);

  useEffect(() => {
    if (!showCrime) return;
    const tick = window.setInterval(() => {
      if (drawRaf.current) cancelAnimationFrame(drawRaf.current);
      drawRaf.current = requestAnimationFrame(drawDots);
    }, 60_000);
    return () => window.clearInterval(tick);
  }, [showCrime]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const apply = () => {
      const box = el.getBoundingClientRect();
      sizeRef.current = { w: Math.max(1, Math.round(box.width)), h: Math.max(1, Math.round(box.height)) };
      placePin(viewRef.current);
      drawDots();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function animateTo(next: ViewBox) {
    if (raf.current) cancelAnimationFrame(raf.current);
    const from = viewRef.current;
    const start = performance.now();
    busy.current = true;
    const step = (now: number) => {
      const t = easeOutCubic(Math.min(1, (now - start) / 110));
      paintView({
        x: from.x + (next.x - from.x) * t,
        y: from.y + (next.y - from.y) * t,
        w: from.w + (next.w - from.w) * t,
        h: from.h + (next.h - from.h) * t,
      });
      if (t < 1) raf.current = requestAnimationFrame(step);
      else {
        raf.current = null;
        busy.current = false;
        paintView(next, true);
      }
    };
    raf.current = requestAnimationFrame(step);
  }

  const prevSel = useRef<typeof selected>(null);

  useEffect(() => {
    if (!project || !geo) return;
    if (!selected) {
      fitRef.current = FULL_VIEW;
      if (prevSel.current) animateTo(FULL_VIEW);
      prevSel.current = selected;
      placePin(FULL_VIEW);
      return;
    }
    const feat = geo.find((f) => f.properties.fips === selected.fips);
    prevSel.current = selected;
    if (!feat) return;
    const fit = countyFit(feat, project);
    fitRef.current = fit;
    prefetchTiles(fit);
    const mark = pin;
    if (mark) {
      const target = clampView(viewAround(mark.lon, mark.lat, project), fit);
      prefetchTiles(target);
      animateTo(target);
    } else if (focusZip) {
      const target = clampView(viewAround(focusZip.lon, focusZip.lat, project, 0.04), fit);
      prefetchTiles(target);
      animateTo(target);
    } else {
      animateTo(fit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, pin, project, geo, focusTick, focusZip]);

  function applyView(next: ViewBox, animate = true) {
    const fit = selectedRef.current ? fitRef.current : FULL_VIEW;
    const clamped = clampView(next, fit);
    if (animate) animateTo(clamped);
    else paintView(clamped);
  }

  function zoomBy(factor: number, cx?: number, cy?: number, animate = false) {
    const cur = viewRef.current;
    const px = cx ?? cur.x + cur.w / 2;
    const py = cy ?? cur.y + cur.h / 2;
    const rx = (px - cur.x) / cur.w;
    const ry = (py - cur.y) / cur.h;
    applyView(
      {
        w: cur.w * factor,
        h: cur.h * factor,
        x: px - cur.w * factor * rx,
        y: py - cur.h * factor * ry,
      },
      animate,
    );
  }

  function panBy(nx: number, ny: number) {
    const cur = viewRef.current;
    applyView(
      {
        ...cur,
        x: cur.x + nx * cur.w,
        y: cur.y + ny * cur.h,
      },
      true,
    );
  }

  function clientToView(clientX: number, clientY: number) {
    const box = root.current?.getBoundingClientRect();
    if (!box) return null;
    const cur = viewRef.current;
    const { s, ox, oy } = viewScale(box, cur);
    return {
      x: cur.x + (clientX - box.left - ox) / s,
      y: cur.y + (clientY - box.top - oy) / s,
      s,
    };
  }

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = clientToView(e.clientX, e.clientY);
      const factor = e.deltaY > 0 ? ZOOM_OUT : ZOOM_IN;
      zoomBy(factor, pt?.x, pt?.y, false);
      scheduleCommit();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [selected]);

  const zoomed = !!selected;
  const fitBox = selected ? fitRef.current : FULL_VIEW;
  const zoomRatio = fitBox.w / view.w;
  const canIn = zoomRatio < MAX_ZOOM - 0.05;
  const canOut = zoomRatio > 1.05;
  const extraZoom = zoomRatio > 1.12;

  const alertsByCounty = useMemo(() => {
    const m = new Map<string, Alert[]>();
    for (const a of alerts) {
      for (const name of a.counties) {
        const list = m.get(name) ?? [];
        list.push(a);
        m.set(name, list);
      }
    }
    return m;
  }, [alerts]);

  function interactiveTarget(el: EventTarget | null) {
    if (!(el instanceof Element)) return false;
    return Boolean(el.closest("button") || el.closest("a") || el.closest("[data-map-card]"));
  }

  function hitAt(clientX: number, clientY: number, pickable = false) {
    const box = root.current?.getBoundingClientRect();
    if (!box) return null;
    const mx = clientX - box.left;
    const my = clientY - box.top;
    let best: { h: Hit; d: number } | null = null;
    for (const h of hits.current) {
      if (pickable && !h.crime && !h.cam && !h.sor && !h.cluster) continue;
      const d = (h.x - mx) ** 2 + (h.y - my) ** 2;
      if (d <= h.r * h.r && (!best || d < best.d)) best = { h, d };
    }
    return best?.h ?? null;
  }

  function houseAt(clientX: number, clientY: number) {
    if (!houseOnRef.current) return null;
    const box = root.current?.getBoundingClientRect();
    if (!box) return null;
    const cur = viewRef.current;
    const { s, ox, oy } = viewScale({ w: box.width, h: box.height }, cur);
    const mx = (clientX - box.left - ox) / s + cur.x;
    const my = (clientY - box.top - oy) / s + cur.y;
    let hit: HousePt | null = null;
    let area = Infinity;
    for (const h of housePtsRef.current) {
      if (mx < h.minX || mx > h.maxX || my < h.minY || my > h.maxY) continue;
      if (!pip(mx, my, h.ring)) continue;
      const a = (h.maxX - h.minX) * (h.maxY - h.minY);
      if (a < area) {
        area = a;
        hit = h;
      }
    }
    return hit;
  }

  function mapXY(clientX: number, clientY: number) {
    const box = root.current?.getBoundingClientRect();
    if (!box) return null;
    const cur = viewRef.current;
    const { s, ox, oy } = viewScale({ w: box.width, h: box.height }, cur);
    return { x: (clientX - box.left - ox) / s + cur.x, y: (clientY - box.top - oy) / s + cur.y };
  }

  function zipAt(clientX: number, clientY: number) {
    if (!showZipsRef.current) return null;
    const pt = mapXY(clientX, clientY);
    if (!pt) return null;
    const geom = countyGeomRef.current;
    const unproj = unprojectRef.current;
    if (geom && unproj) {
      const ll = unproj(pt.x, pt.y);
      if (!pointInGeom(ll.lon, ll.lat, geom)) return null;
    }
    let hit: ZipPt | null = null;
    let area = Infinity;
    for (const row of zipPtsRef.current) {
      if (pt.x < row.minX || pt.x > row.maxX || pt.y < row.minY || pt.y > row.maxY) continue;
      if (!pipZip(pt.x, pt.y, row.rings)) continue;
      const a = (row.maxX - row.minX) * (row.maxY - row.minY);
      if (a < area) {
        area = a;
        hit = row;
      }
    }
    return hit;
  }

  function applyZipHud(next: { a: string; b: string } | null) {
    setHoverZip((prev) => {
      if (!prev && !next) return prev;
      if (prev && next && prev.a === next.a && prev.b === next.b) return prev;
      return next;
    });
  }

  function pickDotAt(clientX: number, clientY: number) {
    const h = hitAt(clientX, clientY, true);
    if (h?.cluster) {
      stealClick.current = true;
      skipSelect.current = true;
      setTip(null);
      const span = Math.max(8, (viewRef.current.w * 0.42) / Math.max(1, Math.log2(h.cluster.n + 1)));
      animateTo({
        x: h.cluster.x - span / 2,
        y: h.cluster.y - span / 2,
        w: span,
        h: span * 0.55,
      });
      return true;
    }
    if (h?.cam) {
      stealClick.current = true;
      setTip(null);
      setHoverCrime(null);
      setPicked(null);
      setPickedSor(null);
      setPickedCam(h.cam);
      skipSelect.current = true;
      return true;
    }
    if (h?.sor) {
      stealClick.current = true;
      const point = h.sor;
      setTip(null);
      setHoverCrime(null);
      setPicked(null);
      setPickedCam(null);
      setPickedSor({ point, person: undefined });
      skipSelect.current = true;
      void fetch(`/api/sor?id=${encodeURIComponent(point.id)}`)
        .then((r) => r.json())
        .then((d: { offenders?: SorPerson[] }) => {
          setPickedSor((cur) =>
            cur?.point.id === point.id ? { point, person: d.offenders?.[0] ?? null } : cur,
          );
        })
        .catch(() => {
          setPickedSor((cur) => (cur?.point.id === point.id ? { point, person: null } : cur));
        });
      return true;
    }
    if (!h?.crime) {
      const zipHit = zipAt(clientX, clientY);
      if (zipHit) {
        stealClick.current = true;
        skipSelect.current = true;
        setTip(null);
        const layersOn = raceLayersRef.current ?? { w: false, b: false, h: false, a: false, o: false };
        applyZipHud(zipHud(zipHit.z, layersOn));
        return true;
      }
      setPickedCam(null);
      setPickedSor(null);
      if (selected) setPicked(null);
      return false;
    }
    stealClick.current = true;
    setTip(null);
    setHoverCrime(null);
    setPickedCam(null);
    setPickedSor(null);
    const c = h.crime;
    const cached = readCrimeNames(c.id);
    setPicked({ crime: c, names: cached, hd: hdFor(c) });
    pickedHdRef.current = overlayMem.house ? houseAtLonLat(overlayMem.house, c.lon, c.lat) : null;
    if (cached === undefined) {
      void fetchCrimeNames(c).then((names) => {
        setPicked((cur) => (cur?.crime.id === c.id ? { ...cur, names } : cur));
      });
    }
    return true;
  }

  function setBusy(on: boolean) {
    busy.current = on;
    root.current?.classList.toggle("is-panning", on);
  }

  return (
    <div
      ref={root}
      className="absolute inset-0"
      style={{ contain: "layout paint" }}
      onPointerDown={(e) => {
        if (interactiveTarget(e.target)) return;
        if (e.button !== 0) return;
        if (hitAt(e.clientX, e.clientY, true)) return;
        const fit = selected ? fitRef.current : FULL_VIEW;
        const zoomedIn = fit.w / viewRef.current.w > 1.04;
        if (!selected && !zoomedIn) return;
        pan.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!pan.current) return;
        const dx = e.clientX - pan.current.x;
        const dy = e.clientY - pan.current.y;
        if (!pan.current.moved && dx * dx + dy * dy < 36) return;
        if (!pan.current.moved) {
          pan.current.moved = true;
          setBusy(true);
        }
        const box = sizeRef.current;
        const { s } = viewScale(box, viewRef.current);
        applyView(
          {
            ...viewRef.current,
            x: pan.current.vx - dx / s,
            y: pan.current.vy - dy / s,
          },
          false,
        );
      }}
      onPointerUp={(e) => {
        if (interactiveTarget(e.target)) {
          pan.current = null;
          setBusy(false);
          return;
        }
        const start = pan.current;
        pan.current = null;
        setBusy(false);
        paintView(viewRef.current, true);
        if (start?.moved) return;
        pickDotAt(e.clientX, e.clientY);
      }}
      onPointerCancel={() => {
        pan.current = null;
        setBusy(false);
        paintView(viewRef.current, true);
      }}
      onMouseMove={(e) => {
        if (pan.current) return;
        if (interactiveTarget(e.target)) {
          setHoverCrime(null);
          setHoverFlight(null);
          setHoverHouse(null);
          applyZipHud(null);
          return;
        }
        const h = hitAt(e.clientX, e.clientY);
        if (h?.flight) {
          setTip(null);
          setHoverCrime(null);
          setHoverHouse(null);
          applyZipHud(null);
          setHoverFlight(flightHud(h.flight));
          return;
        }
        if (h?.cluster) {
          setTip(null);
          setHoverFlight(null);
          setHoverHouse(null);
          applyZipHud(null);
          setHoverCrime({ a: h.title, b: h.lines[0] ?? "Zoom in" });
          return;
        }
        if (h?.crime) {
          setTip(null);
          setHoverFlight(null);
          setHoverHouse(null);
          applyZipHud(null);
          setHoverCrime(crimeHud(h.crime));
          return;
        }
        setHoverCrime(null);
        setHoverFlight(null);
        const zipHit = zipAt(e.clientX, e.clientY);
        if (zipHit) {
          setTip(null);
          setHoverHouse(null);
          const layersOn = raceLayersRef.current ?? { w: false, b: false, h: false, a: false, o: false };
          applyZipHud(zipHud(zipHit.z, layersOn));
          return;
        }
        applyZipHud(null);
        const hd = houseAt(e.clientX, e.clientY);
        if (hd) {
          setTip(null);
          setHoverHouse({
            a: `House ${hd.d}`,
            b: hd.n ? `${hd.n} · ${hd.p === "D" ? "D" : "R"}` : "TN House",
          });
          return;
        }
        setHoverHouse(null);
        if (h) showTip(e, h.title, h.lines);
      }}
      onMouseLeave={() => {
        if (!pan.current) {
          setTip(null);
          setHoverCrime(null);
          setHoverFlight(null);
          setHoverHouse(null);
          applyZipHud(null);
        }
      }}
    >
      {!paths.length || !project ? (
        <div className="absolute inset-0 animate-pulse bg-elevated/40" />
      ) : (
        <>
          <div ref={tileHost} className="pointer-events-none absolute inset-0 z-0 overflow-hidden" />
          <svg
            ref={svgRef}
            viewBox={`${viewRef.current.x} ${viewRef.current.y} ${viewRef.current.w} ${viewRef.current.h}`}
            className={cn("absolute inset-0 z-[1] h-full w-full", selected || extraZoom ? "cursor-grab" : undefined)}
            role="img"
            aria-label="Tennessee grid map"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <filter id="line-glow-hot" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <pattern id="tn-mesh" width="14" height="14" patternUnits="userSpaceOnUse">
                <path
                  d="M 14 0 L 0 0 0 14"
                  fill="none"
                  stroke="var(--color-grid)"
                  strokeWidth="0.35"
                  opacity="0.55"
                />
              </pattern>
              <clipPath id="tn-clip">
                {paths.map((p) => (
                  <path key={p.fips} d={p.d} />
                ))}
              </clipPath>
              {selected ? (
                <mask id="zip-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={MAP_W} height={MAP_H}>
                  <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="black" />
                  {paths
                    .filter((p) => p.fips === selected.fips)
                    .map((p) => (
                      <path key={p.fips} d={p.d} fill="white" />
                    ))}
                </mask>
              ) : null}
            </defs>
            {paths.map((p) => {
              const county = BY_FIPS.get(p.fips);
              const isSel = selected?.fips === p.fips;
              const dim = zoomed && !isSel;
              const hitsAlert = county ? (alertsByCounty.get(county.name) ?? []) : [];
              const wx = !!(layers.weather && hitsAlert.length && !dim);
              return (
                <path
                  key={p.fips}
                  d={p.d}
                  data-name={county?.name}
                  fill={
                    showZips && isSel
                      ? "color-mix(in oklab, var(--color-grid) 5%, #020308)"
                      : fillColor(county?.pop ?? 8000, isSel, dim, wx, streets && isSel)
                  }
                  stroke={isSel ? "var(--color-fg)" : dim ? "transparent" : "var(--color-grid)"}
                  strokeWidth={isSel ? (streets ? 0.08 : zoomed ? 0.85 : 1.35) : zoomed ? 0 : 0.55}
                  filter={isSel && !streets ? "url(#line-glow-hot)" : undefined}
                  className={dim ? "pointer-events-none" : zoomed ? undefined : "cursor-pointer"}
                  pointerEvents={dim ? "none" : "auto"}
                  onMouseEnter={(e) => {
                    if (!county) return;
                    if (!zoomed) {
                      prefetchNews(county.name, county.seat, county.market);
                      onWarmZips?.(county.fips);
                      const sky = wxHint(county.name);
                      showTip(e, county.name, [
                        `${county.pop.toLocaleString()} people · ${county.seat}`,
                        ...(sky ? [sky] : []),
                        ...hitsAlert.map((a) => `${a.event} · ${a.severity}`),
                      ]);
                    }
                  }}
                  onMouseMove={(e) => {
                    if (zoomed || !county) return;
                    const sky = wxHint(county.name);
                    showTip(e, county.name, [
                      `${county.pop.toLocaleString()} people · ${county.seat}`,
                      ...(sky ? [sky] : []),
                      ...hitsAlert.map((a) => `${a.event} · ${a.severity}`),
                    ]);
                  }}
                  onMouseLeave={() => setTip(null)}
                  onClick={() => {
                    if (skipSelect.current) {
                      skipSelect.current = false;
                      return;
                    }
                    if (!zoomed && county) onSelect(county);
                  }}
                />
              );
            })}
            {zoomed ? null : (
              <g clipPath="url(#tn-clip)" pointerEvents="none">
                <g className="mesh-drift">
                  <rect x="-40" y="-40" width="1080" height="440" fill="url(#tn-mesh)" opacity="0.7" />
                </g>
              </g>
            )}
            {zoomed && layers.p24 && !showZips
              ? precincts.map((pr) => {
                  const tot = pr.t || 1;
                  const other = Math.max(0, pr.t - pr.d - pr.r);
                  const picked = pickedId === pr.id;
                  const lines = [
                    "2024 President",
                    `Trump ${pr.r.toLocaleString()} (${Math.round((pr.r / tot) * 100)}%)`,
                    `Harris ${pr.d.toLocaleString()} (${Math.round((pr.d / tot) * 100)}%)`,
                    other
                      ? `Other ${other.toLocaleString()} (${Math.round((other / tot) * 100)}%)`
                      : "Other —",
                    `${pr.t.toLocaleString()} ballots · click for full tally`,
                  ];
                  return (
                    <path
                      key={pr.id}
                      d={pathFromGeom(pr.g, project)}
                      data-precinct={pr.id}
                      fill={
                        picked
                          ? "color-mix(in oklab, var(--color-hot) 38%, #020308)"
                          : "color-mix(in oklab, var(--color-hot) 16%, #020308)"
                      }
                      stroke={picked ? "var(--color-fg)" : "#ff6b6b"}
                      strokeWidth={picked ? 0.35 : 0.22}
                      className="cursor-pointer"
                      opacity={pickedId && !picked ? 0.4 : 1}
                      onMouseEnter={(e) => showTip(e, pr.name, lines)}
                      onMouseMove={(e) => showTip(e, pr.name, lines)}
                      onMouseLeave={() => setTip(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (stealClick.current) {
                          stealClick.current = false;
                          return;
                        }
                        if (layers.p24) onPickPrecinct(pr, races[pr.id]);
                      }}
                    />
                  );
                })
              : null}
            {layers.interstates
              ? visibleRoads
                  .filter((r) => r.kind === "interstate" || (zoomed && r.kind === "arterial"))
                  .map((r) => {
                    const arterial = r.kind === "arterial";
                    return (
                      <g key={r.id}>
                        <path
                          d={pathFromPts(r.pts, project)}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={zoomed ? 1.6 : 3}
                          className={showZips ? undefined : "cursor-pointer"}
                          pointerEvents={showZips ? "none" : "auto"}
                          onMouseEnter={(e) =>
                            showTip(e, r.id, [arterial ? "Arterial" : "Interstate", "Corridor trace — not live traffic"])
                          }
                          onMouseMove={(e) =>
                            showTip(e, r.id, [arterial ? "Arterial" : "Interstate", "Corridor trace — not live traffic"])
                          }
                          onMouseLeave={() => setTip(null)}
                        />
                        <path
                          d={pathFromPts(r.pts, project)}
                          fill="none"
                          stroke={arterial ? "var(--color-steel)" : "var(--color-flow)"}
                          strokeWidth={zoomed ? (arterial ? 0.16 : 0.28) : 0.38}
                          className={arterial ? "road-flow" : "traffic-flow"}
                          opacity={arterial ? 0.55 : 0.85}
                          pointerEvents="none"
                        />
                      </g>
                    );
                  })
              : null}
          </svg>
          {layers.weather && project ? (
            <WxSky project={project} viewRef={viewRef} sizeRef={sizeRef} />
          ) : null}
          <canvas
            ref={canvasRef}
            data-overlay="dots"
            data-pts={`${crimePts.length},${alprPts.length},${camPts.length},${sorPts.length},${sitePts.length}`}
            className="pointer-events-none absolute inset-0 z-[3] h-full w-full bg-transparent"
            aria-hidden
          />
          <div
            ref={pinEl}
            className="absolute top-0 left-0 z-20"
            style={{ display: "none", willChange: "transform", pointerEvents: "none" }}
          >
            {pin ? (
              <div className="flex items-center gap-1">
                <div className="size-2.5 shrink-0 rotate-45 border border-grid bg-grid" />
                <div className="pointer-events-auto flex items-center border border-grid bg-elevated/95 shadow-glow">
                  <span className="px-1.5 py-0.5 font-mono text-[10px] tracking-wide whitespace-nowrap text-grid">
                    {shortPinLabel(pin.label)}
                  </span>
                  <button
                    type="button"
                    aria-label="Clear address pin"
                    className="grid size-8 place-items-center border-l border-grid text-faint hover:text-fg"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onClearPin?.();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearPin?.();
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {streets ? (
            <div
              className={cn(
                "pointer-events-none absolute z-10 font-mono text-[9px] tracking-widest text-faint/80 uppercase",
                extraZoom ? "right-2 bottom-28" : "right-2 bottom-2",
              )}
            >
              OSM · CARTO
            </div>
          ) : null}
        </>
      )}
        <div className="absolute bottom-2 left-2 z-10 flex flex-col border border-line bg-elevated/95">
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_IN, undefined, undefined, true)}
            disabled={!canIn}
            aria-label="Zoom in"
            className="grid size-8 place-items-center text-grid hover:bg-grid/15 disabled:text-faint disabled:hover:bg-transparent"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_OUT, undefined, undefined, true)}
            disabled={!canOut}
            aria-label="Zoom out"
            className="grid size-8 place-items-center border-t border-line text-grid hover:bg-grid/15 disabled:text-faint disabled:hover:bg-transparent"
          >
            <Minus className="size-3.5" />
          </button>
        </div>
      {extraZoom ? (
        <div className="absolute right-2 bottom-2 z-10 grid grid-cols-3 border border-line bg-elevated/95">
          <span />
          <button
            type="button"
            onClick={() => panBy(0, -0.28)}
            aria-label="Pan up"
            className="grid size-8 place-items-center text-grid hover:bg-grid/15"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <span />
          <button
            type="button"
            onClick={() => panBy(-0.28, 0)}
            aria-label="Pan left"
            className="grid size-8 place-items-center text-grid hover:bg-grid/15"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="size-8" />
          <button
            type="button"
            onClick={() => panBy(0.28, 0)}
            aria-label="Pan right"
            className="grid size-8 place-items-center text-grid hover:bg-grid/15"
          >
            <ChevronRight className="size-3.5" />
          </button>
          <span />
          <button
            type="button"
            onClick={() => panBy(0, 0.28)}
            aria-label="Pan down"
            className="grid size-8 place-items-center text-grid hover:bg-grid/15"
          >
            <ChevronDown className="size-3.5" />
          </button>
          <span />
        </div>
      ) : null}
      {hoverHouse && !hoverZip && !(zoomed && showZips) ? (
        <div className="pointer-events-none absolute top-1 left-1/2 z-10 w-[min(92%,18rem)] -translate-x-1/2 text-center font-mono text-[10px] leading-tight tracking-wide text-hot uppercase">
          <div>{hoverHouse.a}</div>
          <div>{hoverHouse.b}</div>
        </div>
      ) : null}
      {zoomed && layers.p26 && !showZips ? (
        <div className="pointer-events-none absolute top-2 left-1/2 z-10 w-[min(92%,22rem)] -translate-x-1/2 text-center font-mono text-xs tracking-wide text-muted">
          2026 precinct GIS is not published. Nov 3 general has not been run. Aug 6 was local races
          only.
        </div>
      ) : null}
      {zoomed && showZips ? (
        <div className="pointer-events-none absolute top-1 left-1/2 z-10 w-[min(92%,18rem)] -translate-x-1/2 text-center">
          {hoverHouse ? (
            <div className="mb-1 font-mono text-[10px] leading-tight tracking-wide text-hot uppercase">
              <div>{hoverHouse.a}</div>
              <div>{hoverHouse.b}</div>
            </div>
          ) : hoverZip ? (
            <div className="mb-1 font-mono text-[10px] leading-tight tracking-wide text-hot uppercase">
              <div>{hoverZip.a}</div>
              <div>{hoverZip.b}</div>
            </div>
          ) : null}
          <div className="mx-auto w-28">
            <div
              className="h-1 w-full"
              style={{
                background:
                  "linear-gradient(to right, var(--color-race-white), var(--color-race-gray) 50%, var(--color-race-black))",
              }}
            />
            <div className="mt-0.5 flex justify-between font-mono text-[9px] tracking-widest text-faint uppercase">
              <span>White</span>
              <span>Even</span>
              <span>B/H</span>
            </div>
          </div>
        </div>
      ) : null}
      {hoverFlight || hoverCrime ? (
        <div
          data-crime-hud={hoverCrime ? "" : undefined}
          data-flight-hud={hoverFlight ? "" : undefined}
          className={cn(
            "pointer-events-none absolute left-1/2 z-20 w-[min(92%,28rem)] -translate-x-1/2 px-2 text-center font-mono text-[10px] leading-tight tracking-wide text-watch uppercase",
            feedHidden ? "bottom-10" : "bottom-1",
          )}
        >
          <div>{(hoverFlight ?? hoverCrime)?.a}</div>
          {(hoverFlight ?? hoverCrime)?.b ? <div>{(hoverFlight ?? hoverCrime)?.b}</div> : null}
        </div>
      ) : null}
      {tip && !picked && !pickedCam && !pickedSor ? (
        <div
          className="pointer-events-none absolute z-10 w-56 border border-line bg-elevated/95 px-3 py-2 shadow-glow"
          style={tipStyle(tip)}
        >
          <div className="text-sm font-medium">{tip.title}</div>
          {tip.lines.map((line) => (
            <div key={line} className="mt-0.5 font-mono text-xs tracking-wide text-muted">
              {line}
            </div>
          ))}
        </div>
      ) : null}
      {picked ? (
        <div
          data-map-card
          className="absolute bottom-2 left-12 z-20 w-[min(22rem,calc(100%-4.5rem))] border border-line bg-elevated/95 px-3 py-2.5 shadow-glow"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] tracking-widest text-hot uppercase">
                {isDispatch(picked.crime) ? "Dispatch" : crimeLabel(picked.crime.type)}
                {picked.crime.source === "GVA" ? " · GVA Jun" : ""}
              </div>
              <div className="mt-0.5 text-sm font-medium leading-snug">
                {picked.crime.address || `${picked.crime.city}, ${picked.crime.county} County`}
              </div>
              <div className="mt-0.5 font-mono text-[10px] tracking-widest text-faint uppercase">
                {fmtCrimeDate(picked.crime.date)}
                {picked.crime.city ? ` · ${picked.crime.city}` : ""}
                {picked.crime.zip ? ` · ${picked.crime.zip}` : ""}
                {isImprecise(inferGeo(picked.crime)) ? ` · ${inferGeo(picked.crime)} pin` : ""}
              </div>
              {picked.hd ? (
                <div className="mt-0.5 font-mono text-[10px] tracking-widest text-grid uppercase">{picked.hd}</div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setPicked(null)}
              className="grid size-8 shrink-0 place-items-center text-faint hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {picked.names === undefined ? (
            <p className="mt-2 font-mono text-[10px] tracking-widest text-faint uppercase">Checking public names</p>
          ) : picked.names && (picked.names.victims.length || picked.names.charged.length) ? (
            <div className="mt-2 space-y-1.5 border-t border-line pt-2">
              {picked.names.victims.length ? (
                <div>
                  <div className="font-mono text-[10px] tracking-widest text-muted uppercase">Killed</div>
                  <ul className="mt-0.5">
                    {picked.names.victims.map((p) => (
                      <li key={p.name} className="text-sm leading-snug">
                        {personLine(p)}
                        {p.note ? <span className="block font-mono text-[10px] tracking-wide text-faint">{p.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {picked.names.charged.length ? (
                <div>
                  <div className="font-mono text-[10px] tracking-widest text-muted uppercase">Charged</div>
                  <ul className="mt-0.5">
                    {picked.names.charged.map((p) => (
                      <li key={p.name} className="text-sm leading-snug">
                        {personLine(p)}
                        {p.note ? <span className="block font-mono text-[10px] tracking-wide text-faint">{p.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {picked.names.note ? (
                <p className="font-mono text-[10px] leading-relaxed tracking-wide text-muted">{picked.names.note}</p>
              ) : null}
              {picked.names.source ? (
                picked.names.href ? (
                  <a
                    href={picked.names.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block font-mono text-[10px] tracking-widest text-grid uppercase hover:underline"
                  >
                    {picked.names.source}
                  </a>
                ) : (
                  <div className="font-mono text-[10px] tracking-widest text-faint uppercase">{picked.names.source}</div>
                )
              ) : null}
            </div>
          ) : (
            <p className="mt-2 font-mono text-[10px] tracking-widest text-faint uppercase">
              No public names released
            </p>
          )}
        </div>
      ) : null}
      {pickedCam ? (
        <div
          data-map-card
          className={
            selected
              ? "pointer-events-auto absolute bottom-2 left-12 z-30 w-[min(22rem,calc(100%-4.5rem))] border border-line bg-elevated/95 px-3 py-2.5 shadow-glow"
              : "pointer-events-auto absolute top-2 left-2 z-30 w-[min(22rem,calc(100%-1rem))] border border-line bg-elevated/95 px-3 py-2.5 shadow-glow"
          }
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] tracking-widest text-grid uppercase">Traffic cam</div>
              <div className="mt-0.5 text-sm font-medium leading-snug">{pickedCam.title}</div>
              <div className="mt-0.5 font-mono text-[10px] tracking-widest text-faint uppercase">
                {camMeta(pickedCam) || "TDOT SmartWay"}
              </div>
              <div className="mt-0.5 font-mono text-[10px] tracking-widest text-muted">
                {pickedCam.lat.toFixed(5)}, {pickedCam.lon.toFixed(5)}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setPickedCam(null)}
              className="grid size-8 shrink-0 place-items-center text-faint hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <CamPlayer stream={pickedCam.stream} snap={pickedCam.snap} title={pickedCam.title} />
          <button
            type="button"
            className="mt-2 inline-flex h-8 items-center border border-grid/40 bg-grid/10 px-2 font-mono text-[10px] tracking-widest text-grid uppercase hover:bg-grid/20"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(camHref(pickedCam.id), "_blank", "noopener,noreferrer");
            }}
          >
            Watch live
          </button>
        </div>
      ) : null}
      {pickedSor ? (
        <div
          data-map-card
          className={
            selected
              ? "pointer-events-auto absolute bottom-2 left-12 z-30 w-[min(22rem,calc(100%-4.5rem))] border border-line bg-elevated/95 px-3 py-2.5 shadow-glow"
              : "pointer-events-auto absolute top-2 left-2 z-30 w-[min(22rem,calc(100%-1rem))] border border-line bg-elevated/95 px-3 py-2.5 shadow-glow"
          }
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] tracking-widest text-steel uppercase">
                {pickedSor.person?.klass ?? sorTip(pickedSor.point.k)}
              </div>
              <div className="mt-0.5 text-sm font-medium leading-snug">
                {pickedSor.person === undefined
                  ? "Looking up"
                  : pickedSor.person?.name ?? "Name not in this extract"}
              </div>
              <div className="mt-0.5 font-mono text-[10px] tracking-widest text-faint uppercase">
                {pickedSor.person
                  ? [pickedSor.person.address, pickedSor.person.city, pickedSor.person.zip].filter(Boolean).join(" · ")
                  : `${pickedSor.point.co} County`}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setPickedSor(null)}
              className="grid size-8 shrink-0 place-items-center text-faint hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {pickedSor.person?.offense ? (
            <p className="mt-2 border-t border-line pt-2 text-sm leading-snug text-muted">{pickedSor.person.offense}</p>
          ) : null}
          <a
            href="https://sor.tbi.tn.gov/search"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block font-mono text-[10px] tracking-widest text-grid uppercase hover:underline"
          >
            TBI registry
          </a>
        </div>
      ) : null}
    </div>
  );
}
