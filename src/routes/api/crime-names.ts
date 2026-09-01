import { createFileRoute } from "@tanstack/react-router";
import seedJson from "@/data/crime-names.json";
import type { CrimeNames, CrimePerson } from "@/data/types";

const UA = "GridTN/1.0 (tennessee situation monitor; grid.blakehassler.com)";
const seed = new Map((seedJson as CrimeNames[]).map((n) => [n.id, n]));
const cache = new Map<string, { at: number; names: CrimeNames | null }>();

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "–");
}

function strip(html: string) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function person(name: string, extra?: Partial<CrimePerson>): CrimePerson {
  return { name: name.replace(/\s+/g, " ").trim(), ...extra };
}

function parseRss(xml: string) {
  const items: { title: string; href: string; source: string }[] = [];
  for (const chunk of xml.split(/<item>/i).slice(1).slice(0, 6)) {
    const title = decode((chunk.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
    const href = decode((chunk.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim());
    const source = decode((chunk.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "").trim());
    if (title && title !== "Google News") items.push({ title, href, source });
  }
  return items;
}

async function google(q: string) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(1400) });
  if (!res.ok) return [];
  return parseRss(await res.text());
}

async function tbiSearch(county: string, city: string) {
  const q = `${county} County ${city} homicide OR identified OR shooting`;
  const url = `https://tbinewsroom.com/?s=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(1400) });
  if (!res.ok) return [] as { title: string; href: string }[];
  const html = await res.text();
  const out: { title: string; href: string }[] = [];
  const re = /<h2 class="entry-title"><a href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!m[1].includes("/2026/")) continue;
    out.push({ href: m[1], title: decode(m[2]).trim() });
    if (out.length >= 3) break;
  }
  return out;
}

async function tbiArticle(href: string) {
  const res = await fetch(href, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(1600) });
  if (!res.ok) return "";
  const html = await res.text();
  const block = html.match(/<div class="entry-content"[\s\S]*?>([\s\S]{200,16000})<\/div>/i)?.[1] ?? html;
  return strip(block).slice(0, 4000);
}

function ageFromDob(dob: string, when: string) {
  const p = dob.split(/[/-]/).map(Number);
  if (p.length !== 3) return undefined;
  let [a, b, c] = p;
  // TBI uses M/D/YY or M/D/YYYY
  const month = a;
  const day = b;
  const year = c < 100 ? (c > 30 ? 1900 + c : 2000 + c) : c;
  const incident = when ? new Date(when) : new Date();
  if (Number.isNaN(incident.getTime()) || month < 1 || month > 12) return undefined;
  let age = incident.getUTCFullYear() - year;
  const md = (incident.getUTCMonth() + 1) * 32 + incident.getUTCDate();
  if (md < month * 32 + day) age -= 1;
  return age >= 0 && age < 120 ? age : undefined;
}

function fromTbiText(id: string, text: string, date: string, href: string): CrimeNames | null {
  const victims: CrimePerson[] = [];
  const charged: CrimePerson[] = [];
  const seen = new Set<string>();
  const dobRe = /([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})\s*\(DOB:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\)/g;
  let m: RegExpExecArray | null;
  while ((m = dobRe.exec(text))) {
    const name = m[1].replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const ctx = text.slice(Math.max(0, m.index - 160), m.index + name.length + 80).toLowerCase();
    const chargedHint = /responsible|arrested|charged|indicted|warrant|in custody|identified as the (?:individual|person) responsible/.test(ctx);
    const victimHint = /death of|shooting death|homicide of|killed|deceased|pronounced|victim|body of|fatal shooting of/.test(ctx);
    const p = person(name, { age: ageFromDob(m[2], date) });
    if (chargedHint && !victimHint) charged.push(p);
    else victims.push(p);
  }
  if (!victims.length && !charged.length) return null;
  return { id, victims, charged, source: "TBI Newsroom", href };
}

function fromHeadlines(id: string, titles: string[], href?: string, source?: string): CrimeNames | null {
  const blob = titles.join(" · ");
  const victims: CrimePerson[] = [];
  const charged: CrimePerson[] = [];
  const seen = new Set<string>();
  const named = /identified as ([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})(?:,\s*(\d{1,3}))?/g;
  let m: RegExpExecArray | null;
  while ((m = named.exec(blob))) {
    const k = m[1].toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    victims.push(person(m[1], m[2] ? { age: Number(m[2]) } : undefined));
  }
  const chargedRe = /(?:charged|arrested|accused|indicted)\s+(?:with .{0,40}?,\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})(?:,\s*(\d{1,3}))?/g;
  while ((m = chargedRe.exec(blob))) {
    const k = m[1].toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    charged.push(person(m[1], m[2] ? { age: Number(m[2]) } : undefined));
  }
  if (!victims.length && !charged.length) return null;
  return { id, victims, charged, source, href };
}

async function extractWithXai(
  id: string,
  meta: string,
  headlines: { title: string; source: string; href: string }[],
  article?: string,
): Promise<CrimeNames | null> {
  const key = process.env.XAI_API_KEY;
  if (!key) return fromHeadlines(id, headlines.map((h) => h.title), headlines[0]?.href, headlines[0]?.source);
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(2500),
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "Extract only names printed in the provided text. Never invent. JSON only: {victims:[{name,age,note}],charged:[{name,age,note}],note,source,href}. victims=people killed who are named. charged=people news says were arrested, indicted, or charged. Murder-suicide: all deceased in victims, explain in note, charged empty. If no names, {victims:[],charged:[]}.",
          },
          {
            role: "user",
            content: JSON.stringify({ incident: meta, headlines, article: article?.slice(0, 1800) ?? "" }),
          },
        ],
      }),
    });
    if (!res.ok) return fromHeadlines(id, headlines.map((h) => h.title), headlines[0]?.href, headlines[0]?.source);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as CrimeNames;
    parsed.id = id;
    parsed.victims = Array.isArray(parsed.victims) ? parsed.victims.filter((p) => p?.name) : [];
    parsed.charged = Array.isArray(parsed.charged) ? parsed.charged.filter((p) => p?.name) : [];
    parsed.href = parsed.href || headlines[0]?.href;
    parsed.source = parsed.source || headlines[0]?.source;
    if (!parsed.victims.length && !parsed.charged.length) return null;
    return parsed;
  } catch {
    return fromHeadlines(id, headlines.map((h) => h.title), headlines[0]?.href, headlines[0]?.source);
  }
}

export const Route = createFileRoute("/api/crime-names")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const id = u.searchParams.get("id") ?? "";
        if (!id) return Response.json({ names: null });
        const hit = cache.get(id);
        if (hit && Date.now() - hit.at < 24 * 60 * 60_000) return Response.json({ names: hit.names });
        const seeded = seed.get(id);
        if (seeded) {
          cache.set(id, { at: Date.now(), names: seeded });
          return Response.json({ names: seeded });
        }

        const date = u.searchParams.get("date") ?? "";
        const city = u.searchParams.get("city") ?? "";
        const county = u.searchParams.get("county") ?? "";
        const address = (u.searchParams.get("address") ?? "").split(",")[0].slice(0, 40);
        const type = u.searchParams.get("type") ?? "";
        const homicide = type === "Homicide";
        const q = `"${county} County" ${city} ${address} (${homicide ? "homicide OR killed OR identified" : "shooting OR arrested"}) ${date.slice(0, 7)} Tennessee`;

        try {
          const [headlines, tbiHits] = await Promise.all([
            google(q.replace(/\s+/g, " ")),
            homicide ? tbiSearch(county, city) : Promise.resolve([]),
          ]);
          let names: CrimeNames | null = null;
          let article = "";
          if (tbiHits[0]) {
            article = await tbiArticle(tbiHits[0].href);
            if (article) names = fromTbiText(id, article, date, tbiHits[0].href);
          }
          if (!names && headlines.length && homicide) {
            names = await extractWithXai(id, `${date} ${city} ${county} ${address}`, headlines, article);
          } else if (!names && headlines.length) {
            names = fromHeadlines(id, headlines.map((h) => h.title), headlines[0]?.href, headlines[0]?.source);
          }
          cache.set(id, { at: Date.now(), names });
          return Response.json({ names });
        } catch {
          cache.set(id, { at: Date.now(), names: null });
          return Response.json({ names: null });
        }
      },
    },
  },
});
