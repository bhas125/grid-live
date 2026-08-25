import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Radio } from "lucide-react";
import { countyIntel } from "@/data/intel";
import officialsJson from "@/data/officials.json";
import type {
  Alert,
  County,
  CrimeIncident,
  CrimeKind,
  CrimeLayers,
  ElectYear,
  NewsItem,
  Precinct,
  Race,
  RaceLayers,
  RaceSlice,
  SorPerson,
  TabId,
  ZipRace,
} from "@/data/types";
import { RACE_META } from "@/data/types";
import { cn, fmtAge, fmtMargin, fmtNum, fmtPct } from "@/lib/utils";
import { newsCacheAge, newsCacheKey, fetchNews, readNewsCache } from "@/lib/news-cache";
import { zipTone } from "@/lib/race-tone";
import { isFresh48 } from "@/lib/crime-fresh";
import { AboutPanel } from "./about-panel";

const TABS: { id: TabId; label: string }[] = [
  { id: "news", label: "News" },
  { id: "sit", label: "About" },
  { id: "gov", label: "Gov" },
  { id: "crime", label: "Crime" },
  { id: "vote", label: "Elections" },
];

const OFFICIALS = officialsJson as Record<string, { office: string; name: string }[]>;
const PAGE = 12;


const SOURCE_LABEL: Record<string, string> = {
  Memphis_MPD: "Memphis MPD",
  Nashville_MNPD: "Nashville MNPD",
  Chattanooga_CPD: "Chattanooga CPD",
  GVA: "Gun Violence Archive",
  News: "Local news",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtCrimeDate(iso: string | null) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month || !d) return iso;
  return `${month} ${Number(d)} ${y}`;
}

function isHomicide(type: string) {
  return type === "Homicide";
}

function isShooting(type: string) {
  const t = type.toLowerCase();
  return t.includes("shooting") || t.includes("aggravated");
}

function kindOf(type: string): CrimeKind | null {
  if (isHomicide(type)) return "hom";
  if (isShooting(type)) return "sht";
  return null;
}

function is2026(c: CrimeIncident) {
  return (c.date ?? "").startsWith("2026");
}

function staleStory(c: CrimeIncident) {
  const t = `${c.address ?? ""} ${c.offense ?? ""}`;
  if (c.source !== "News") return false;
  if (/\b2025\b|\b2024\b/.test(t) && !/\b2026\b/.test(t)) return true;
  return false;
}

function prettyAddr(raw: string) {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (/^(\d+)\s+\1$/.test(t)) return "";
  return t;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 border border-line bg-surface px-2">
      <span className="font-mono text-xs tracking-wide text-faint uppercase">{k}</span>
      <span className="font-mono text-xs text-fg">{v}</span>
    </span>
  );
}

function NewsFeed({
  county,
  seat,
  market,
  extra,
  active,
}: {
  county: string | null;
  seat?: string;
  market?: string;
  extra: NewsItem[];
  active: boolean;
}) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [status, setStatus] = useState<"load" | "ok" | "err">("load");
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const key = newsCacheKey(county, seat, market);
    const cached = readNewsCache(key);
    if (cached?.length) {
      setItems(cached);
      setStatus("ok");
    } else {
      setStatus("load");
    }
    setShown(PAGE);
    const age = newsCacheAge(key);
    const fresh = age == null || age > 15_000;
    fetchNews(county, seat, market, fresh)
      .then((next) => {
        if (!live) return;
        setItems(next);
        setStatus("ok");
      })
      .catch(() => {
        if (live && !cached?.length) setStatus("err");
      });
    return () => {
      live = false;
    };
  }, [county, seat, market]);

  useEffect(() => {
    if (!active) return;
    let live = true;
    const pull = () => {
      if (document.visibilityState === "hidden") return;
      const key = newsCacheKey(county, seat, market);
      const age = newsCacheAge(key);
      fetchNews(county, seat, market, age == null || age > 12_000)
        .then((next) => {
          if (!live) return;
          setItems(next);
          setStatus("ok");
        })
        .catch(() => undefined);
    };
    const tick = window.setInterval(pull, 15_000);
    const onVis = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, county, seat, market]);

  const merged = useMemo(() => {
    const all = [...extra, ...items];
    const seen = new Set<string>();
    const out: NewsItem[] = [];
    for (const it of all) {
      if (seen.has(it.headline)) continue;
      seen.add(it.headline);
      if (county && it.county && it.county !== county) continue;
      out.push(it);
    }
    return out;
  }, [items, extra, county]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setShown((n) => Math.min(merged.length, n + PAGE));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [merged.length]);

  const visible = merged.slice(0, shown);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {status === "load" && !visible.length ? (
        <p className="px-4 py-3 font-mono text-xs tracking-widest text-faint uppercase">
          Loading feed
        </p>
      ) : null}
      {status === "err" ? (
        <p className="px-4 py-3 text-sm text-muted">News feed unavailable.</p>
      ) : null}
      <ul>
        {visible.map((it, i) => (
          <li key={`${it.id}-${it.href}-${i}`} className="border-t border-line">
            <a
              href={it.href}
              target="_blank"
              rel="noreferrer"
              className="block px-4 py-2.5 hover:bg-elevated"
            >
              <div className="flex items-center gap-2 font-mono text-xs tracking-wide text-faint uppercase">
                <span>{it.source}</span>
                {it.county ? <span>· {it.county}</span> : null}
                <span className="ml-auto">{fmtAge(it.published)}</span>
              </div>
              <div className="mt-0.5 text-sm leading-snug">{it.headline}</div>
            </a>
          </li>
        ))}
      </ul>
      {status === "ok" && merged.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">No sourced items.</p>
      ) : null}
      <div ref={sentinel} className="h-4" />
    </div>
  );
}

function CrimeFeed({
  county,
  incidents,
  crimeLayers,
  onPickCrime,
}: {
  county: County | null;
  incidents: CrimeIncident[];
  crimeLayers: CrimeLayers;
  onPickCrime?: (c: CrimeIncident) => void;
}) {
  const [shownHom, setShownHom] = useState(PAGE);
  const [shownSht, setShownSht] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const intel = county ? countyIntel(county.name) : null;

  const scoped = useMemo(() => {
    const rows = county ? incidents.filter((i) => i.county === county.name) : incidents;
    return rows.filter((i) => {
      if (!is2026(i) || staleStory(i)) return false;
      if (crimeLayers.h48 && !isFresh48(i.date)) return false;
      return true;
    });
  }, [incidents, county, crimeLayers.h48]);

  const homOn = crimeLayers.hom || (crimeLayers.h48 && !crimeLayers.hom && !crimeLayers.sht);
  const shtOn = crimeLayers.sht || (crimeLayers.h48 && !crimeLayers.hom && !crimeLayers.sht);

  const homList = useMemo(() => {
    if (!homOn) return [] as CrimeIncident[];
    return scoped.filter((i) => isHomicide(i.type)).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [scoped, homOn]);

  const shtList = useMemo(() => {
    if (!shtOn) return [] as CrimeIncident[];
    return scoped.filter((i) => isShooting(i.type)).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [scoped, shtOn]);

  const stats = useMemo(
    () => ({ hom: homList.length, sht: shtList.length, n: homList.length + shtList.length }),
    [homList, shtList],
  );

  useEffect(() => {
    setShownHom(PAGE);
    setShownSht(PAGE);
  }, [county?.name, incidents.length, crimeLayers.hom, crimeLayers.sht, crimeLayers.h48]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setShownHom((n) => Math.min(homList.length, n + PAGE));
      setShownSht((n) => Math.min(shtList.length, n + PAGE));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [homList.length, shtList.length]);

  const visibleHom = homList.slice(0, shownHom);
  const visibleSht = shtList.slice(0, shownSht);

  return (
    <div>
      <div className="flex flex-wrap gap-2 px-4 pb-2">
        <Stat k="2026" v={`${fmtNum(stats.n)} pts`} />
        <Stat k="Hom" v={fmtNum(stats.hom)} />
        <Stat k="Sht" v={fmtNum(stats.sht)} />
      </div>
      <p className="px-4 pb-2 font-mono text-xs leading-relaxed tracking-wide text-muted">
        {crimeLayers.h48 ? (
          <span className="text-fresh">
            List: last 48 hours{county ? ` · ${county.name}` : ""}. Map still shows all Hom/Sht; recent stay purple.
          </span>
        ) : county ? (
          (intel?.crimeNote ?? `${county.name} · 2026 homicide / shooting points.`)
        ) : (
          "Latest 2026 homicides first, then shootings. MNPD, MPD, CPD, GVA, and statewide news."
        )}
      </p>
      {!incidents.length ? (
        <p className="px-4 py-3 font-mono text-xs tracking-widest text-faint uppercase">Loading incidents</p>
      ) : null}
      {homOn && visibleHom.length ? (
        <>
          <div className="px-4 pt-1 font-mono text-[10px] tracking-widest text-hot uppercase">Homicides</div>
          <CrimeRows rows={visibleHom} onPickCrime={onPickCrime} />
        </>
      ) : null}
      {shtOn && visibleSht.length ? (
        <>
          <div className="px-4 pt-2 font-mono text-[10px] tracking-widest text-watch uppercase">Shootings</div>
          <CrimeRows rows={visibleSht} onPickCrime={onPickCrime} />
        </>
      ) : null}
      {incidents.length > 0 && !homList.length && !shtList.length ? (
        <p className="px-4 py-3 text-sm text-muted">
          No 2026 homicide / shooting points in this county yet. Official city feeds cover
          Memphis, Nashville, and Chattanooga; statewide GVA coverage runs through June 30.
        </p>
      ) : null}
      <div ref={sentinel} className="h-4" />
    </div>
  );
}

function CrimeRows({
  rows,
  onPickCrime,
}: {
  rows: CrimeIncident[];
  onPickCrime?: (c: CrimeIncident) => void;
}) {
  return (
    <ul>
      {rows.map((it) => {
        const addr = prettyAddr(it.address);
        const where = [it.city, it.county ? `${it.county} County` : "", it.zip].filter(Boolean).join(" · ");
        return (
          <li key={it.id} className="border-t border-line">
            <button
              type="button"
              onClick={() => onPickCrime?.(it)}
              className="w-full px-4 py-2.5 text-left hover:bg-grid/10"
            >
              <div className="flex items-center gap-2 font-mono text-xs tracking-wide uppercase">
                <span className={isFresh48(it.date) ? "text-fresh" : isHomicide(it.type) ? "text-hot" : "text-watch"}>
                  {isFresh48(it.date) ? `48h · ${it.type}` : it.type}
                </span>
                <span className="ml-auto text-faint">{fmtCrimeDate(it.date)}</span>
              </div>
              <div className="mt-0.5 text-sm leading-snug">{addr || where || it.type}</div>
              <div className="mt-0.5 font-mono text-xs tracking-wide text-faint uppercase">
                {addr ? where : it.county ? `${it.county} County` : ""}
                {where || addr ? " · " : ""}
                {SOURCE_LABEL[it.source] ?? it.source}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const KLASS_TONE: Record<string, string> = {
  Violent: "text-hot",
  "Against children": "text-watch",
  "Sexual offender": "text-steel",
};

function SorFeed({ county, active }: { county: County | null; active: boolean }) {
  const [rows, setRows] = useState<SorPerson[]>([]);
  const [status, setStatus] = useState<"idle" | "load" | "ok">("idle");
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    if (!county) {
      setRows([]);
      setStatus("ok");
      return;
    }
    let live = true;
    setStatus("load");
    setShown(PAGE);
    fetch(`/api/sor?county=${encodeURIComponent(county.name)}`, { signal: AbortSignal.timeout(15000) })
      .then((r) => r.json())
      .then((d: { offenders?: SorPerson[] }) => {
        if (!live) return;
        setRows(d.offenders ?? []);
        setStatus("ok");
      })
      .catch(() => {
        if (live) {
          setRows([]);
          setStatus("ok");
        }
      });
    return () => {
      live = false;
    };
  }, [county?.name, active]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setShown((n) => Math.min(rows.length, n + PAGE));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length]);

  const counts = useMemo(() => {
    let v = 0;
    let c = 0;
    let s = 0;
    for (const r of rows) {
      if (r.klass === "Violent") v += 1;
      else if (r.klass === "Against children") c += 1;
      else s += 1;
    }
    return { v, c, s, n: rows.length };
  }, [rows]);

  const visible = rows.slice(0, shown);

  return (
    <div>
      <div className="flex flex-wrap gap-2 px-4 pb-2">
        <Stat k="TBI" v={`${fmtNum(counts.n)}`} />
        {counts.v ? <Stat k="Violent" v={fmtNum(counts.v)} /> : null}
        {counts.c ? <Stat k="Child" v={fmtNum(counts.c)} /> : null}
      </div>
      <p className="px-4 pb-2 font-mono text-xs leading-relaxed tracking-wide text-muted">
        {county
          ? `${county.name} · public TBI sex offender registry. Address as reported.`
          : "Public TBI registry. Search an address or click a county to list people in that area."}
      </p>
      {status === "load" ? (
        <p className="px-4 py-3 font-mono text-xs tracking-widest text-faint uppercase">Loading registry</p>
      ) : null}
      {!county && status === "ok" ? (
        <p className="px-4 py-3 text-sm text-muted">Pick a county or search an address to list registrants.</p>
      ) : null}
      {county && status === "ok" && !rows.length ? (
        <p className="px-4 py-3 text-sm text-muted">No mapped registry points in this county.</p>
      ) : null}
      <ul>
        {visible.map((it) => (
          <li key={it.id} className="border-t border-line px-4 py-2.5">
            <div className="flex items-center gap-2 font-mono text-xs tracking-wide uppercase">
              <span className={KLASS_TONE[it.klass] ?? "text-steel"}>{it.klass}</span>
            </div>
            <div className="mt-0.5 text-sm leading-snug">{it.name}</div>
            <div className="mt-0.5 font-mono text-xs tracking-wide text-faint uppercase">
              {it.address || "Address unlisted"}
              {it.city ? ` · ${it.city}` : ""}
              {it.zip ? ` · ${it.zip}` : ""}
            </div>
            {it.offense ? <div className="mt-0.5 text-sm leading-snug text-muted">{it.offense}</div> : null}
          </li>
        ))}
      </ul>
      <div ref={sentinel} className="h-4" />
    </div>
  );
}

function VotePrecinct({
  name,
  races,
  fallback,
}: {
  name: string;
  races?: Race[];
  fallback: Precinct;
}) {
  const other = Math.max(0, fallback.t - fallback.d - fallback.r);
  const list: Race[] =
    races && races.length
      ? races
      : [
          {
            o: "President",
            d: "",
            c: [
              { n: "Donald Trump", p: "REP", v: fallback.r },
              { n: "Kamala Harris", p: "DEM", v: fallback.d },
              ...(other ? [{ n: "Other", p: "", v: other }] : []),
            ],
          },
        ];
  return (
    <div className="space-y-2 overflow-y-auto px-4 pb-3">
      <p className="font-mono text-xs tracking-widest text-grid uppercase">
        Precinct {name} · 2024
      </p>
      {list.map((race) => {
        const tot = race.c.reduce((s, c) => s + c.v, 0) || 1;
        const label = race.d && race.d !== "NA" ? `${race.o} ${race.d}` : race.o;
        return (
          <div key={`${race.o}-${race.d}`} className="border-t border-line pt-1.5">
            <div className="font-mono text-xs tracking-wide text-muted uppercase">{label}</div>
            <ul className="mt-0.5 space-y-0.5">
              {race.c.map((c) => (
                <li key={c.n} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    {c.n}
                    {c.p ? <span className="ml-1 font-mono text-xs text-faint">{c.p}</span> : null}
                  </span>
                  <span className="font-mono text-xs tabular">
                    {c.v.toLocaleString()} · {Math.round((c.v / tot) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function CrimeShare({
  county,
  incidents,
  layers,
}: {
  county: County;
  incidents: CrimeIncident[];
  layers: CrimeLayers;
}) {
  const share = useMemo(() => {
    let stateHom = 0;
    let stateSht = 0;
    let ctyHom = 0;
    let ctySht = 0;
    for (const i of incidents) {
      if (!is2026(i) || staleStory(i)) continue;
      if (isHomicide(i.type)) {
        stateHom += 1;
        if (i.county === county.name) ctyHom += 1;
      } else if (isShooting(i.type)) {
        stateSht += 1;
        if (i.county === county.name) ctySht += 1;
      }
    }
    const useHom = layers.hom;
    const useSht = layers.sht;
    const num = (useHom ? ctyHom : 0) + (useSht ? ctySht : 0);
    const den = (useHom ? stateHom : 0) + (useSht ? stateSht : 0);
    const label =
      useHom && useSht ? "homicides + shootings" : useHom ? "homicides" : "shootings";
    return {
      num,
      den,
      pct: den ? (num / den) * 100 : 0,
      label,
      useHom,
      useSht,
    };
  }, [incidents, county.name, layers]);

  if (!layers.hom && !layers.sht) return null;
  if (!incidents.length || share.den === 0) return null;

  const big = share.pct >= 10 ? share.pct.toFixed(0) : share.pct.toFixed(1);

  return (
    <p className="shrink-0 px-3 py-0.5 text-center font-mono text-[10px] leading-tight tracking-wide text-hot uppercase">
      {county.name} · {big}% of Tennessee {share.label} · {fmtNum(share.num)} of {fmtNum(share.den)}
    </p>
  );
}

function raceCount(z: ZipRace, slice: RaceSlice | null) {
  if (!slice) return z.t;
  return z[slice];
}

function RaceFeed({
  zips,
  raceLayers,
  pickedZip,
  onPickZip,
}: {
  zips: ZipRace[] | null;
  raceLayers: RaceLayers;
  pickedZip: string | null;
  onPickZip: (z: ZipRace) => void;
}) {
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const slices = RACE_META.filter((s) => raceLayers[s.id]);

  const list = useMemo(() => {
    const rows = [...(zips ?? [])];
    const active = RACE_META.filter((s) => raceLayers[s.id]);
    if (active.length === 1) {
      const slice = active[0].id;
      rows.sort((a, b) => {
        const sa = a.t ? a[slice] / a.t : 0;
        const sb = b.t ? b[slice] / b.t : 0;
        if (sb !== sa) return sb - sa;
        return b[slice] - a[slice];
      });
    } else if (active.length > 1) {
      rows.sort((a, b) => {
        const sa = active.reduce((n, s) => n + a[s.id], 0);
        const sb = active.reduce((n, s) => n + b[s.id], 0);
        return sb - sa;
      });
    } else {
      rows.sort((a, b) => a.z.localeCompare(b.z));
    }
    return rows;
  }, [zips, raceLayers]);

  useEffect(() => {
    setShown(PAGE);
  }, [zips, raceLayers]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setShown((n) => Math.min(list.length, n + PAGE));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length]);

  const visible = list.slice(0, shown);
  const one = slices.length === 1 ? slices[0] : null;

  return (
    <div>
      <p className="px-4 pb-2 font-mono text-xs leading-relaxed tracking-wide text-muted">
        {slices.some((s) => s.id === "w") && slices.some((s) => s.id === "b" || s.id === "h")
          ? "White → gray → black. White majority, even mix, then Black/Hisp majority. ACS 2024 5-year."
          : one
            ? `ZIP share ${one.label}. ${one.id === "w" ? "Lighter = more White." : one.id === "b" || one.id === "h" ? "Darker = denser." : "Share of ZIP."} ACS 2024 5-year.`
            : "County ZIP outlines. White–gray–black majority scale. ACS 2024 5-year."}
      </p>
      {zips === null ? (
        <p className="px-4 py-3 font-mono text-xs tracking-widest text-faint uppercase">Loading ZIP race</p>
      ) : null}
      {zips && !zips.length ? (
        <p className="px-4 py-3 font-mono text-xs tracking-widest text-faint uppercase">No ZIP race for this county</p>
      ) : null}
      <ul>
        {visible.map((z) => {
          const on = pickedZip === z.z;
          const n = one ? raceCount(z, one.id) : slices.reduce((sum, s) => sum + z[s.id], 0);
          const share = z.t ? (n / z.t) * 100 : 0;
          const tone = zipTone(z, raceLayers);
          return (
            <li key={z.z} className="border-t border-line">
              <button
                type="button"
                onClick={() => onPickZip(z)}
                className={cn("w-full px-4 py-2.5 text-left hover:bg-grid/10", on ? "bg-grid/10" : undefined)}
              >
                <div className="flex items-center gap-2 font-mono text-xs tracking-wide uppercase">
                  <span className={on ? "text-grid" : "text-muted"}>ZIP {z.z}</span>
                  <span className="ml-auto text-faint">{fmtNum(z.t)} people</span>
                </div>
                {one ? (
                  <div className="mt-0.5 text-sm leading-snug">
                    {fmtNum(n)} · {fmtPct(share)} {one.label}
                  </div>
                ) : (
                  <>
                    <div className="mt-1 h-1.5 overflow-hidden bg-bg">
                      <div className="h-full w-full" style={{ background: tone.fill }} />
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] tracking-wide text-faint uppercase">
                      W {fmtPct(tone.whitePct * 100)} · B/H {fmtPct(tone.brownPct * 100)}
                      {tone.tone === "mix"
                        ? " · even"
                        : tone.tone === "white"
                          ? " · white maj."
                          : tone.tone === "black"
                            ? " · B/H maj."
                            : ""}
                    </div>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div ref={sentinel} className="h-4" />
    </div>
  );
}

export function FeedPanel({
  county,
  tab,
  onTab,
  alerts,
  precinct,
  races,
  briefs,
  expanded,
  onToggleExpand,
  onHide,
  crime,
  crimeLayers,
  onPickCrime,
  electYear,
  onElectYear,
  raceOn,
  raceLayers,
  zips,
  pickedZip,
  onPickZip,
}: {
  county: County | null;
  tab: TabId;
  onTab: (t: TabId) => void;
  alerts: Alert[];
  precinct: Precinct | null;
  races?: Race[];
  briefs: Record<string, string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onHide: () => void;
  crime: CrimeIncident[];
  crimeLayers: CrimeLayers;
  onPickCrime?: (c: CrimeIncident) => void;
  electYear: ElectYear;
  onElectYear: (y: ElectYear) => void;
  raceOn: boolean;
  raceLayers: RaceLayers;
  zips: ZipRace[] | null;
  pickedZip: string | null;
  onPickZip: (z: ZipRace) => void;
}) {
  const extra: NewsItem[] = (county ? alerts.filter((a) => a.counties.includes(county.name)) : alerts).map(
    (a) => ({
      id: a.id,
      kind: "official" as const,
      source: "NWS",
      headline: a.headline,
      href: a.href,
      county: county?.name,
      published: new Date().toUTCString(),
      ongoing: true,
    }),
  );
  const roster = county ? (OFFICIALS[county.name] ?? []) : [];
  const brief = county ? briefs[county.name] : undefined;
  const scanner = county ? countyIntel(county.name).scanner : undefined;

  return (
    <section
      className={cn(
        "flex shrink-0 flex-col border-t border-line bg-bg-2 transition-[max-height,height] duration-200",
        expanded ? "h-[75dvh] max-h-[75dvh]" : "max-h-44 sm:max-h-52",
      )}
    >
      <div className="flex items-center gap-1 px-3">
        {TABS.map((t) => {
          if (t.id !== "news" && t.id !== "crime" && !county) return null;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={cn(
                "h-8 min-w-12 px-2 font-mono text-xs tracking-widest uppercase",
                tab === t.id ? "text-grid" : "text-faint hover:text-muted",
              )}
            >
              {t.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? "Minimize news" : "Enlarge news"}
          title={expanded ? "Minimize" : "Enlarge"}
          className={cn(
            "ml-auto grid size-8 place-items-center text-grid hover:text-fg",
            expanded ? "invisible pointer-events-none" : undefined,
          )}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
        {expanded ? null : (
          <button
            type="button"
            onClick={onHide}
            aria-label="Hide panel"
            title="Hide panel"
            className="grid size-8 place-items-center text-faint hover:text-grid"
          >
            <ChevronDown className="size-3.5" />
          </button>
        )}
      </div>
      {tab === "crime" && scanner ? (
        <div className="flex items-center gap-1 overflow-x-auto px-3 pb-1">
          <a
            href={scanner.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 shrink-0 items-center gap-1 border border-line px-2 font-mono text-[10px] tracking-widest text-grid uppercase hover:border-grid"
          >
            <Radio className="size-3" />
            Scanner
          </a>
        </div>
      ) : null}
      {tab === "vote" ? (
        <div className="flex items-center gap-1 px-3 pb-1">
          {(["2024", "2026"] as const).map((y) => {
            const on = electYear === y;
            return (
              <button
                key={y}
                type="button"
                onClick={() => onElectYear(y)}
                aria-pressed={on}
                className={cn(
                  "h-6 border px-2 font-mono text-[10px] tracking-widest uppercase",
                  on ? "border-grid bg-grid/15 text-grid" : "border-line text-faint hover:text-muted",
                )}
              >
                {y}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className={tab === "news" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <NewsFeed
          county={county?.name ?? null}
          seat={county?.seat}
          market={county?.market}
          extra={extra}
          active={tab === "news"}
        />
      </div>
      <div className={tab === "crime" ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : "hidden"}>
        {crimeLayers.hom || crimeLayers.sht || crimeLayers.h48 ? (
          <CrimeFeed county={county} incidents={crime} crimeLayers={crimeLayers} onPickCrime={onPickCrime} />
        ) : null}
        {crimeLayers.reg ? <SorFeed county={county} active={tab === "crime" && crimeLayers.reg} /> : null}
        {!crimeLayers.hom && !crimeLayers.sht && !crimeLayers.h48 && !crimeLayers.reg ? (
          <p className="px-4 py-3 font-mono text-xs tracking-widest text-faint uppercase">
            Turn on Hom, Sht, 48 Hours, or Registry
          </p>
        ) : null}
      </div>
      <div className={tab === "sit" && county ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : "hidden"}>
        {county ? (
          <>
            <AboutPanel county={county} brief={brief} active={tab === "sit"} />
            {raceOn ? (
              <div className="border-t border-line pt-2">
                <div className="px-4 pb-1 font-mono text-[10px] tracking-widest text-grid uppercase">ZIP race</div>
                <RaceFeed zips={zips} raceLayers={raceLayers} pickedZip={pickedZip} onPickZip={onPickZip} />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {tab === "vote" && county ? (
        electYear === "2026" ? (
          <div className="space-y-2 overflow-y-auto px-4 pb-3">
            <p className="font-mono text-xs tracking-widest text-grid uppercase">August 6 2026 · county</p>
            <p className="text-sm text-fg/90">
              {county.aug6
                ? county.aug6.note
                : "County general / state primary. No precinct GIS published for this cycle — 2026 precinct maps are not out yet."}
            </p>
            {county.aug6?.offices?.length ? (
              <p className="font-mono text-xs text-muted">
                Offices in play: {county.aug6.offices.join(" · ")}
              </p>
            ) : null}
          </div>
        ) : precinct ? (
          <VotePrecinct name={precinct.name} races={races} fallback={precinct} />
        ) : (
          <div className="space-y-2 overflow-y-auto px-4 pb-3">
            <div className="flex h-1 overflow-hidden bg-bg">
              <div className="bg-gop" style={{ width: `${county.trumpPct}%` }} />
              <div className="bg-dem" style={{ width: `${county.harrisPct}%` }} />
            </div>
            <p className="font-mono text-xs text-muted">
              2024 · Trump {fmtPct(county.trumpPct)} · Harris {fmtPct(county.harrisPct)} ·{" "}
              {fmtMargin(county.margin)}
            </p>
            <p className="text-sm text-fg/90">
              Click a precinct on the map for 2024 race tallies through State House.
            </p>
          </div>
        )
      ) : null}
      {tab === "gov" && county ? (
        <div className="overflow-y-auto px-4 pb-3">
          {roster.length ? (
            <ul>
              {roster.map((row) => (
                <li
                  key={`${row.office}-${row.name}`}
                  className="flex items-baseline justify-between gap-3 border-t border-line py-1 text-sm"
                >
                  <span className="font-mono text-xs tracking-wide text-muted uppercase">
                    {row.office}
                  </span>
                  <span>{row.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">CTAS directory has no roster for this county.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
