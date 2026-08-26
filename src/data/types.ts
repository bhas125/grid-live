export type Division = "East" | "Middle" | "West";

export type CountyProfile =
  | "metro_d"
  | "collar"
  | "midsize_r"
  | "tri"
  | "rural_w"
  | "rural_e"
  | string;

export type Aug6 = {
  kind: string;
  offices: string[];
  note: string;
} | null;

export type County = {
  name: string;
  fips: string;
  seat: string;
  division: Division;
  market: string;
  pop: number;
  pop2020: number;
  growth: number;
  trump: number;
  harris: number;
  trumpPct: number;
  harrisPct: number;
  other: number;
  totalVotes: number;
  margin: number;
  medianIncome: number;
  temp: number;
  tempLabel: string;
  profile: CountyProfile;
  issues: string[];
  aug6: Aug6;
  brief: {
    lede: string;
    talking: string[];
    soWhat: string;
  };
};

export type GeoFeature = {
  type: "Feature";
  properties: { name: string; fips: string; area: number };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
};

export type Precinct = {
  id: string;
  name: string;
  fips: string;
  d: number;
  r: number;
  t: number;
  g: GeoFeature["geometry"];
};

export type RaceCandidate = { n: string; p: string; v: number };
export type Race = { o: string; d: string; c: RaceCandidate[] };

export type NewsItem = {
  id: string;
  kind: "news" | "official";
  headline: string;
  href: string;
  source: string;
  published: string;
  county?: string;
  ongoing?: boolean;
};

export type Alert = {
  id: string;
  event: string;
  severity: string;
  headline: string;
  area: string;
  ends?: string;
  href: string;
  counties: string[];
};

export type MarketQuote = {
  id: string;
  label: string;
  digits: number;
  suffix?: string;
  value: number;
  change: number;
};

export type FinanceHeadline = {
  id: string;
  source: string;
  headline: string;
  href: string;
};

export type WxNow = {
  temp: number;
  code: number;
  label: string;
  live: boolean;
};

export type WxKind = "clear" | "few" | "partly" | "cloudy" | "fog" | "rain" | "storm";

export type WxCell = {
  name: string;
  kind: WxKind;
  label: string;
};

export type LayerId =
  | "interstates"
  | "weather"
  | "sites"
  | "flock"
  | "cameras"
  | "p24"
  | "p26"
  | "race"
  | "crime"
  | "flights"
  | "house";

export type Layers = Record<LayerId, boolean>;

export type CrimeKind = "hom" | "sht" | "h48" | "reg";
export type CrimeLayers = Record<CrimeKind, boolean>;

export const CRIME_META: { id: CrimeKind; label: string; chip: string }[] = [
  { id: "hom", label: "Hom", chip: "border-hot bg-hot/15 text-hot" },
  { id: "sht", label: "Sht", chip: "border-watch bg-watch/15 text-watch" },
  { id: "h48", label: "48 Hours", chip: "border-fresh bg-fresh/15 text-fresh" },
  { id: "reg", label: "Registry", chip: "border-steel bg-steel/15 text-steel" },
];

export type CrimeAgency = "mem" | "nash" | "cha" | "rest";
export type CrimeAgencies = Record<CrimeAgency, boolean>;
export const AGENCY_META: { id: CrimeAgency; label: string }[] = [
  { id: "mem", label: "Mem" },
  { id: "nash", label: "Nash" },
  { id: "cha", label: "Chat" },
  { id: "rest", label: "Rest" },
];

export type CrimeWindow = "today" | "7d" | "30d" | "ytd";
export const WINDOW_META: { id: CrimeWindow; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "ytd", label: "YTD" },
];

export type GeoPrecision = "address" | "intersection" | "block" | "place" | "zip" | "city" | "county";

export type TabId = "news" | "sit" | "vote" | "gov" | "crime";

export type ElectYear = "2024" | "2026";

export type RaceSlice = "w" | "b" | "h" | "a" | "o";
export type RaceLayers = Record<RaceSlice, boolean>;

export const RACE_META: { id: RaceSlice; label: string; css: string; chip: string }[] = [
  { id: "w", label: "White", css: "var(--color-race-white)", chip: "border-fg/50 bg-fg/10 text-fg" },
  { id: "b", label: "Black", css: "var(--color-race-black)", chip: "border-muted bg-fg/5 text-muted" },
  { id: "h", label: "Hispanic", css: "var(--color-race-black)", chip: "border-muted bg-fg/5 text-muted" },
  { id: "a", label: "Asian", css: "var(--color-grid)", chip: "border-grid bg-grid/15 text-grid" },
  { id: "o", label: "Other", css: "var(--color-muted)", chip: "border-muted bg-muted/15 text-muted" },
];

export type ZipRace = {
  z: string;
  t: number;
  w: number;
  b: number;
  h: number;
  a: number;
  o: number;
  g: GeoFeature["geometry"];
};

export type HouseDistrict = {
  d: number;
  n: string;
  p: string;
  x: number;
  y: number;
  g: number[][][];
};


export type AboutSection = {
  id: string;
  title: string;
  body?: string;
  items?: string[];
};

export type CountyAbout = {
  county: string;
  href: string;
  lede: string;
  sections: AboutSection[];
};


export type Official = { office: string; name: string };

export type AlprPoint = {
  id: number;
  lat: number;
  lon: number;
  op: string;
  dir: string;
};

export type TrafficCam = {
  id: number;
  title: string;
  route: string;
  mile: string;
  city: string;
  lat: number;
  lon: number;
  stream?: string;
  snap?: string;
};

export type Site = {
  name: string;
  county: string;
  lon: number;
  lat: number;
  kind: string;
};

export type Road = {
  id: string;
  kind: "interstate" | "arterial";
  pts: [number, number][];
};

export type CrimePerson = {
  name: string;
  age?: number;
  note?: string;
};

export type CrimeNames = {
  id: string;
  victims: CrimePerson[];
  charged: CrimePerson[];
  note?: string;
  source?: string;
  href?: string;
};

export type CrimeIncident = {
  id: string;
  date: string | null;
  city: string;
  county: string;
  address: string;
  zip?: string;
  lat: number;
  lon: number;
  type: string;
  offense: string;
  source: string;
  killed: number;
  injured: number;
  geo?: GeoPrecision;
};

export type Flight = {
  id: string;
  call: string;
  reg: string;
  ac: string;
  op: string;
  lat: number;
  lon: number;
  alt: number | null;
  gs: number;
  hdg: number;
  ground: boolean;
  at: number;
};

export type SorPoint = {
  id: string;
  lat: number;
  lon: number;
  co: string;
  k: "V" | "S" | "C";
};

export type SorPerson = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  county: string;
  city: string;
  address: string;
  zip: string;
  klass: string;
  offense: string;
};
