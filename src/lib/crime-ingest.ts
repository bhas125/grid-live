import type { CrimeIncident } from "@/data/types";
import { CITY_COUNTY, COUNTY_XY, countyFromText } from "@/lib/county-xy";

const UA = "GridTN/1.0 (tennessee situation monitor; grid.blakehassler.com)";
const FETCH_MS = 4500;

const NASH =
  "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0/query";
const MEM =
  "https://services2.arcgis.com/saWmpKJIUAjyyNVc/arcgis/rest/services/MPD_Public_Safety_Incidents_Mapping/FeatureServer/0/query";

const NEWS_SKIP =
  /boston|dorchester|south station|probation|daycare|security deposit|penn state|louisville|kentucky|north carolina|struck by vehicle|traffic crash|car crash|cycling team|wreck on/i;

function ymd(ms: number) {
  try {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function gun(weapon: string) {
  return /GUN|FIREARM|RIFLE|SHOTGUN|REVOLVER|PISTOL/i.test(weapon);
}

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function arcgis(url: string, where: string, fields: string, order: string) {
  const q = new URL(url);
  q.searchParams.set("where", where);
  q.searchParams.set("outFields", fields);
  q.searchParams.set("orderByFields", order);
  q.searchParams.set("resultRecordCount", "250");
  q.searchParams.set("returnGeometry", "false");
  q.searchParams.set("f", "pjson");
  const res = await fetch(q, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) throw new Error(`arcgis ${res.status}`);
  const d = (await res.json()) as { features?: { attributes: Record<string, unknown> }[] };
  return d.features ?? [];
}

function fromNash(a: Record<string, unknown>): CrimeIncident | null {
  const id = String(a.Incident_Number ?? "");
  const lat = num(a.Latitude);
  const lon = num(a.Longitude);
  if (!id || !lat || !lon) return null;
  const nibrs = String(a.Offense_NIBRS ?? "");
  const offense = String(a.Offense_Description ?? "");
  const weapon = String(a.Weapon_Description ?? "");
  const homicide = nibrs === "09A" || nibrs === "09C" || /homicide|murder/i.test(offense);
  if (!homicide && !(nibrs === "13A" && gun(weapon))) return null;
  const zip = String(a.ZIP_Code ?? "").replace(/\.0$/, "");
  return {
    id: `NASH-${id}`,
    date: ymd(num(a.Incident_Occurred)),
    city: "Nashville",
    county: "Davidson",
    address: String(a.Incident_Location ?? "").trim(),
    zip: zip || undefined,
    lat,
    lon,
    type: homicide ? "Homicide" : "Shooting / aggravated assault",
    offense: [offense, weapon].filter((x) => x && x !== "NONE").join(" · "),
    source: "Nashville_MNPD",
    killed: homicide ? 1 : 0,
    injured: 0,
  };
}

function fromMem(a: Record<string, unknown>): CrimeIncident | null {
  const raw = String(a.Crime_ID ?? "");
  const lat = num(a.Latitude);
  const lon = num(a.Longitude);
  if (!raw || !lat || !lon) return null;
  const code = String(a.UCR_Incident_Code ?? "");
  const cat = String(a.UCR_Category ?? "");
  const desc = String(a.UCR_Description ?? "");
  const homicide = code === "09A" || cat === "HOMICIDE";
  const assault = code === "13A" || /aggravated assault/i.test(desc);
  if (!homicide && !assault) return null;
  return {
    id: `MEM-${raw}`,
    date: ymd(num(a.Offense_Datetime)),
    city: String(a.City ?? "MEMPHIS"),
    county: "Shelby",
    address: String(a.Full_Address || a.Street_Address || "").trim(),
    zip: String(a.ZIP_Code ?? "") || undefined,
    lat,
    lon,
    type: homicide ? "Homicide" : "Shooting / aggravated assault",
    offense: desc || cat,
    source: "Memphis_MPD",
    killed: homicide ? 1 : 0,
    injured: 0,
  };
}

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&/g, "&");
}

function rssDay(raw: string) {
  const d = new Date(raw);
  if (Number.isNaN(+d)) return daysAgo(0);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function newsCounty(title: string) {
  const re = /\bin ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title))) {
    const hit = CITY_COUNTY[m[1].toLowerCase()];
    if (hit) last = hit;
  }
  return last || countyFromText(title);
}

function staleNews(title: string) {
  if (/\b2025\b|\b2024\b/.test(title) && !/\b2026\b/.test(title)) return true;
  if (/grand jury|indicts|indicted|sentenced|convicted/i.test(title) && /\b2025\b|\b2024\b/.test(title)) return true;
  return false;
}

function newsKind(title: string) {
  const attempted = /attempted murder|attempted homicide/i.test(title);
  const fatal = !attempted && /homicide|murder|killed|fatal|\bdead\b|dies|died|death of/i.test(title);
  if (fatal) {
    return {
      type: "Homicide" as const,
      killed: 1,
      offense: /shot|gun|shooting/i.test(title) ? "Gun homicide" : "Homicide",
    };
  }
  return {
    type: "Shooting" as const,
    killed: 0,
    offense: /officer-involved|officer involved/i.test(title) ? "Officer-involved shooting" : "Shooting",
  };
}

function newsPlace(title: string, county: string) {
  const street = title.match(
    /\b\d{1,5}\s+[\w.'-]+(?:\s[\w.'-]+){0,3}\s(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|highway|hwy|pike|way|circle|cir|court|ct|parkway|pkwy)\b/i,
  );
  if (street) return `${street[0]}, ${county} County, TN`;
  const city = title.match(/\b(?:in|near|at)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?:\s|,|$)/);
  if (city) return `${city[1]}, ${county} County, TN`;
  return "";
}

async function geocodeTn(q: string): Promise<{ lat: number; lon: number; label?: string } | null> {
  const addr = /tn\b|tennessee/i.test(q) ? q : `${q}, Tennessee`;
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addr)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const json = (await res.json()) as {
        result?: { addressMatches?: { matchedAddress?: string; coordinates?: { x?: number; y?: number } }[] };
      };
      const m = json.result?.addressMatches?.[0];
      const lat = m?.coordinates?.y;
      const lon = m?.coordinates?.x;
      if (typeof lat === "number" && typeof lon === "number" && lat >= 34.8 && lat <= 36.8 && lon >= -90.5 && lon <= -81.4) {
        return { lat, lon, label: m?.matchedAddress };
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(addr)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    const m = json[0];
    const lat = Number(m?.lat);
    const lon = Number(m?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 34.8 || lat > 36.8 || lon < -90.5 || lon > -81.4) return null;
    return { lat, lon, label: m?.display_name };
  } catch {
    return null;
  }
}

async function fromNews(): Promise<CrimeIncident[]> {
  const q = `Tennessee (homicide OR murder OR "fatal shooting" OR "shot and killed" OR shooting OR "officer-involved") when:5d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: CrimeIncident[] = [];
    const seen = new Set<string>();
    let geoLeft = 8;
    for (const chunk of xml.split(/<item>/i).slice(1).slice(0, 40)) {
      const title = decode((chunk.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
      const pub = decode((chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "").trim());
      if (!title) continue;
      if (NEWS_SKIP.test(title)) continue;
      if (staleNews(title)) continue;
      if (!/homicide|killed|fatal|murder|shooting|shot|officer-involved/i.test(title)) continue;
      if (!/tennessee|\btn\b|county|knoxville|memphis|nashville|chattanooga|clarksville|murfreesboro/i.test(title)) continue;
      const county = newsCounty(title);
      if (!county) continue;
      const kind = newsKind(title);
      if ((county === "Shelby" || county === "Davidson") && kind.type !== "Homicide") continue;
      const xy = COUNTY_XY[county];
      if (!xy) continue;
      const date = rssDay(pub);
      const dayKey = `${county}|${date}|${kind.type}`;
      if (seen.has(dayKey)) continue;
      seen.add(dayKey);
      let lat = xy[0];
      let lon = xy[1];
      let address = title.replace(/\s+-\s+[^-]+$/, "").slice(0, 90);
      const place = newsPlace(title, county);
      if (place && geoLeft > 0) {
        geoLeft -= 1;
        const hit = await geocodeTn(place);
        if (hit) {
          lat = hit.lat;
          lon = hit.lon;
          if (hit.label && /\d/.test(hit.label)) address = hit.label;
        }
      }
      out.push({
        id: `NEWS-${date}-${county}-${kind.type === "Homicide" ? "H" : "S"}`,
        date,
        city: "",
        county,
        address,
        lat,
        lon,
        type: kind.type,
        offense: kind.offense,
        source: "News",
        killed: kind.killed,
        injured: 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function unique(rows: CrimeIncident[]) {
  const seen = new Set<string>();
  const out: CrimeIncident[] = [];
  for (const r of rows) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export async function fetchNewCrime(since?: string): Promise<CrimeIncident[]> {
  const from = since && since >= "2026-01-01" ? since : daysAgo(4);
  const nashWhere = `Incident_Occurred > DATE '${from}' AND (Offense_NIBRS IN ('09A','09C','13A'))`;
  const memWhere = `Offense_Datetime > DATE '${from}' AND (UCR_Incident_Code IN ('09A','13A') OR UCR_Category = 'HOMICIDE')`;
  const jobs = await Promise.allSettled([
    arcgis(
      NASH,
      nashWhere,
      "Incident_Number,Incident_Location,Latitude,Longitude,Offense_Description,Weapon_Description,Offense_NIBRS,ZIP_Code,Incident_Occurred",
      "Incident_Occurred DESC",
    ).then((rows) => rows.map((f) => fromNash(f.attributes)).filter((x): x is CrimeIncident => Boolean(x))),
    arcgis(
      MEM,
      memWhere,
      "Crime_ID,Offense_Datetime,Street_Address,ZIP_Code,Latitude,Longitude,UCR_Category,UCR_Description,UCR_Incident_Code,Full_Address,City",
      "Offense_Datetime DESC",
    ).then((rows) => rows.map((f) => fromMem(f.attributes)).filter((x): x is CrimeIncident => Boolean(x))),
    fromNews(),
  ]);
  const rows: CrimeIncident[] = [];
  for (const j of jobs) {
    if (j.status === "fulfilled") rows.push(...j.value);
  }
  const pd = unique(rows.filter((r) => r.source !== "News"));
  const seenDay = new Set(pd.filter((r) => r.type === "Homicide").map((r) => `${r.county}|${r.date}`));
  for (const n of rows.filter((r) => r.source === "News")) {
    if (n.type === "Homicide" && seenDay.has(`${n.county}|${n.date}`)) continue;
    pd.push(n);
    if (n.type === "Homicide") seenDay.add(`${n.county}|${n.date}`);
  }
  return unique(pd);
}
