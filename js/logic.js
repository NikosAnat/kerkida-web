import { ALIASES, COMMON_WORDS } from "./names.js";

/** Lower case, no accents, with Latin look-alikes inside Greek words turned into Greek. */
export function plain(text = "") {
  const lower = text.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
  return lower
    .replace(/ς/g, "σ")
    .replace(/(?<=[α-ω])p|p(?=[α-ω])/g, "ρ")
    .replace(/^epτ/, "ερτ")
    .replace(/(?<=[α-ω])e|e(?=[α-ω])/g, "ε");
}

const GREEK_SOUNDS = [
  ["ου", "u"], ["μπ", "b"], ["ντ", "d"], ["γκ", "g"], ["γγ", "g"], ["τσ", "ts"], ["τζ", "dz"],
  ["αι", "e"], ["ει", "i"], ["οι", "i"], ["αυ", "av"], ["ευ", "ev"],
  ["α", "a"], ["β", "v"], ["γ", "g"], ["δ", "d"], ["ε", "e"], ["ζ", "z"], ["η", "i"], ["θ", "t"], ["ι", "i"],
  ["κ", "k"], ["λ", "l"], ["μ", "m"], ["ν", "n"], ["ξ", "ks"], ["ο", "o"], ["π", "p"], ["ρ", "r"], ["σ", "s"],
  ["τ", "t"], ["υ", "i"], ["φ", "f"], ["χ", "h"], ["ψ", "ps"], ["ω", "o"],
];
const LATIN_SOUNDS = [
  ["ch", "ts"], ["ph", "f"], ["th", "t"], ["ou", "u"], ["oo", "u"], ["ck", "k"], ["mp", "b"],
  ["nt", "d"], ["nd", "d"], ["x", "ks"], ["c", "k"], ["q", "k"], ["w", "v"], ["y", "i"], ["j", "i"], ["h", ""],
];

/** One pronunciation-like spelling, so Greek and Latin names can be compared. */
export function phonetic(text = "") {
  let s = plain(text);
  for (const [from, to] of GREEK_SOUNDS) s = s.replaceAll(from, to);
  for (const [from, to] of LATIN_SOUNDS) s = s.replaceAll(from, to);
  return s.replace(/[^a-z0-9 ]/g, " ").replace(/(.)\1+/g, "$1").replace(/\s+/g, " ").trim();
}

export function ratio(a, b) {
  if (!a || !b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

const aliasPattern = new RegExp(
  "(?<![α-ω])(" + Object.keys(ALIASES).sort((x, y) => y.length - x.length).join("|") + ")(?![α-ω])",
  "g",
);
const canonicalMemo = new Map();

function canonical(text) {
  if (!canonicalMemo.has(text)) {
    canonicalMemo.set(text, phonetic(plain(text).replace(aliasPattern, (found) => ALIASES[found])));
  }
  return canonicalMemo.get(text);
}

const tokens = (text) => canonical(text).split(" ").filter((t) => t.length >= 3 && !COMMON_WORDS.has(t));

export function teamSimilarity(first, second) {
  const a = canonical(first);
  const b = canonical(second);
  let best = ratio(a, b);
  for (const x of tokens(first)) {
    for (const y of tokens(second)) {
      if (x === y) return 1;
      if (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))) best = Math.max(best, 0.95);
      else if (Math.min(x.length, y.length) >= 4) best = Math.max(best, ratio(x, y));
    }
  }
  return best;
}

export function mentionsTeam(text, team) {
  const words = canonical(text).split(" ").filter((w) => w.length >= 3);
  const wanted = tokens(team);
  return wanted.some((name) => words.some((word) => word === name ||
    (Math.min(word.length, name.length) >= 5 && (ratio(word, name) >= 0.8 || word.includes(name) || name.includes(word)))));
}

export function matchesQuery(name, query) {
  const q = canonical(query);
  return q.length >= 2 && (canonical(name).includes(q) || teamSimilarity(name, query) >= 0.8);
}

export function splitTeams(title = "") {
  const parts = title.split(/\s*[-–—]\s+|\s+[-–—]\s*|(?<=[\p{L}.)])[-–—](?=\p{Lu})/u);
  if (parts.length !== 2 || parts.some((part) => !part.trim())) return null;
  return [parts[0].trim(), parts[1].trim()];
}

const MAGENTA_LEAGUE = /^\s*magenta\s*sport\s*([1-9])\s*(?:l|league)(?:\s+(?:hd|ηd))?\s*$/i;

/** "Magenta Sport 3 L" and "Magenta Sport 3 League" are one channel. */
export const channelName = (channel = "") => {
  const found = channel.match(MAGENTA_LEAGUE);
  return found ? `Magenta Sport ${found[1]} League` : channel;
};

export const channelKey = (channel) => plain(channelName(channel))
  .replace(/\b(hd|ηd|ηδ|4k)\b/g, "")
  .replace(/[^a-z0-9α-ω+]/g, "");

export function networkOf(channel) {
  const c = plain(channel).trim();
  if (c.startsWith("novasport")) return "nova";
  if (c.startsWith("magenta")) return "magenta";
  if (c.startsWith("eurosport")) return "eurosport";
  if (c.startsWith("dazn")) return "dazn";
  if (c.startsWith("αντ1+") || c.startsWith("ant1+")) return "ant1plus";
  if (c.startsWith("σπορ fm") || c.startsWith("sport fm")) return "sportfm";
  if (c.startsWith("ερτ") || c.startsWith("ert")) return "ert";
  if (c.startsWith("αντ1") || c.startsWith("ant1")) return "ant1";
  if (c.startsWith("mega")) return "mega";
  if (c.startsWith("alpha")) return "alpha";
  if (c.startsWith("σκαι") || c.startsWith("skai")) return "skai";
  if (c.startsWith("star")) return "star";
  if (c.startsWith("open")) return "open";
  return "other";
}

export const isPaid = (channel) => ["nova", "magenta", "eurosport", "dazn", "ant1plus", "other"].includes(networkOf(channel));

function leagueHint(competition) {
  const c = plain(competition);
  if (/youth|γυναικ|womens|δευτερη|league 2|league one|league two|bundesliga 2|u-1|u-2/.test(c)) return "__none";
  if (c.includes("championship")) return "eng.2";
  if (c.includes("premier league") || c.includes("αγγλικο") || c.includes("αγγλιασ")) return "eng.1";
  if (c.includes("super league") || c.includes("ελληνικο")) return c.includes("τουρκ") ? "tur.1" : "gre.1";
  if (/ιταλικο|serie a|σεριε α/.test(c)) return "ita.1";
  if (/ισπανικο|laliga|la liga/.test(c)) return "esp.1";
  if (/γερμανικο|bundesliga|μπουντεσλιγκα/.test(c)) return "ger.1";
  if (/γαλλικο|ligue 1/.test(c)) return "fra.1";
  if (/ολλανδικο|eredivisie/.test(c)) return "ned.1";
  if (/πορτογαλ|primeira/.test(c)) return "por.1";
  if (c.includes("τουρκικο")) return "tur.1";
  if (/champions league|τσαμπιονσ/.test(c)) return "uefa.champions";
  if (/europa league|γιουροπα/.test(c)) return "uefa.europa";
  if (c.includes("conference")) return "uefa.europa.conf";
  return null;
}

const SLOT_MS = 20 * 60_000;
const TENNIS_EARLY_MS = 45 * 60_000;
const SLAMS = [/roland garros|ρολαν γκαροσ/, /wimbledon|γουιμπλεντον/, /australian open|αυστραλιανο οπεν/, /us open|αμερικανικο οπεν/];
const TENNIS_GENERIC = new Set(["tenis", "open", "finals", "masters", "tour", "series", "next", "gen", "atp", "wta", "cup"]);

function tennisStage(text) {
  const t = plain(text);
  if (t.includes("quarter") || t.includes("προημιτελικ")) return "QUARTER";
  if (t.includes("semi") || t.includes("ημιτελικ")) return "SEMI";
  if (/\bfinal\b|(?<![α-ω])τελικ/.test(t)) return "FINAL";
  return null;
}

const isDoubles = (text) => /double|διπλ/.test(plain(text));

function sameTournament(listing, tournament) {
  const a = plain(listing);
  const b = plain(tournament);
  const slam = SLAMS.find((s) => s.test(a) || s.test(b));
  if (slam) return slam.test(a) && slam.test(b);
  const words = (text) => phonetic(text).split(" ").filter((w) => w.length >= 4 && !TENNIS_GENERIC.has(w) && !/^\d+$/.test(w));
  const theirs = words(b);
  return words(a).some((word) => theirs.some((other) => other === word || ratio(other, word) >= 0.85));
}

function sameSurname(first, second) {
  const last = (name) => canonical(name).split(" ").pop();
  const a = last(first);
  const b = last(second);
  return Math.min(a.length, b.length) >= 3 && (a === b || ratio(a, b) >= 0.72);
}

function tennisScore(item, match) {
  const kickoff = match.kickoff;
  if (!kickoff || kickoff < item.startMs - TENNIS_EARLY_MS || kickoff >= item.endMs) return null;
  const closeness = Math.min(Math.abs(kickoff - item.startMs) / 3_600_000, 1) * 0.5;
  const named = splitTeams(item.title);
  if (named) {
    const [first, second] = named;
    if ((sameSurname(first, match.home.name) && sameSurname(second, match.away.name)) ||
      (sameSurname(first, match.away.name) && sameSurname(second, match.home.name))) return 3 - closeness;
  }
  const text = `${item.title} ${item.competition}`;
  if (!sameTournament(text, match.league.name)) return null;
  const stage = tennisStage(text);
  if (stage) {
    const sameDraw = isDoubles(text) === isDoubles(match.draw || "");
    return sameDraw && tennisStage(match.stage || "") === stage ? 2 - closeness : null;
  }
  const oneCourt = plain(match.league.name).includes("finals");
  return oneCourt && /μερα|day/.test(plain(text)) ? 1 - closeness : null;
}

/** How well a TV listing fits a match, or null if it is not that match. */
export function matchScore(item, match) {
  if (item.sport !== match.sport) return null;
  if (match.sport === "TENNIS") return tennisScore(item, match);
  if (!match.kickoff || Math.abs(item.startMs - match.kickoff) > SLOT_MS) return null;
  const hint = match.sport === "FOOTBALL" ? leagueHint(item.competition) : null;
  if (hint && hint !== match.league.id) return null;
  const teams = splitTeams(item.title);
  if (!teams) return null;
  const homeScore = teamSimilarity(teams[0], match.home.name);
  const awayScore = teamSimilarity(teams[1], match.away.name);
  const high = Math.max(homeScore, awayScore);
  const low = Math.min(homeScore, awayScore);
  const fits = hint ? low >= 0.62 || (high >= 0.85 && low >= 0.45) : low >= 0.72;
  return fits ? homeScore + awayScore : null;
}

/** The channels showing a match, one per channel. */
export function channelsFor(match, listings) {
  const scored = listings.map((item) => [item, matchScore(item, match)]).filter(([, score]) => score !== null);
  if (!scored.length) return [];
  const best = Math.max(...scored.map(([, score]) => score));
  const seen = new Set();
  return scored.filter(([, score]) => score >= best - 0.35).map(([item]) => item.channel)
    .filter((channel) => !seen.has(channelKey(channel)) && seen.add(channelKey(channel)));
}

const MAX_AFTER_KICKOFF_MS = 72 * 3_600_000;

/** The official videos of one finished match, Greek broadcasters first. */
export function videosFor(match, videos) {
  const rank = { BROADCASTER: 0, LEAGUE: 1, CLUB: 2 };
  return videos.filter((video) => {
    if (!match.kickoff || video.publishedMs <= match.kickoff || video.publishedMs - match.kickoff > MAX_AFTER_KICKOFF_MS) return false;
    if (video.sport ? video.sport !== match.sport : false) return false;
    return mentionsTeam(video.title, match.home.name) && mentionsTeam(video.title, match.away.name);
  }).sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) || b.publishedMs - a.publishedMs);
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function radiusRing(lat, lng, km, steps = 72) {
  const distance = km / 6371;
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  return Array.from({ length: steps + 1 }, (_, step) => {
    const bearing = 2 * Math.PI * (step % steps) / steps;
    const pointLat = Math.asin(Math.sin(latRad) * Math.cos(distance) + Math.cos(latRad) * Math.sin(distance) * Math.cos(bearing));
    const pointLng = lngRad + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(latRad), Math.cos(distance) - Math.sin(latRad) * Math.sin(pointLat));
    return [pointLng * 180 / Math.PI, pointLat * 180 / Math.PI];
  });
}

export const venueKey = (name = "") => name.trim().toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9α-ω]+/g, " ").trim();

/** Games at one spot share a pin, soonest first. */
export function groupByGround(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.ground.lat.toFixed(4)},${result.ground.lng.toFixed(4)}`;
    if (!groups.has(key)) groups.set(key, { key, name: result.ground.name, lat: result.ground.lat, lng: result.ground.lng, km: result.km, games: [] });
    groups.get(key).games.push(result.match);
  }
  for (const group of groups.values()) group.games.sort((a, b) => a.kickoff - b.kickoff);
  return [...groups.values()];
}

/** Lays a starting eleven out in lines from its formation, goalkeeper first. */
export function pitchLines(players, formation) {
  const starters = players.filter((p) => p.starter);
  if (starters.length < 2) return [];
  const code = (p) => (p.position || "").toUpperCase();
  const depth = (p) => {
    const value = code(p);
    if (value === "G" || value === "GK") return 0;
    if (value.startsWith("CD") || value === "LB" || value === "RB" || value.endsWith("WB") || value === "D") return 1;
    if (value.startsWith("DM")) return 2;
    if (value.startsWith("AM")) return 4;
    if (value.startsWith("CF") || ["F", "LF", "RF", "ST", "LW", "RW"].includes(value)) return 5;
    return 3;
  };
  const lateral = (p) => {
    const value = code(p);
    if (value.startsWith("L")) return -2;
    if (value.startsWith("R")) return 2;
    if (value.endsWith("-L")) return -1;
    if (value.endsWith("-R")) return 1;
    return 0;
  };
  const keepers = starters.filter((p) => depth(p) === 0).slice(0, 1);
  const outfield = starters.filter((p) => !keepers.includes(p)).sort((a, b) => depth(a) - depth(b) || lateral(a) - lateral(b));
  const counts = (formation || "").split("-").map(Number);
  let lines;
  if (counts.every(Boolean) && counts.reduce((sum, n) => sum + n, 0) === outfield.length) {
    let from = 0;
    lines = counts.map((count) => outfield.slice(from, (from += count)));
  } else {
    const byDepth = new Map();
    for (const player of outfield) byDepth.set(depth(player), [...(byDepth.get(depth(player)) || []), player]);
    lines = [...byDepth.keys()].sort((a, b) => a - b).map((key) => byDepth.get(key));
  }
  const ordered = lines.map((line) => [...line].sort((a, b) => lateral(a) - lateral(b)));
  return keepers.length ? [keepers, ...ordered] : ordered;
}

/** These sources have no live feed, so a score only counts as final well after the start. */
export function greekStatus(game, now, finalAfterMinutes) {
  const hasScore = game.homeScore !== null && game.homeScore !== undefined && game.awayScore !== null && game.awayScore !== undefined;
  if (game.noTime) return hasScore ? "FINISHED" : now < game.kickoff ? "SCHEDULED" : "UNKNOWN";
  if (now < game.kickoff) return "SCHEDULED";
  return hasScore && now - game.kickoff >= finalAfterMinutes * 60_000 ? "FINISHED" : "UNKNOWN";
}
