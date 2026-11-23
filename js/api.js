import { greekStatus, venueKey } from "./logic.js";
import { GBL_TOWNS, OPEN_TOWNS } from "./towns.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports";
const EURO = "https://api-live.euroleague.net/v2/competitions";

export const SPORTS = [
  { id: "FOOTBALL", label: "Ποδόσφαιρο", icon: "Matches", motion: "roll" },
  { id: "BASKETBALL", label: "Μπάσκετ", icon: "Basketball", motion: "bounce" },
  { id: "TENNIS", label: "Τένις", icon: "Tennis", motion: "swing" },
  { id: "MOTOR", label: "Μηχανοκίνητα", icon: "RaceFlag", motion: "wave" },
  { id: "VOLLEYBALL", label: "Βόλεϊ", icon: "Volleyball", motion: "roll" },
  { id: "AMERICAN_FOOTBALL", label: "NFL", icon: "AmericanFootball", motion: "flip" },
  { id: "HOCKEY", label: "NHL", icon: "Hockey", motion: "swing" },
  { id: "BASEBALL", label: "MLB", icon: "Baseball", motion: "roll" },
];

const soccer = (id, name, country) => ({ id, path: `soccer/${id}`, name, country, sport: "FOOTBALL", kind: "team" });

export const LEAGUES = [
  soccer("gre.1", "Super League Ελλάδας", "Ελλάδα"),
  soccer("uefa.champions", "UEFA Champions League", "Ευρώπη"),
  soccer("uefa.europa", "UEFA Europa League", "Ευρώπη"),
  soccer("uefa.europa.conf", "UEFA Conference League", "Ευρώπη"),
  soccer("eng.1", "Premier League", "Αγγλία"),
  soccer("esp.1", "LaLiga", "Ισπανία"),
  soccer("ita.1", "Serie A", "Ιταλία"),
  soccer("ger.1", "Bundesliga", "Γερμανία"),
  soccer("fra.1", "Ligue 1", "Γαλλία"),
  soccer("ned.1", "Eredivisie", "Ολλανδία"),
  soccer("por.1", "Primeira Liga", "Πορτογαλία"),
  soccer("tur.1", "Süper Lig", "Τουρκία"),
  soccer("eng.2", "Championship", "Αγγλία"),
  { id: "gbl", name: "Stoiximan GBL", country: "Ελλάδα", sport: "BASKETBALL", kind: "greek", finalAfter: 150, towns: GBL_TOWNS },
  { id: "elite", name: "Elite League", country: "Ελλάδα", sport: "BASKETBALL", kind: "greek", finalAfter: 90, towns: OPEN_TOWNS },
  { id: "volley-men", name: "Volley League Ανδρών", country: "Ελλάδα", sport: "VOLLEYBALL", kind: "greek", finalAfter: 90, towns: OPEN_TOWNS },
  { id: "volley-women", name: "Volley League Γυναικών", country: "Ελλάδα", sport: "VOLLEYBALL", kind: "greek", finalAfter: 90, towns: OPEN_TOWNS },
  { id: "euroleague", code: "E", name: "EuroLeague", country: "Ευρώπη", sport: "BASKETBALL", kind: "euro" },
  { id: "eurocup", code: "U", name: "EuroCup", country: "Ευρώπη", sport: "BASKETBALL", kind: "euro" },
  { id: "nba", path: "basketball/nba", name: "NBA", country: "ΗΠΑ", sport: "BASKETBALL", kind: "team" },
  { id: "wnba", path: "basketball/wnba", name: "WNBA", country: "ΗΠΑ", sport: "BASKETBALL", kind: "team" },
  { id: "atp", path: "tennis/atp", name: "ATP", sport: "TENNIS", kind: "tennis" },
  { id: "wta", path: "tennis/wta", name: "WTA", sport: "TENNIS", kind: "tennis" },
  { id: "f1", path: "racing/f1", name: "Formula 1", sport: "MOTOR", kind: "racing" },
  { id: "nfl", path: "football/nfl", name: "NFL", country: "ΗΠΑ", sport: "AMERICAN_FOOTBALL", kind: "team" },
  { id: "nhl", path: "hockey/nhl", name: "NHL", country: "ΗΠΑ / Καναδάς", sport: "HOCKEY", kind: "team" },
  { id: "mlb", path: "baseball/mlb", name: "MLB", country: "ΗΠΑ", sport: "BASEBALL", kind: "team" },
];

export const leagueById = (id) => LEAGUES.find((league) => league.id === id);
export const hasTable = (league) => league?.kind === "team" || league?.kind === "greek";

const memory = new Map();

/** Answers stay for a short while, so moving between screens does not repeat requests. */
async function getJson(url, ttlMs = 30_000) {
  const saved = memory.get(url);
  if (saved && Date.now() - saved.at < ttlMs) return saved.promise;
  const promise = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  memory.set(url, { at: Date.now(), promise });
  try {
    return await promise;
  } catch (error) {
    memory.delete(url);
    throw error;
  }
}

const dayCode = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
export const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
export const sameDay = (ms, date) => {
  const day = new Date(ms);
  return day.getFullYear() === date.getFullYear() && day.getMonth() === date.getMonth() && day.getDate() === date.getDate();
};

function statusOf(type = {}) {
  const name = type.name || "";
  if (/POSTPONED/.test(name)) return "POSTPONED";
  if (/CANCELED|CANCELLED|ABANDONED|FORFEIT/.test(name)) return "CANCELLED";
  if (type.state === "in") return "LIVE";
  if (type.state === "post" || type.completed) return "FINISHED";
  return "SCHEDULED";
}

const scoreOf = (value) => {
  const raw = value && typeof value === "object" ? value.displayValue ?? value.value : value;
  const number = Number(raw);
  return raw === undefined || raw === null || raw === "" || Number.isNaN(number) ? null : number;
};

const logoOf = (team) => team?.logo || team?.logos?.[0]?.href || null;

const person = (side) => side.athlete?.displayName || side.roster?.shortDisplayName || side.roster?.displayName || side.team?.displayName;

function teamMatch(event, league) {
  const competition = event.competitions?.[0];
  if (!competition) return null;
  const home = competition.competitors?.find((c) => c.homeAway === "home");
  const away = competition.competitors?.find((c) => c.homeAway === "away");
  if (!home?.team || !away?.team) return null;
  const status = statusOf(competition.status?.type || event.status?.type);
  const played = status === "LIVE" || status === "FINISHED";
  return {
    id: `${league.id}~${event.id}`,
    eventId: event.id,
    sport: league.sport,
    league: { id: league.id, name: league.name, path: league.path },
    home: { id: home.team.id, name: home.team.displayName || home.team.name, logo: logoOf(home.team) },
    away: { id: away.team.id, name: away.team.displayName || away.team.name, logo: logoOf(away.team) },
    kickoff: Date.parse(competition.date || event.date),
    status,
    detail: competition.status?.type?.shortDetail || "",
    clock: competition.status?.displayClock,
    homeScore: played ? scoreOf(home.score) : null,
    awayScore: played ? scoreOf(away.score) : null,
    venue: competition.venue?.fullName || event.venue?.displayName || null,
    linkable: true,
  };
}

function setsWon(first, second) {
  let a = 0;
  let b = 0;
  (first.linescores || []).forEach((set, index) => {
    const other = second.linescores?.[index];
    if (!other) return;
    if (set.value > other.value) a++;
    else if (other.value > set.value) b++;
  });
  return [a, b];
}

function tennisMatches(event, league) {
  const tournament = event.shortName || event.name;
  const ref = { id: league.id, name: `${league.name} · ${tournament}` };
  return (event.groupings || []).flatMap((group) => (group.competitions || []).map((competition) => {
    const sides = [...(competition.competitors || [])].sort((a, b) => (a.order ?? 9) - (b.order ?? 9));
    if (sides.length !== 2 || !person(sides[0]) || !person(sides[1])) return null;
    const status = statusOf(competition.status?.type);
    const [one, two] = status === "LIVE" || status === "FINISHED" ? setsWon(sides[0], sides[1]) : [null, null];
    const sets = (sides[0].linescores || []).map((set, index) => `${set.value}-${sides[1].linescores?.[index]?.value ?? ""}`).join("  ");
    return {
      id: `${league.id}~${competition.id}`,
      sport: "TENNIS",
      league: ref,
      home: { name: person(sides[0]) },
      away: { name: person(sides[1]) },
      kickoff: Date.parse(competition.date),
      status,
      detail: group.grouping?.displayName || "",
      draw: group.grouping?.displayName || "",
      stage: competition.round?.displayName || "",
      homeScore: one,
      awayScore: two,
      result: status === "SCHEDULED" ? "" : sets,
      venue: competition.venue?.fullName || null,
    };
  })).filter(Boolean);
}

function racingMatches(event, league) {
  return (event.competitions || []).map((competition) => {
    const part = competition.type?.abbreviation;
    if (!part) return null;
    const status = statusOf(competition.status?.type);
    const leader = [...(competition.competitors || [])].sort((a, b) => (a.order ?? 999) - (b.order ?? 999))[0];
    return {
      id: `${league.id}~${competition.id}`,
      sport: "MOTOR",
      league: { id: league.id, name: league.name },
      title: `${event.shortName || event.name} · ${part}`,
      home: { name: event.shortName || event.name },
      away: { name: part },
      kickoff: Date.parse(competition.date),
      status,
      detail: competition.status?.type?.shortDetail || "",
      result: status === "FINISHED" && leader ? person(leader) : "",
      homeScore: null,
      awayScore: null,
      venue: event.circuit?.fullName || null,
    };
  }).filter(Boolean);
}

function seasonCode(code, date) {
  return `${code}${date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1}`;
}

async function euroGames(league, date) {
  const root = await getJson(`${EURO}/${league.code}/seasons/${seasonCode(league.code, date)}/games`, 120_000);
  const now = Date.now();
  return (root.data || []).map((game) => {
    const kickoff = Date.parse(game.utcDate);
    const home = game.local?.club;
    const away = game.road?.club;
    if (!home || !away || Number.isNaN(kickoff)) return null;
    const running = !game.played && now >= kickoff && now - kickoff < 3 * 3_600_000;
    const status = game.played ? "FINISHED" : running ? "LIVE" : "SCHEDULED";
    return {
      id: `${league.id}~${game.identifier}`,
      sport: "BASKETBALL",
      league: { id: league.id, name: league.name },
      home: { id: home.code, name: home.editorialName || home.name, logo: home.images?.crest || null },
      away: { id: away.code, name: away.editorialName || away.name, logo: away.images?.crest || null },
      kickoff,
      status,
      detail: game.roundAlias || "",
      homeScore: status === "SCHEDULED" ? null : game.local?.score ?? null,
      awayScore: status === "SCHEDULED" ? null : game.road?.score ?? null,
      venue: game.venue?.name || null,
    };
  }).filter(Boolean);
}

let greekFile;
const greekData = () => (greekFile ??= fetch("data/greek.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => d || { updated: 0, leagues: [] }));

async function greekLeague(id) {
  const data = await greekData();
  return data.leagues.find((league) => league.id === id) || { games: [], table: [] };
}

function greekMatch(game, league) {
  const status = greekStatus(game, Date.now(), league.finalAfter);
  const show = status !== "SCHEDULED";
  return {
    id: `${league.id}~${game.id}`,
    eventId: game.id,
    sport: league.sport,
    league: { id: league.id, name: league.name },
    home: game.home,
    away: game.away,
    kickoff: game.kickoff,
    noTime: !!game.noTime,
    status,
    detail: `Αγωνιστική ${game.round}`,
    homeScore: show ? game.homeScore ?? null : null,
    awayScore: show ? game.awayScore ?? null : null,
    venue: game.venue || null,
    channel: game.channel || null,
    linkable: true,
    basic: true,
  };
}

async function leagueDay(league, date) {
  if (league.kind === "greek") {
    const data = await greekLeague(league.id);
    return data.games.filter((game) => sameDay(game.kickoff, date)).map((game) => greekMatch(game, league));
  }
  if (league.kind === "euro") return (await euroGames(league, date)).filter((game) => sameDay(game.kickoff, date));
  // A local evening can fall on the source's previous or next day.
  const days = league.sport === "FOOTBALL" ? [-1, 0] : [-1, 0, 1];
  const ttl = sameDay(Date.now(), date) ? 25_000 : 600_000;
  const boards = await Promise.all(days.map((offset) => getJson(`${SITE}/${league.path}/scoreboard?dates=${dayCode(addDays(date, offset))}`, ttl)));
  const found = new Map();
  for (const board of boards) {
    for (const event of board.events || []) {
      const games = league.kind === "tennis" ? tennisMatches(event, league)
        : league.kind === "racing" ? racingMatches(event, league)
          : [teamMatch(event, league)];
      for (const game of games) if (game && sameDay(game.kickoff, date)) found.set(game.id, game);
    }
  }
  return [...found.values()];
}

/** Loads leagues side by side and reports each one as it arrives. */
export async function loadDay(leagues, date, onProgress) {
  const games = new Map();
  let done = 0;
  let failed = 0;
  const queue = [...leagues];
  const worker = async () => {
    while (queue.length) {
      const league = queue.shift();
      try {
        for (const game of await leagueDay(league, date)) games.set(game.id, game);
      } catch {
        failed++;
      }
      done++;
      onProgress?.([...games.values()].sort((a, b) => a.kickoff - b.kickoff), done, leagues.length, failed);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, leagues.length) }, worker));
  return [...games.values()].sort((a, b) => a.kickoff - b.kickoff);
}

export async function matchDetails(leagueId, eventId) {
  const league = leagueById(leagueId);
  if (league.kind === "greek") {
    const game = (await greekLeague(leagueId)).games.find((item) => item.id === eventId);
    if (!game) throw new Error("No match");
    return { match: greekMatch(game, league), events: [], home: null, away: null, basic: true };
  }
  const root = await getJson(`${SITE}/${league.path}/summary?event=${encodeURIComponent(eventId)}`, 25_000);
  const header = root.header;
  const competition = header?.competitions?.[0];
  const match = competition ? teamMatch({ id: eventId, competitions: [competition], date: competition.date }, league) : null;
  if (!match) throw new Error("No match");
  match.venue = match.venue || root.gameInfo?.venue?.fullName || null;
  const events = (root.keyEvents || []).filter((e) => e.type?.type && !/kickoff|halftime|end|start/i.test(e.type.type)).map((event) => ({
    minute: event.clock?.displayValue || "",
    kind: event.type.type,
    text: event.type.text,
    player: event.participants?.[0]?.athlete?.displayName || "",
    assist: event.participants?.[1]?.athlete?.displayName || "",
    side: event.team?.id === match.home.id ? "home" : event.team?.id === match.away.id ? "away" : "",
  }));
  const lineup = (id) => {
    const roster = (root.rosters || []).find((r) => r.team?.id === id);
    if (!roster?.roster?.length) return null;
    return {
      formation: roster.formation,
      players: roster.roster.map((entry) => ({
        name: entry.athlete?.displayName || "",
        jersey: entry.jersey || "",
        starter: !!entry.starter,
        place: entry.formationPlace ? Number(entry.formationPlace) : null,
        position: entry.position?.abbreviation || "",
      })),
    };
  };
  return { match, events, home: lineup(match.home.id), away: lineup(match.away.id) };
}

export async function standings(leagueId) {
  const league = leagueById(leagueId);
  if (league?.kind === "greek") {
    const rows = (await greekLeague(leagueId)).table || [];
    return rows.length ? [{ name: league.name, rows }] : [];
  }
  if (!league?.path || league.kind !== "team") return [];
  const root = await getJson(`${STANDINGS}/${league.path}/standings`, 300_000);
  const groups = root.children?.length ? root.children : [root];
  return groups.map((group) => ({
    name: group.name || league.name,
    rows: (group.standings?.entries || []).map((entry, index) => {
      const stats = Object.fromEntries((entry.stats || []).map((stat) => [stat.name, stat.value]));
      return {
        rank: stats.rank || index + 1,
        team: { id: entry.team?.id, name: entry.team?.displayName, logo: logoOf(entry.team) },
        played: stats.gamesPlayed ?? ((stats.wins ?? 0) + (stats.losses ?? 0) + (stats.ties ?? 0)),
        won: stats.wins ?? 0,
        drawn: stats.ties ?? 0,
        lost: stats.losses ?? 0,
        diff: stats.pointDifferential ?? stats.differential ?? 0,
        points: stats.points ?? null,
      };
    }).sort((a, b) => a.rank - b.rank),
  })).filter((group) => group.rows.length);
}

export async function teamSchedule(leagueId, teamId) {
  const league = leagueById(leagueId);
  if (league.kind === "greek") {
    const data = await greekLeague(leagueId);
    const games = data.games.filter((game) => game.home.id === teamId || game.away.id === teamId).map((game) => greekMatch(game, league)).sort((a, b) => a.kickoff - b.kickoff);
    const team = games[0] && (games[0].home.id === teamId ? games[0].home : games[0].away);
    if (!team) throw new Error("No team");
    return { name: team.name, logo: team.logo || null, games };
  }
  const root = await getJson(`${SITE}/${league.path}/teams/${encodeURIComponent(teamId)}/schedule`, 300_000);
  return {
    name: root.team?.displayName || "",
    logo: logoOf(root.team),
    games: (root.events || []).map((event) => teamMatch(event, league)).filter(Boolean).sort((a, b) => a.kickoff - b.kickoff),
  };
}

const staticFile = (name) => fetch(`data/${name}`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
let tvData;
let videoData;
let groundData;
export const tvGuide = () => (tvData ??= staticFile("tv.json").then((d) => d || { updated: 0, items: [] }));
export const highlights = () => (videoData ??= staticFile("highlights.json").then((d) => d || { updated: 0, videos: [] }));
const grounds = () => (groundData ??= staticFile("stadiums.json").then((d) => d || { venues: {}, teams: {} }));

/** The named venue wins. The home club's ground is only assumed when no venue is given. */
export async function groundFinder() {
  const data = await grounds();
  return (match) => {
    const key = match.venue ? venueKey(match.venue) : data.teams[match.home.id];
    const found = data.venues[key];
    if (found) return { name: found.n, city: found.c, lat: found.a, lng: found.o };
    const towns = leagueById(match.league.id)?.towns;
    const town = towns?.find(([name]) => match.home.name.toLowerCase().includes(name.toLowerCase()));
    return town ? { name: match.venue || `${town[1]} (κατά προσέγγιση)`, city: town[1], lat: town[2], lng: town[3] } : null;
  };
}
