/** The app's own formulas, free of the page so they can be tested. */

export function positionOf(code = "") {
  const value = code.toUpperCase();
  if (value === "G" || value === "GK") return "GKP";
  if (value.includes("B") || value.startsWith("CD")) return "DEF";
  if (value.startsWith("F") || value.startsWith("CF") || value.startsWith("ST") || value.endsWith("W")) return "FWD";
  return "MID";
}

export const ACTION_LABELS = {
  goals: "Γκολ", assists: "Ασίστ", shotsOn: "Σουτ στην εστία", shotsOff: "Άστοχα σουτ", foulsWon: "Φάουλ υπέρ", foulsCommitted: "Φάουλ κατά",
  saves: "Αποκρούσεις", cleanSheet: "Ανέπαφη εστία", conceded: "Γκολ παθητικό", yellow: "Κίτρινη κάρτα", red: "Κόκκινη κάρτα", ownGoals: "Αυτογκόλ",
};

/** Kerkida's open formula: start at 6.0 and add or subtract for each action. */
export function rating(stats, position) {
  const defender = position === "GKP" || position === "DEF";
  const goalWeight = defender ? 1.4 : position === "MID" ? 1.2 : 1;
  const sheetWeight = defender ? 0.6 : position === "MID" ? 0.15 : 0;
  const lines = [
    ["goals", stats.goals, goalWeight], ["assists", stats.assists, 0.8], ["shotsOn", stats.shotsOn, 0.15], ["shotsOff", stats.shotsOff, 0.03],
    ["foulsWon", stats.foulsWon, 0.05], ["foulsCommitted", stats.foulsCommitted, -0.06], ["saves", stats.saves, 0.15],
    ["cleanSheet", stats.cleanSheet && stats.minutes >= 60 ? 1 : 0, sheetWeight], ["conceded", stats.conceded, defender ? -0.2 : 0],
    ["yellow", stats.yellow, -0.3], ["red", stats.red, -1.2], ["ownGoals", stats.ownGoals, -1],
  ].map(([action, value, weight]) => ({ action, value: value || 0, delta: (value || 0) * weight })).filter((l) => l.value && l.delta);
  const total = 6 + lines.reduce((sum, line) => sum + line.delta, 0);
  return {
    rating: Math.round(Math.min(10, Math.max(3, total)) * 10) / 10,
    lines: lines.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    smallSample: stats.minutes < 20,
  };
}

/** Rates everyone who played, from the match's own line-up statistics. */
export function lineupRatings(players, conceded, length) {
  return players.filter((p) => p.minutes > 0).map((player) => {
    const position = positionOf(player.position);
    const count = (key) => Math.trunc(player.stats?.[key] ?? 0);
    const on = count("shotsOnTarget");
    const share = Math.min(1, player.minutes / Math.max(1, length));
    const against = position === "GKP" ? (player.stats?.goalsConceded ?? conceded) : position === "DEF" ? Math.round(conceded * share) : 0;
    const stats = {
      minutes: player.minutes, goals: count("totalGoals"), assists: count("goalAssists"), saves: count("saves"), cleanSheet: conceded === 0, conceded: against,
      yellow: count("yellowCards"), red: count("redCards"), ownGoals: count("ownGoals"), shotsOn: on, shotsOff: Math.max(0, count("totalShots") - on),
      foulsWon: count("foulsSuffered"), foulsCommitted: count("foulsCommitted"),
    };
    return { player, position, ...rating(stats, position) };
  }).sort((a, b) => b.rating - a.rating);
}

export function resultFor(game, teamId) {
  if (game.homeScore === null || game.awayScore === null) return null;
  const isHome = game.home.id === teamId;
  if (!isHome && game.away.id !== teamId) return null;
  const own = isHome ? game.homeScore : game.awayScore;
  const other = isHome ? game.awayScore : game.homeScore;
  return own > other ? "W" : own < other ? "L" : "D";
}

const recent = (games, match) => games
  .filter((g) => g.id !== match.id && g.status === "FINISHED" && g.homeScore !== null && g.kickoff < match.kickoff)
  .sort((a, b) => b.kickoff - a.kickoff).slice(0, 5);

function streak(team, form) {
  const wins = form.findIndex((r) => r !== "W");
  const winCount = wins < 0 ? form.length : wins;
  if (winCount >= 3) return `${team}: ${winCount} συνεχόμενες νίκες`;
  const first = form.findIndex((r) => r === "W");
  const winless = first < 0 ? form.length : first;
  return winless >= 4 ? `${team}: ${winless} αγώνες χωρίς νίκη` : null;
}

function goalsLine(team, teamId, games) {
  if (games.length < 3) return null;
  let scored = 0;
  let conceded = 0;
  for (const g of games) {
    const home = g.home.id === teamId;
    scored += home ? g.homeScore : g.awayScore;
    conceded += home ? g.awayScore : g.homeScore;
  }
  if (scored / games.length >= 2) return `${team}: ${(scored / games.length).toFixed(1)} γκολ ανά αγώνα στους τελευταίους ${games.length}`;
  if (conceded / games.length >= 2) return `${team}: δέχεται ${(conceded / games.length).toFixed(1)} γκολ ανά αγώνα στους τελευταίους ${games.length}`;
  return null;
}

/** Form and up to three talking points before a match. */
export function buildPreview(match, homeGames, awayGames, rows = [], absences = { home: [], away: [] }) {
  const homeRecent = recent(homeGames, match);
  const awayRecent = recent(awayGames, match);
  const homeForm = homeRecent.map((g) => resultFor(g, match.home.id)).filter(Boolean);
  const awayForm = awayRecent.map((g) => resultFor(g, match.away.id)).filter(Boolean);
  const a = rows.find((r) => r.team.id === match.home.id);
  const b = rows.find((r) => r.team.id === match.away.id);
  let table = null;
  if (a && b && a.points !== null && b.points !== null) {
    const gap = Math.abs(a.points - b.points);
    if (gap <= 3) table = gap ? `Μόλις ${gap} βαθμοί τις χωρίζουν στη βαθμολογία` : "Είναι ισόβαθμες στη βαθμολογία";
    else if (gap >= 10) table = `${a.points > b.points ? match.home.name : match.away.name}: +${gap} βαθμοί στη βαθμολογία`;
  }
  const key = (team, list) => { const p = list.find((x) => x.starts >= 5); return p ? `${team}: εκτός ${p.name} (βασικός σε ${p.starts} αγώνες)` : null; };
  const insights = [streak(match.home.name, homeForm), streak(match.away.name, awayForm), table, key(match.home.name, absences.home), key(match.away.name, absences.away),
    goalsLine(match.home.name, match.home.id, homeRecent), goalsLine(match.away.name, match.away.id, awayRecent)].filter(Boolean).slice(0, 3);
  return { homeForm, awayForm, insights, lastHome: homeRecent[0] || null, lastAway: awayRecent[0] || null };
}

/** Judged only from the table: what is at stake and how even the teams are. */
export function worth(match, rows = []) {
  const home = rows.find((r) => r.team.id === match.home.id);
  const away = rows.find((r) => r.team.id === match.away.id);
  if (!home || !away || home.points === null || away.points === null) return null;
  const gap = Math.abs(home.points - away.points);
  const bottom = rows.length - 4;
  if (home.rank <= 4 && away.rank <= 4) return { level: "TOP", label: "Ντέρμπι κορυφής" };
  if (gap <= 3 && home.rank <= rows.length / 2 && away.rank <= rows.length / 2) return { level: "TOP", label: "Μάχη στην κορυφή" };
  if (rows.length >= 8 && home.rank > bottom && away.rank > bottom) return { level: "GOOD", label: "Μάχη παραμονής" };
  if (gap <= 3) return { level: "GOOD", label: "Ισορροπημένο" };
  return null;
}

/** Saturday and Sunday ahead. On a Sunday only today is left. */
export function weekendDays(today) {
  const day = today.getDay();
  const add = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  if (day === 0) return [today];
  if (day === 6) return [today, add(1)];
  return [add(6 - day), add(7 - day)];
}

export const leaveAt = (kickoff, km) => kickoff - ((km / 45) * 3_600_000 + 20 * 60_000);

/** The best entries that do not overlap become picks. Each other entry names what it clashes with. */
export function markPicks(entries) {
  const overlaps = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
  const picks = [];
  for (const entry of [...entries].sort((a, b) => b.score - a.score || a.startMs - b.startMs)) {
    if (!picks.some((p) => overlaps(p, entry))) picks.push(entry);
  }
  const chosen = new Set(picks.map((p) => p.key));
  return entries.map((entry) => (chosen.has(entry.key)
    ? { ...entry, isPick: true }
    : { ...entry, isPick: false, clashesWith: picks.find((p) => overlaps(p, entry))?.title })).sort((a, b) => a.startMs - b.startMs || b.score - a.score);
}

export function seasonOf(ms) {
  const date = new Date(ms);
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

export function seasonSummary(all, season) {
  const games = all.filter((g) => seasonOf(g.kickoff) === season);
  const goals = games.reduce((sum, g) => sum + (g.homeScore ?? 0) + (g.awayScore ?? 0), 0);
  const top = (values) => Object.entries(values.reduce((map, v) => ({ ...map, [v]: (map[v] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  const scored = games.filter((g) => g.homeScore !== null && g.homeScore !== undefined);
  return {
    matches: games.length, goals, perMatch: games.length ? goals / games.length : 0,
    biggest: scored.sort((a, b) => (b.homeScore + b.awayScore) - (a.homeScore + a.awayScore))[0] || null,
    topTeams: top(games.flatMap((g) => [g.home, g.away])), topLeagues: top(games.map((g) => g.league)),
    grounds: new Set(games.filter((g) => g.attended && g.venue).map((g) => g.venue)).size,
  };
}

/** Compares a live match with what was last seen. The first look only sets the baseline. */
export function detectAlerts(previous, match, events, rules = { red: true, late: true, comeback: true }) {
  const lead = (a, b) => (a === null || a === b ? null : a > b ? "home" : "away");
  const key = (e) => `${e.minute}|${e.kind}|${e.side}|${e.player}`;
  const leader = lead(match.homeScore, match.awayScore);
  const trailing = leader === "home" ? "away" : leader === "away" ? "home" : null;
  const memory = {
    seen: [...new Set([...(previous?.seen || []), ...events.map(key)])],
    trailed: [...new Set([...(previous?.trailed || []), ...(trailing ? [trailing] : [])])],
    comeback: previous?.comeback || null,
  };
  if (!previous) return { alerts: [], memory };
  const alerts = [];
  for (const event of events.filter((e) => !previous.seen.includes(key(e)))) {
    const minute = parseInt(event.minute, 10) || 0;
    if (rules.red && /red/i.test(event.kind)) alerts.push(`Κόκκινη κάρτα: ${event.player || ""} (${event.minute})`);
    if (rules.late && /goal|penalty---scored/i.test(event.kind) && minute >= 80) alerts.push(`Γκολ στο τέλος: ${event.player || ""} (${event.minute})`);
  }
  if (rules.comeback && leader && previous.trailed.includes(leader) && previous.comeback !== leader) {
    alerts.push(`Ανατροπή: προηγείται η ${leader === "home" ? match.home.name : match.away.name}`);
    memory.comeback = leader;
  }
  return { alerts, memory };
}

const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (text = "") => String(text).replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");

/** A calendar file any calendar app can import. */
export function icsFile(games, calendarName = "Kerkida") {
  const events = games.map((g) => [
    "BEGIN:VEVENT", `UID:${String(g.id).replace(/[^\w.-]/g, "-")}@kerkida`, `DTSTAMP:${icsDate(Date.now())}`, `DTSTART:${icsDate(g.kickoff)}`,
    `DTEND:${icsDate(g.kickoff + 115 * 60_000)}`, `SUMMARY:${icsText(`${g.home.name} – ${g.away.name}`)}`,
    ...(g.channel || g.venue ? [`LOCATION:${icsText(g.channel || g.venue)}`] : []), `DESCRIPTION:${icsText(g.league.name)}`, "END:VEVENT",
  ].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kerkida//EL", `X-WR-CALNAME:${icsText(calendarName)}`, ...events, "END:VCALENDAR", ""].join("\r\n");
}

/** Live FPL score for a chosen squad: eleven count, the captain counts double. */
export function fantasyPoints(squad, live) {
  let total = 0;
  const lines = squad.players.map((id, index) => {
    const points = live[id]?.points ?? 0;
    const starter = index < 11;
    const multiplier = !starter ? 0 : id === squad.captain ? 2 : 1;
    total += points * multiplier;
    return { id, points, minutes: live[id]?.minutes ?? 0, starter, captain: id === squad.captain };
  });
  return { total, lines };
}
