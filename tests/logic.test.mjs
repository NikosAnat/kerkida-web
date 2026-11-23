import assert from "node:assert/strict";
import test from "node:test";
import { buildPreview, detectAlerts, fantasyPoints, icsFile, leaveAt, lineupRatings, markPicks, rating, seasonSummary, weekendDays, worth } from "../js/features.js";
import {
  channelKey, channelName, channelsFor, distanceKm, greekStatus, groupByGround, matchScore, matchesQuery, pitchLines, radiusRing, teamSimilarity, videosFor,
} from "../js/logic.js";

const at = (iso) => Date.parse(iso);
const listing = (title, competition, iso, sport = "TENNIS", channel = "Magenta Sport 6", minutes = 150) => ({
  title, competition, sport, channel, startMs: at(iso), endMs: at(iso) + minutes * 60_000,
});
const game = (home, away, iso, extra = {}) => ({
  id: `${home}-${away}`, sport: "FOOTBALL", league: { id: "eng.1", name: "Premier League" }, home: { name: home }, away: { name: away }, kickoff: at(iso), status: "FINISHED", ...extra,
});
const finals = { id: "atp", name: "ATP · Nitto ATP Finals" };
const singles = game("Carlos Alcaraz", "Alexander Zverev", "2026-11-22T17:15:00Z", { sport: "TENNIS", league: finals, draw: "Men's Singles", stage: "Final" });
const doubles = game("T Arribage / A Olivetti", "M Arevalo / M Pavic", "2026-11-22T14:10:00Z", { sport: "TENNIS", league: finals, draw: "Men's Doubles", stage: "Final" });

test("Greek and Latin club names match", () => {
  assert.ok(teamSimilarity("Ολυμπιακός", "Olympiacos") >= 0.72);
  assert.ok(teamSimilarity("Γιουβέντους", "Juventus") >= 0.72);
  assert.ok(matchesQuery("Olympiacos", "ολυμπιακος"));
  assert.ok(!matchesQuery("Liverpool", "ολυμπιακος"));
});

test("Magenta League spellings are one channel", () => {
  assert.equal(channelName("Magenta Sport 3 L"), "Magenta Sport 3 League");
  assert.equal(channelKey("Magenta Sport 3 L"), channelKey("Magenta Sport 3 League"));
  assert.notEqual(channelKey("Magenta Sport 3"), channelKey("Magenta Sport 3 League"));
});

test("a football listing finds its match", () => {
  const match = game("Liverpool", "Manchester United", "2026-11-22T16:30:00Z");
  const item = listing("Λίβερπουλ - Μάντσεστερ Γιουνάιτεντ", "Premier League", "2026-11-22T16:30:00Z", "FOOTBALL", "Novasports Prime");
  assert.deepEqual(channelsFor(match, [item]), ["Novasports Prime"]);
  assert.equal(matchScore({ ...item, competition: "Serie A" }, match), null);
});

test("tennis matches round, draw and tournament", () => {
  const single = listing("Τελικός Μονού", "Nitto ATP Finals", "2026-11-22T17:00:00Z");
  const double = listing("Τελικός Διπλού", "Nitto ATP Finals", "2026-11-22T14:00:00Z");
  assert.ok(matchScore(single, singles) > 0);
  assert.ok(matchScore(double, doubles) > 0);
  assert.equal(matchScore(single, doubles), null);
  assert.equal(matchScore(double, singles), null);
  assert.equal(matchScore(listing("Τσεχία - Καναδάς", "Τένις", "2026-11-22T17:00:00Z"), singles), null);
});

test("a shared first name is not the same tennis player", () => {
  const named = listing("Αλεξάντερ Ζβέρεφ - Κάρλος Αλκαράθ", "Τένις", "2026-11-22T17:00:00Z");
  assert.ok(matchScore(named, singles) > 0);
  assert.equal(matchScore(named, { ...singles, away: { name: "Alexander Bublik" } }), null);
});

test("videos stay with their sport and Greek broadcasters come first", () => {
  const football = game("Olympiacos", "Panathinaikos", "2026-11-21T17:30:00Z");
  const after = (hours) => at("2026-11-21T17:30:00Z") + hours * 3_600_000;
  const videos = [
    { id: "b", title: "Olympiacos - Panathinaikos | Highlights", kind: "LEAGUE", sport: "BASKETBALL", publishedMs: after(2) },
    { id: "l", title: "Olympiacos - Panathinaikos 2-1", kind: "LEAGUE", sport: "FOOTBALL", publishedMs: after(4) },
    { id: "n", title: "Ολυμπιακός - Παναθηναϊκός: 2-1", kind: "BROADCASTER", sport: null, publishedMs: after(3) },
    { id: "old", title: "Olympiacos - Panathinaikos 1-1", kind: "LEAGUE", sport: "FOOTBALL", publishedMs: after(100) },
  ];
  assert.deepEqual(videosFor(football, videos).map((v) => v.id), ["n", "l"]);
});

test("games at one ground share a pin, soonest first", () => {
  const ground = { name: "OAKA", lat: 38.0361, lng: 23.7874 };
  const pins = groupByGround([
    { match: { id: "later", kickoff: 20 }, ground, km: 3 },
    { match: { id: "sooner", kickoff: 10 }, ground: { ...ground, lat: 38.03612 }, km: 3 },
  ]);
  assert.equal(pins.length, 1);
  assert.deepEqual(pins[0].games.map((g) => g.id), ["sooner", "later"]);
});

test("the radius ring is closed and at the right distance", () => {
  const ring = radiusRing(38.2466, 21.7346, 50);
  assert.deepEqual(ring[0], ring.at(-1));
  for (const [lng, lat] of ring) assert.ok(Math.abs(distanceKm(38.2466, 21.7346, lat, lng) - 50) < 0.01);
});

test("a formation lays out the eleven", () => {
  const codes = ["F", "AM-L", "AM", "AM-R", "CM-L", "CM-R", "LB", "CD-L", "CD-R", "RB", "G"];
  const players = codes.map((position, i) => ({ name: position, position, starter: true, place: i + 1 }));
  const lines = pitchLines(players, "4-2-3-1");
  assert.deepEqual(lines.map((line) => line.length), [1, 4, 2, 3, 1]);
  assert.equal(lines[0][0].position, "G");
  assert.deepEqual(lines[1].map((p) => p.position), ["LB", "CD-L", "CD-R", "RB"]);
  assert.equal(lines[4][0].position, "F");
});

test("a Greek result counts as final only well after the start", () => {
  const kickoff = at("2026-11-22T17:00:00Z");
  const scored = { kickoff, homeScore: 80, awayScore: 70 };
  assert.equal(greekStatus(scored, kickoff - 1000, 150), "SCHEDULED");
  assert.equal(greekStatus(scored, kickoff + 60 * 60_000, 150), "UNKNOWN");
  assert.equal(greekStatus(scored, kickoff + 151 * 60_000, 150), "FINISHED");
  assert.equal(greekStatus({ kickoff, homeScore: null, awayScore: null }, kickoff + 300 * 60_000, 150), "UNKNOWN");
  assert.equal(greekStatus({ ...scored, noTime: true }, kickoff - 1000, 90), "FINISHED");
});

test("the rating matches the app's formula", () => {
  const r = rating({ minutes: 90, goals: 1, assists: 1, yellow: 1, shotsOn: 2 }, "FWD");
  assert.equal(r.rating, 7.8);
  assert.equal(r.lines[0].action, "goals");
  assert.equal(rating({ minutes: 90, red: 5 }, "MID").rating, 3);
  assert.equal(rating({ minutes: 10 }, "MID").smallSample, true);
});

test("only players who played are rated", () => {
  const players = [
    { id: "1", name: "A", position: "F", minutes: 90, stats: { totalGoals: 2, totalShots: 3, shotsOnTarget: 2 } },
    { id: "2", name: "B", position: "CD", minutes: 0, stats: {} },
  ];
  const rated = lineupRatings(players, 1, 90);
  assert.equal(rated.length, 1);
  assert.equal(rated[0].rating, 8.3);
});

test("a preview finds form, streaks and the table", () => {
  const team = (id) => ({ id, name: id });
  const past = (day, h, a) => ({ id: `g${day}`, status: "FINISHED", kickoff: day, home: team("H"), away: team("X"), homeScore: h, awayScore: a });
  const match = { id: "m", kickoff: 100, home: team("H"), away: team("A") };
  const rows = [{ team: team("H"), points: 20 }, { team: team("A"), points: 18 }];
  const p = buildPreview(match, [past(1, 3, 0), past(2, 2, 0), past(3, 2, 1)], [], rows);
  assert.deepEqual(p.homeForm, ["W", "W", "W"]);
  assert.ok(p.insights.some((line) => line.includes("3 συνεχόμενες")));
  assert.ok(p.insights.some((line) => line.includes("2 βαθμοί")));
});

test("a top-four clash is worth watching", () => {
  const row = (id, rank, points) => ({ team: { id }, rank, points });
  const rows = [row("a", 1, 30), row("b", 2, 28), row("c", 9, 10), row("d", 10, 2)];
  assert.equal(worth({ home: { id: "a" }, away: { id: "b" } }, rows).level, "TOP");
  assert.equal(worth({ home: { id: "a" }, away: { id: "d" } }, rows), null);
});

test("the weekend plan picks what does not overlap", () => {
  assert.equal(weekendDays(new Date(2026, 10, 23)).map((d) => d.getDate()).join(), "28,29");
  assert.equal(weekendDays(new Date(2026, 10, 29)).length, 1);
  const plan = markPicks([{ key: "a", title: "A", startMs: 0, endMs: 100, score: 100 }, { key: "b", title: "B", startMs: 50, endMs: 150, score: 20 }, { key: "c", title: "C", startMs: 200, endMs: 300, score: 20 }]);
  assert.deepEqual(plan.map((e) => e.isPick), [true, false, true]);
  assert.equal(plan[1].clashesWith, "A");
  assert.equal(leaveAt(10_000_000, 45), 10_000_000 - 3_600_000 - 1_200_000);
});

test("the season counts games, goals and grounds", () => {
  const at2 = Date.UTC(2026, 10, 1);
  const s = seasonSummary([{ home: "A", away: "B", league: "L", kickoff: at2, homeScore: 2, awayScore: 1, attended: true, venue: "G" }, { home: "A", away: "C", league: "L", kickoff: at2, homeScore: 0, awayScore: 0 }], 2026);
  assert.equal(s.matches, 2);
  assert.equal(s.goals, 3);
  assert.equal(s.grounds, 1);
  assert.equal(s.topTeams[0][0], "A");
});

test("alerts stay quiet on first sight and catch a comeback and a red card", () => {
  const match = (h, a) => ({ home: { name: "H" }, away: { name: "A" }, homeScore: h, awayScore: a });
  const first = detectAlerts(null, match(0, 1), []);
  assert.equal(first.alerts.length, 0);
  const next = detectAlerts(first.memory, match(2, 1), [{ minute: "70'", kind: "red-card", side: "away", player: "X" }]);
  assert.equal(next.alerts.length, 2);
  assert.equal(detectAlerts(next.memory, match(2, 1), [{ minute: "70'", kind: "red-card", side: "away", player: "X" }]).alerts.length, 0);
});

test("a calendar file is valid and escaped", () => {
  const text = icsFile([{ id: "a~1", kickoff: Date.UTC(2026, 10, 28, 18), home: { name: "A, B" }, away: { name: "C" }, league: { name: "L" } }]);
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(text.includes("DTSTART:20261128T180000Z"));
  assert.ok(text.includes("SUMMARY:A\\, B – C"));
});

test("fantasy counts eleven and doubles the captain", () => {
  const players = Array.from({ length: 12 }, (_, i) => i + 1);
  const live = Object.fromEntries(players.map((id) => [id, { points: 2 }]));
  assert.equal(fantasyPoints({ players, captain: 1 }, live).total, 24);
});
