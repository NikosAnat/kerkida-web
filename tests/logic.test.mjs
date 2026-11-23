import assert from "node:assert/strict";
import test from "node:test";
import {
  channelKey, channelName, channelsFor, distanceKm, groupByGround, matchScore, matchesQuery, pitchLines, radiusRing, teamSimilarity, videosFor,
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
