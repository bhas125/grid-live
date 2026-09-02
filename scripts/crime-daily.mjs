#!/usr/bin/env node
/**
 * Merge new homicides + shootings into public/crime-tn.json.
 * GitHub Actions runs this twice a day and commits the file — that JSON is
 * the permanent store on Vercel CDN. The map never depends on a sandbox.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "public", "crime-tn.json");
const UA = "GridTN/1.0 (tennessee situation monitor; grid.blakehassler.com)";

const NASH =
  "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0/query";
const MEM =
  "https://services2.arcgis.com/saWmpKJIUAjyyNVc/arcgis/rest/services/MPD_Public_Safety_Incidents_Mapping/FeatureServer/0/query";

const NEWS_SKIP =
  /boston|dorchester|south station|probation|daycare|security deposit|penn state|louisville|kentucky|north carolina|struck by vehicle|traffic crash|car crash|cycling team|wreck on/i;

function streetish(addr) {
  const a = String(addr ?? "");
  if (!a) return false;
  if (/killed|homicide|murder|fatal|investigation underway|indict|grand jury|suspect captured|deputies on leave|still searching|officer-involved shooting|tbi identifies|tbi investigates/i.test(a) && !/\d/.test(a)) {
    return false;
  }
  return /\d/.test(a) && /(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|highway|hwy|pike|way|circle|cir|court|ct|parkway|pkwy|place|pl|block|&|\/)/i.test(a);
}

function isHeadlineNews(r) {
  if (!r || r.source !== "News") return false;
  const prec = String(r.geocode_precision ?? "");
  if (["address", "intersection", "block"].includes(prec)) return false;
  return !streetish(r.address);
}

function nearbyBetterNews(existing, incoming) {
  const t = Date.parse(`${incoming.date}T12:00:00`);
  return existing.some((r) => {
    if (r.source !== "News") return false;
    if (String(r.county ?? "") !== incoming.county) return false;
    if (r.type !== incoming.type) return false;
    const d = Date.parse(`${r.date}T12:00:00`);
    if (!Number.isFinite(t) || !Number.isFinite(d) || Math.abs(d - t) > 86400000 * 2.5) return false;
    return !isHeadlineNews(r);
  });
}

function loadCentroids() {
  const src = fs.readFileSync(path.join(root, "src/lib/county-xy.ts"), "utf8");
  const start = src.indexOf("export const COUNTY_XY");
  const brace = src.indexOf("{", start);
  const end = src.indexOf("};", brace);
  return Function(`return ${src.slice(brace, end + 1)}`)();
}

function loadCityCounty() {
  const src = fs.readFileSync(path.join(root, "src/lib/county-xy.ts"), "utf8");
  const start = src.indexOf("export const CITY_COUNTY");
  const brace = src.indexOf("{", start);
  const end = src.indexOf("};", brace);
  return Function(`return ${src.slice(brace, end + 1)}`)();
}

const COUNTY_XY = loadCentroids();
const CITY_COUNTY = loadCityCounty();
const COUNTY_NAMES = Object.keys(COUNTY_XY);

function ymd(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function rssDay(raw) {
  const d = new Date(raw);
  if (Number.isNaN(+d)) return daysAgo(0);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function gun(w) {
  return /GUN|FIREARM|RIFLE|SHOTGUN|REVOLVER|PISTOL/i.test(String(w ?? ""));
}

function countyFromText(text) {
  const blob = String(text).toLowerCase();
  let hit = null;
  for (const name of COUNTY_NAMES) {
    if (blob.includes(`${name.toLowerCase()} county`)) {
      if (!hit || name.length > hit.length) hit = name;
    }
  }
  if (hit) return hit;
  const cities = Object.keys(CITY_COUNTY).sort((a, b) => b.length - a.length);
  for (const city of cities) {
    if (!blob.includes(city)) continue;
    if (city === "jackson" && !/jackson(?:,?\s*tn|\s+police|\s+tn\b)|madison county/i.test(text)) continue;
    if (city === "franklin" && !/franklin(?:,?\s*tn|\s+police| williamson)/i.test(text)) continue;
    if (city === "springfield" && !/springfield(?:,?\s*tn|\s+police| robertson)/i.test(text)) continue;
    if (city === "fayetteville" && !/tennessee|\btn\b/.test(blob)) continue;
    if (city === "bristol" && !/tennessee|\btn\b|sullivan/.test(blob)) continue;
    return CITY_COUNTY[city];
  }
  return null;
}

async function arcgis(url, where, fields, order) {
  const q = new URL(url);
  q.searchParams.set("where", where);
  q.searchParams.set("outFields", fields);
  q.searchParams.set("orderByFields", order);
  q.searchParams.set("resultRecordCount", "400");
  q.searchParams.set("returnGeometry", "false");
  q.searchParams.set("f", "pjson");
  const res = await fetch(q, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`arcgis ${res.status}`);
  const d = await res.json();
  return d.features ?? [];
}

function fromNash(a) {
  const id = String(a.Incident_Number ?? "");
  const lat = Number(a.Latitude);
  const lon = Number(a.Longitude);
  if (!id || !lat || !lon) return null;
  const nibrs = String(a.Offense_NIBRS ?? "");
  const offense = String(a.Offense_Description ?? "");
  const weapon = String(a.Weapon_Description ?? "");
  const homicide = nibrs === "09A" || nibrs === "09C" || /homicide|murder/i.test(offense);
  if (!homicide && !(nibrs === "13A" && gun(weapon))) return null;
  const zip = String(a.ZIP_Code ?? "").replace(/\.0$/, "");
  return {
    id: `NASH-${id}`,
    date: ymd(Number(a.Incident_Occurred)),
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

function fromMem(a) {
  const raw = String(a.Crime_ID ?? "");
  const lat = Number(a.Latitude);
  const lon = Number(a.Longitude);
  if (!raw || !lat || !lon) return null;
  const code = String(a.UCR_Incident_Code ?? "");
  const cat = String(a.UCR_Category ?? "");
  const desc = String(a.UCR_Description ?? "");
  const homicide = code === "09A" || cat === "HOMICIDE";
  const assault = code === "13A" || /aggravated assault/i.test(desc);
  if (!homicide && !assault) return null;
  return {
    id: `MEM-${raw}`,
    date: ymd(Number(a.Offense_Datetime)),
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

function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .trim();
}

function newsCounty(title) {
  const re = /\bin ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g;
  let last = null;
  let m;
  while ((m = re.exec(title))) {
    const hit = CITY_COUNTY[m[1].toLowerCase()];
    if (hit) last = hit;
  }
  return last || countyFromText(title);
}

function staleNews(title) {
  if (/\b2025\b|\b2024\b/.test(title) && !/\b2026\b/.test(title)) return true;
  if (/grand jury|indicts|indicted|sentenced|convicted/i.test(title) && /\b2025\b|\b2024\b/.test(title)) return true;
  return false;
}

function newsKind(title) {
  const attempted = /attempted murder|attempted homicide/i.test(title);
  const fatal = !attempted && /homicide|murder|killed|fatal|\bdead\b|dies|died|death of/i.test(title);
  if (fatal) {
    return {
      type: "Homicide",
      killed: 1,
      offense: /shot|gun|shooting/i.test(title) ? "Gun homicide" : "Homicide",
    };
  }
  return {
    type: "Shooting",
    killed: 0,
    offense: /officer-involved|officer involved/i.test(title) ? "Officer-involved shooting" : "Shooting",
  };
}

function newsPlace(title, county) {
  const street = String(title).match(
    /\b\d{1,5}\s+[\w.'-]+(?:\s[\w.'-]+){0,3}\s(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|highway|hwy|pike|way|circle|cir|court|ct|parkway|pkwy)\b/i,
  );
  if (street) return `${street[0]}, ${county} County, TN`;
  const city = String(title).match(/\b(?:in|near|at)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?:\s|,|$)/);
  if (city) return `${city[1]}, ${county} County, TN`;
  return "";
}

async function geocodeTn(q) {
  const addr = /tn\b|tennessee/i.test(q) ? q : `${q}, Tennessee`;
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addr)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json();
      const m = json.result?.addressMatches?.[0];
      const lat = m?.coordinates?.y;
      const lon = m?.coordinates?.x;
      if (typeof lat === "number" && typeof lon === "number" && lat >= 34.8 && lat <= 36.8 && lon >= -90.5 && lon <= -81.4) {
        return { lat, lon, label: m?.matchedAddress };
      }
    }
  } catch {
    /* nominatim next */
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(addr)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const m = json[0];
    const lat = Number(m?.lat);
    const lon = Number(m?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 34.8 || lat > 36.8 || lon < -90.5 || lon > -81.4) return null;
    return { lat, lon, label: m?.display_name };
  } catch {
    return null;
  }
}

async function fromNews() {
  const q = `Tennessee (homicide OR murder OR "fatal shooting" OR "shot and killed" OR shooting OR "officer-involved") when:5d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`news ${res.status}`);
  const xml = await res.text();
  const out = [];
  const seen = new Set();
  let geoLeft = 8;
  for (const chunk of xml.split(/<item>/i).slice(1).slice(0, 40)) {
    const title = decode(chunk.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const pub = decode(chunk.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    if (!title || NEWS_SKIP.test(title) || staleNews(title)) continue;
    if (!/homicide|killed|fatal|murder|shooting|shot|officer-involved/i.test(title)) continue;
    if (!/tennessee|\btn\b|county|knoxville|memphis|nashville|chattanooga|clarksville|murfreesboro/i.test(title)) continue;
    const county = newsCounty(title);
    const xy = county ? COUNTY_XY[county] : null;
    if (!county || !xy) continue;
    const kind = newsKind(title);
    if ((county === "Shelby" || county === "Davidson") && kind.type !== "Homicide") continue;
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
}

async function main() {
  const since = daysAgo(14);
  const jobs = await Promise.allSettled([
    arcgis(
      NASH,
      `Incident_Occurred > DATE '${since}' AND (Offense_NIBRS IN ('09A','09C','13A'))`,
      "Incident_Number,Incident_Location,Latitude,Longitude,Offense_Description,Weapon_Description,Offense_NIBRS,ZIP_Code,Incident_Occurred",
      "Incident_Occurred DESC",
    ).then((rows) => rows.map((f) => fromNash(f.attributes)).filter(Boolean)),
    arcgis(
      MEM,
      `Offense_Datetime > DATE '${since}' AND (UCR_Incident_Code IN ('09A','13A') OR UCR_Category = 'HOMICIDE')`,
      "Crime_ID,Offense_Datetime,Street_Address,ZIP_Code,Latitude,Longitude,UCR_Category,UCR_Description,UCR_Incident_Code,Full_Address,City",
      "Offense_Datetime DESC",
    ).then((rows) => rows.map((f) => fromMem(f.attributes)).filter(Boolean)),
    fromNews(),
  ]);
  const fresh = [];
  for (const j of jobs) {
    if (j.status === "fulfilled") fresh.push(...j.value);
    else console.error("source failed", j.reason);
  }
  const existing = JSON.parse(fs.readFileSync(file, "utf8"));
  let recoded = 0;
  for (const r of existing) {
    if (r.source !== "News") continue;
    if (!isHeadlineNews(r)) continue;
    const kind = newsKind(`${r.offense ?? ""} ${r.address ?? ""}`);
    if (staleNews(r.address ?? "")) {
      r.date = "2025-12-31";
      recoded += 1;
      continue;
    }
    const headline = /killed|homicide|murder|fatal|shot and|dies|died/i.test(r.address ?? "");
    if (r.type === "Homicide" && kind.type === "Shooting" && headline) {
      r.type = "Shooting";
      r.killed = 0;
      r.offense = kind.offense;
      recoded += 1;
    }
  }
  const have = new Set(existing.map((r) => r.id));
  const homDay = new Set(
    existing.filter((r) => r.type === "Homicide").map((r) => `${r.county}|${r.date}`),
  );
  const newsDay = new Set(
    existing.filter((r) => r.source === "News").map((r) => `${r.county}|${r.date}|${r.type}`),
  );
  const added = [];
  for (const r of fresh) {
    if (have.has(r.id)) continue;
    if (r.source === "News" && r.type === "Homicide" && homDay.has(`${r.county}|${r.date}`)) continue;
    if (r.source === "News" && newsDay.has(`${r.county}|${r.date}|${r.type}`)) continue;
    if (r.source === "News" && isHeadlineNews(r) && nearbyBetterNews(existing, r)) continue;
    have.add(r.id);
    if (r.type === "Homicide") homDay.add(`${r.county}|${r.date}`);
    if (r.source === "News") newsDay.add(`${r.county}|${r.date}|${r.type}`);
    added.push(r);
    existing.push(r);
  }
  if (added.length || recoded) {
    existing.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    fs.writeFileSync(file, JSON.stringify(existing));
  }
  console.log(
    JSON.stringify({
      added: added.length,
      recoded,
      total: existing.length,
      hom: existing.filter((r) => r.type === "Homicide").length,
      ids: added.map((r) => r.id).slice(0, 30),
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
