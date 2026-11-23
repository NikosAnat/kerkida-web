import * as api from "./api.js";
import { ICONS } from "./icons.js";
import { playIntro } from "./intro.js";
import { EN } from "./i18n-en.js";
import { clubProfile } from "./club.js";
import {
  ACTION_LABELS, buildPreview, detectAlerts, fantasyPoints, icsFile, leaveAt, lineupRatings, markPicks, positionOf, resultFor, seasonOf, seasonSummary, weekendDays, worth,
} from "./features.js";
import {
  channelsFor, mentionsTeam, teamSimilarity, distanceKm, groupByGround, isPaid, matchesQuery, networkOf, pitchLines, radiusRing, videosFor,
} from "./logic.js";

const view = document.getElementById("view");
const LOCALE = () => (document.documentElement.lang === "en" ? "en-GB" : "el-GR");
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name, size = 22) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${(ICONS[name] || []).map((d) => `<path d="${d}"/>`).join("")}</svg>`;
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can refuse storage. */ } };
const time = (ms) => new Date(ms).toLocaleTimeString(LOCALE(), { hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (ms) => new Date(ms).toLocaleDateString(LOCALE(), { weekday: "short", day: "numeric", month: "numeric" });
const longDay = (ms) => new Date(ms).toLocaleDateString(LOCALE(), { weekday: "long", day: "numeric", month: "long" });
const initial = (name = "") => (name.match(/[\p{L}\p{N}]/u)?.[0] || "").toUpperCase();
/** The club's crest from the score source, with its initial underneath if the image is unavailable. */
const crest = (team, extra = "") => `<i class="badge ${extra}"><span>${esc(initial(team.name))}</span>${team.logo ? `<img src="${esc(team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.parentNode.classList.add('loaded')" onerror="this.remove()">` : ""}</i>`;

const state = {
  date: today(),
  sport: "FOOTBALL",
  filter: "all",
  hidden: new Set(load("kerkida-hidden", [])),
  favTeams: load("kerkida-fav-teams", []),
  favLeagues: load("kerkida-fav-leagues", []),
  mine: new Set(load("kerkida-channels", [])),
  place: load("kerkida-place", null),
  radius: load("kerkida-radius", 50),
  nearbyMode: "list",
  tvTab: "guide",
  tvDay: null,
  tvQuery: "",
  tvFilter: "all",
  tvSource: null,
  watched: load("kerkida-season", []),
  revealed: new Set(load("kerkida-revealed", [])),
  tvStars: new Set(load("kerkida-tv-stars", [])),
  flags: { autoHide: false, ratings: true, preview: true, highlights: true, photos: true, nova: true, club: true, alerts: false, speak: false, ...load("kerkida-flags", {}) },
  squad: load("kerkida-squad", { players: [], captain: null }),
};
const known = new Map();
let renderToken = 0;
let activeMap = null;
let listings = [];

api.tvGuide().then((data) => { listings = data.items || []; });

const isFavTeam = (id) => state.favTeams.some((team) => team.id === id);
const isMine = (match) => isFavTeam(match.home.id) || isFavTeam(match.away.id);
const isHidden = (match) => state.hidden.has(match.id) || (state.flags.autoHide && isMine(match) && match.status !== "SCHEDULED" && !state.revealed.has(match.id));

function toggleHidden(id) {
  const match = known.get(id);
  if (match && state.flags.autoHide && isMine(match)) {
    if (isHidden(match)) { state.hidden.delete(id); state.revealed.add(id); } else { state.revealed.delete(id); }
    save("kerkida-revealed", [...state.revealed].slice(-300));
  } else if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
  save("kerkida-hidden", [...state.hidden].slice(-300));
}

function scarfBar(progress) {
  if (progress === null) return `<div class="scarfbar" role="progressbar" aria-label="Φόρτωση"><span class="scarf green travel"></span><span class="scarf white travel second"></span></div>`;
  return `<div class="scarfbar" role="progressbar" aria-valuenow="${Math.round(progress * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Φόρτωση"><span class="scarf green fill" style="width:calc((100% - 24px) * ${progress})"></span></div>`;
}

const message = (title, body = "", iconName = "Info") => `<div class="message">${icon(iconName, 36)}<h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;

function scoreCell(match) {
  const hidden = isHidden(match);
  if (match.status === "SCHEDULED") return `<b class="score">${match.noTime ? "–" : time(match.kickoff)}</b><small>Έναρξη</small>`;
  if (match.status === "UNKNOWN") return `<b class="score">–</b><small>Χωρίς live σκορ</small>`;
  if (match.status === "POSTPONED") return `<b class="score">–</b><small>Αναβολή</small>`;
  if (match.status === "CANCELLED") return `<b class="score">–</b><small>Ακύρωση</small>`;
  if (hidden) return `<b class="score">? – ?</b><small>Κρυφό</small>`;
  const live = match.status === "LIVE";
  const main = match.homeScore === null ? (live ? "Live" : "Τέλος") : `${match.homeScore} – ${match.awayScore}`;
  return `<b class="score ${live ? "live" : ""}">${esc(main)}</b><small class="${live ? "livetext" : ""}">${live ? esc(match.clock || "Ζωντανά") : "Τελικό"}</small>`;
}

/** Listings first. The Greek basketball league also names the channel on its own page. */
function matchChannels(match) {
  const found = channelsFor(match, listings);
  return found.length || !match.channel ? found : [match.channel];
}

function channelLine(match) {
  const channels = matchChannels(match);
  if (!channels.length) return "";
  const best = [...channels].sort((a, b) => Number(state.mine.has(networkOf(b))) - Number(state.mine.has(networkOf(a))))[0];
  const tag = state.mine.has(networkOf(best)) ? "το έχεις" : isPaid(best) ? "Συνδρομητικό" : "Ελεύθερο";
  return `<div class="channel">${icon("Tv", 15)} ${esc(best)} · ${tag}</div>`;
}

function matchRow(match) {
  known.set(match.id, match);
  const hidden = isHidden(match);
  const winner = !hidden && match.status === "FINISHED" && match.homeScore !== null && match.homeScore !== match.awayScore
    ? (match.homeScore > match.awayScore ? "home" : "away") : "";
  const canHide = match.status !== "SCHEDULED" && match.homeScore !== null;
  const inner = match.title
    ? `<div class="race"><b>${esc(match.title)}</b><small>${time(match.kickoff)}${!hidden && match.result ? ` · ${esc(match.result)}` : ""}</small></div>`
    : `<div class="side home ${winner === "home" ? "won" : ""}"><span>${esc(match.home.name)}</span>${crest(match.home)}</div>
       <div class="mid">${scoreCell(match)}${!hidden && match.result ? `<small class="sets">${esc(match.result)}</small>` : ""}</div>
       <div class="side away ${winner === "away" ? "won" : ""}">${crest(match.away)}<span>${esc(match.away.name)}</span></div>`;
  const body = `<div class="teams">${inner}</div>${channelLine(match)}`;
  return `<article class="row">
    ${match.linkable ? `<a class="rowlink" href="#/match/${encodeURIComponent(match.league.id)}/${encodeURIComponent(match.eventId)}">${body}</a>` : `<div class="rowlink">${body}</div>`}
    ${canHide ? `<button class="iconbtn" data-hide="${esc(match.id)}" aria-pressed="${hidden}" aria-label="${hidden ? "Εμφάνιση αγώνα" : "Απόκρυψη αγώνα"}">${icon(hidden ? "EyeOff" : "Eye", 20)}</button>` : ""}
  </article>`;
}

function leagueGroups(matches) {
  const groups = new Map();
  for (const match of matches) {
    if (!groups.has(match.league.name)) groups.set(match.league.name, { league: match.league, games: [] });
    groups.get(match.league.name).games.push(match);
  }
  const rank = (group) => (state.favLeagues.includes(group.league.id) ? 0 : 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

function groupedList(matches) {
  return leagueGroups(matches).map(({ league, games }) => {
    const known = api.leagueById(league.id);
    const canOpen = api.hasTable(known);
    const fav = state.favLeagues.includes(league.id);
    return `<section class="card"><header class="cardhead">
      <i class="badge square">${esc(initial(league.name))}</i>
      ${canOpen ? `<a href="#/league/${encodeURIComponent(league.id)}"><b>${esc(league.name)}</b><small>${esc(known.country || "")}</small></a>` : `<div><b>${esc(league.name)}</b><small>${esc(known?.country || "")}</small></div>`}
      <button class="iconbtn ${fav ? "on" : ""}" data-fav-league="${esc(league.id)}" aria-pressed="${fav}" aria-label="Αγαπημένη λίγκα">${icon("Star", 20)}</button>
    </header>${games.map(matchRow).join("")}</section>`;
  }).join("");
}

function dateStrip() {
  const base = today();
  return `<nav class="strip dates" aria-label="Ημερομηνία">${Array.from({ length: 15 }, (_, i) => api.addDays(base, i - 7)).map((date) => {
    const diff = Math.round((date - base) / 86_400_000);
    const label = diff === 0 ? "Σήμερα" : diff === -1 ? "Χθες" : diff === 1 ? "Αύριο" : date.toLocaleDateString(LOCALE(), { weekday: "short" });
    const on = date.getTime() === state.date.getTime();
    return `<button class="day ${on ? "on" : ""}" data-date="${date.getTime()}" ${on ? 'aria-current="date"' : ""}><span>${esc(label)}</span><b>${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}</b></button>`;
  }).join("")}</nav>`;
}

const sportStrip = (animate) => `<nav class="strip sports" aria-label="Άθλημα">${api.SPORTS.filter((sport) => sport.id === state.sport || api.leaguesFor(sport.id).length).map((sport) => `<button class="sport ${sport.id === state.sport ? "on" : ""} ${animate === sport.id ? `play-${sport.motion}` : ""}" data-sport="${sport.id}">${icon(sport.icon, 22)}<span>${esc(sport.label)}</span></button>`).join("")}</nav>`;

const FILTERS = [["all", "Όλα"], ["live", "Ζωντανά"], ["fav", "Αγαπημένα"], ["tv", "Αγώνες στην TV"]];
const filterRow = () => `<div class="strip chips">${FILTERS.map(([id, label]) => `<button class="chip ${state.filter === id ? "on" : ""}" data-filter="${id}">${id === "tv" ? icon("Tv", 16) : ""}${label}</button>`).join("")}</div>`;

function applyFilter(matches) {
  if (state.filter === "live") return matches.filter((m) => m.status === "LIVE");
  if (state.filter === "fav") return matches.filter((m) => state.favLeagues.includes(m.league.id) || isFavTeam(m.home.id) || isFavTeam(m.away.id));
  if (state.filter === "tv") return matches.filter((m) => matchChannels(m).length);
  return matches;
}

let currentDay = [];

function paintDay(done, total) {
  const box = document.getElementById("daylist");
  const bar = document.getElementById("daybar");
  if (!box) return;
  const loading = done < total;
  bar.innerHTML = loading ? scarfBar(total ? done / total : 0) + `<p class="progress">Φόρτωση πηγών ${done} από ${total}</p>` : "";
  const visible = applyFilter(currentDay);
  if (visible.length) box.innerHTML = groupedList(visible);
  else if (loading) box.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  else box.innerHTML = message("Δεν υπάρχουν αγώνες", "Δοκίμασε άλλη ημέρα, άθλημα ή φίλτρο.", "Calendar");
}

async function viewMatches(animate) {
  const token = ++renderToken;
  view.innerHTML = `${dateStrip()}${sportStrip(animate)}${filterRow()}<div id="daybar"></div><div id="daylist"></div>`;
  view.querySelector(".day.on")?.scrollIntoView({ inline: "center", block: "nearest" });
  currentDay = [];
  const leagues = api.leaguesFor(state.sport);
  paintDay(0, leagues.length);
  await Promise.all([api.tvGuide().then((d) => { listings = d.items || []; }), api.loadDay(leagues, state.date, (games, done, total) => {
    if (token !== renderToken) return;
    currentDay = games;
    paintDay(done, total);
  })]);
  if (token === renderToken) paintDay(leagues.length, leagues.length);
}

const tabs = (items, active) => `<nav class="tabs">${items.map(([id, label]) => `<button class="${id === active ? "on" : ""}" data-tab="${id}">${esc(label)}</button>`).join("")}</nav>`;
const pageHead = (title) => `<header class="pagehead"><button class="iconbtn" data-back aria-label="Πίσω">${icon("Back")}</button><h1>${esc(title)}</h1></header>`;

function eventsHtml(data) {
  if (!data.events.length) return message("Δεν υπάρχουν φάσεις", "Θα εμφανιστούν όταν τις δώσει η πηγή.", "Clock");
  return `<ol class="timeline">${data.events.map((event) => {
    const mark = /goal/i.test(event.kind) ? "goal" : /red/i.test(event.kind) ? "red" : /yellow/i.test(event.kind) ? "yellow" : /sub/i.test(event.kind) ? "sub" : "";
    const label = mark === "goal" ? "Γκολ" : mark === "red" ? "Κόκκινη κάρτα" : mark === "yellow" ? "Κίτρινη κάρτα" : mark === "sub" ? "Αλλαγή" : event.text;
    const content = `<b>${esc(event.player || label)}</b><small>${esc(label)}${mark === "sub" && event.assist ? ` · ${esc(event.assist)}` : ""}</small>`;
    return `<li class="${event.side}"><div class="ev left">${event.side === "home" ? content : ""}</div><span class="minute ${mark}">${esc(event.minute)}</span><div class="ev right">${event.side !== "home" ? content : ""}</div></li>`;
  }).join("")}</ol>`;
}

const novaNumber = (name) => {
  const k = name.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").replace("ερτ", "ert").replace("σπορ", "spor").replace("σκαι", "skai").replace("ηd", "hd").replace(/[^\p{L}\p{N}]/gu, "").replace(/hd$/, "");
  const fixed = { novasports1: 23, novasports2: 24, novasports3: 25, novasports4: 26, novasports5: 28, novasports6: 90, novasportsstart: 89, novasportsprime: 91, novasportsnews: 6, novasportspl: 177, novasportspremierleague: 177, novasportsextra1: 165, novasportsextra2: 166, novasportsextra3: 167, eurosport1: 29, eurosport2: 31, ert1: 2, ert2: 3, ert2spor: 3, ert3: 4, ertnews: 184, skai: 30, alpha: 34, star: 33, open: 37, openbeyond: 37 };
  if (fixed[k]) return fixed[k];
  const magenta = k.match(/^magentasport([1-9])(l|league)?$/);
  if (magenta) return 210 + Number(magenta[1]);
  const league = k.match(/^(novasports[1-6])league$/);
  return league ? fixed[league[1]] : null;
};

function novaButton(channels) {
  if (!state.flags.nova) return "";
  const channel = channels.find((name) => novaNumber(name));
  return channel ? `<a class="novabtn" href="https://novatv.gr/tv/channel/${novaNumber(channel)}" target="_blank" rel="noopener">▶ Δες το στο Nova TV</a>` : "";
}

const rateClass = (value) => (value >= 7 ? "r7" : value >= 6 ? "r6" : value >= 5 ? "r5" : "r4");
let photoIndex = {};
let fplCodes = new Map();

function photoOf(player, leagueId) {
  if (!state.flags.photos) return null;
  if (leagueId === "eng.1") {
    const key = player.name.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
    if (fplCodes.has(key)) return fplCodes.get(key);
  }
  if (player.photo) return player.photo;
  const file = photoIndex[player.id];
  return file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replaceAll(" ", "_"))}?width=160` : null;
}

function pitchHtml(name, lineup, flip, rated, leagueId) {
  const lines = pitchLines(lineup.players, lineup.formation);
  const ordered = flip ? [...lines].reverse() : lines;
  const rateOf = (p) => rated.find((r) => r.player.id === p.id);
  return `<div class="pitchteam"><div class="pitchname"><b>${esc(name)}</b><span>${esc(lineup.formation || "")}</span></div><div class="pitch">${ordered.map((line) => `<div class="pline">${line.map((p) => {
    const r = rateOf(p);
    const photo = photoOf(p, leagueId);
    return `<button class="pdot" ${r ? `data-rate="${esc(p.id)}"` : ""}><i>${esc(p.jersey)}${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}${r ? `<em class="${rateClass(r.rating)}">${r.rating.toFixed(1)}</em>` : ""}</i><span>${esc(p.name.trim().split(" ").pop())}</span></button>`;
  }).join("")}</div>`).join("")}</div></div>`;
}

function lineupsHtml(data) {
  if (!data.home && !data.away) return message("Δεν υπάρχουν ενδεκάδες", "Ανακοινώνονται λίγο πριν τον αγώνα.", "Info");
  const match = data.match;
  const showRatings = state.flags.ratings && match.status !== "SCHEDULED";
  const homeRated = showRatings && data.home ? lineupRatings(data.home.players, match.awayScore ?? 0, match.length || 90) : [];
  const awayRated = showRatings && data.away ? lineupRatings(data.away.players, match.homeScore ?? 0, match.length || 90) : [];
  data.rated = [...homeRated, ...awayRated];
  const list = (title, rated) => (rated.length ? `<section class="card"><h3>${esc(title)}</h3><ul class="ratelist">${rated.map((r) => `<li><button data-rate="${esc(r.player.id)}"><b class="ratebadge ${rateClass(r.rating)}">${r.rating.toFixed(1)}</b><span>${esc(r.player.name)}<small>${r.player.minutes}'</small></span></button></li>`).join("")}</ul></section>` : "");
  const bench = (lineup) => (lineup ? lineup.players.filter((p) => !p.starter).map((p) => `<li><i>${esc(p.jersey)}</i>${esc(p.name)}</li>`).join("") : "");
  return `<div class="pitches">${data.home ? pitchHtml(match.home.name, data.home, false, homeRated, match.league.id) : ""}${data.away ? pitchHtml(match.away.name, data.away, true, awayRated, match.league.id) : ""}</div>
  <div id="ratedetail"></div>
  ${showRatings ? `<p class="fresh">Βαθμολογία Kerkida από τα στατιστικά του αγώνα. Πάτα έναν παίκτη για να δεις γιατί.</p><div class="benches">${list(match.home.name, homeRated)}${list(match.away.name, awayRated)}</div>` : ""}
  <div class="benches"><section class="card"><h3>Πάγκος · ${esc(match.home.name)}</h3><ul>${bench(data.home)}</ul></section><section class="card"><h3>Πάγκος · ${esc(match.away.name)}</h3><ul>${bench(data.away)}</ul></section></div>
  ${state.flags.photos ? '<p class="fresh">Φωτογραφίες: ESPN, Premier League, <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener">Wikimedia Commons</a> (με τις άδειές τους).</p>' : ""}`;
}

function rateDetail(data, id) {
  const r = data.rated?.find((item) => String(item.player.id) === String(id));
  const box = document.getElementById("ratedetail");
  if (!r || !box) return;
  box.innerHTML = `<section class="card ratecard"><header><b class="ratebadge ${rateClass(r.rating)}">${r.rating.toFixed(1)}</b><span><b>${esc(r.player.name)}</b><small>${r.player.minutes} λεπτά</small></span><button class="iconbtn" data-close-rate aria-label="Κλείσιμο">${icon("Close", 20)}</button></header><ul><li><span>Βάση</span><b>6.0</b></li>${r.lines.map((l) => `<li><span>${esc(ACTION_LABELS[l.action])}${l.value !== 1 ? ` × ${l.value}` : ""}</span><b class="${l.delta > 0 ? "up" : "down"}">${l.delta > 0 ? "+" : ""}${l.delta.toFixed(2)}</b></li>`).join("")}</ul>${r.smallSample ? '<p class="fresh">Κάτω από 20 λεπτά, η βαθμολογία λέει λίγα.</p>' : ""}</section>`;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function tableHtml(groups, highlight = []) {
  if (!groups.length) return message("Δεν υπάρχει βαθμολογία", "Η πηγή δεν δίνει βαθμολογία για αυτή τη διοργάνωση.", "Leagues");
  return groups.map((group) => {
    const hasPoints = group.rows.some((row) => row.points !== null);
    const leagueId = group.leagueId;
    return `<section class="card table"><h3>${esc(group.name)}</h3><div class="tablewrap"><table><thead><tr><th>#</th><th class="left">Ομάδα</th><th>Αγ</th><th>Ν</th><th>Ι</th><th>Η</th><th>Δ</th>${hasPoints ? "<th>Β</th>" : ""}</tr></thead><tbody>${group.rows.map((row) => `<tr class="${highlight.includes(row.team.id) ? "hl" : ""}"><td>${row.rank}</td><td class="left">${leagueId ? `<a class="tableteam" href="#/team/${encodeURIComponent(leagueId)}/${encodeURIComponent(row.team.id)}">${crest(row.team, "small")}${esc(row.team.name)}</a>` : esc(row.team.name)}</td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.diff > 0 ? "+" : ""}${row.diff}</td>${hasPoints ? `<td><b>${row.points}</b></td>` : ""}</tr>`).join("")}</tbody></table></div></section>`;
  }).join("");
}

const hiddenNames = () => [...known.values()].filter(isHidden);

const videoCard = (video, match) => {
  const secret = match ? (isHidden(match) ? match : null) : hiddenNames().find((m) => mentionsTeam(video.title, m.home.name) && mentionsTeam(video.title, m.away.name));
  const title = secret ? `${secret.home.name} – ${secret.away.name} · Highlights` : video.title;
  const thumb = secret ? `<span class="thumb hidden">${icon("EyeOff", 30)}</span>` : `<span class="thumb"><img src="https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><i>▶</i></span>`;
  return `<a class="video" href="https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}" target="_blank" rel="noopener">${thumb}<span class="vtext"><b>${esc(title)}</b><small>${esc(video.channel)} · ${dayLabel(video.publishedMs)}</small></span></a>`;
};

function downloadIcs(games, name) {
  const url = URL.createObjectURL(new Blob([icsFile(games, name)], { type: "text/calendar" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `${name.replace(/[^\p{L}\p{N}]+/gu, "-")}.ics` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const isWatched = (id) => state.watched.find((game) => game.id === id);

function logWatch(match, ground, attended) {
  const existing = isWatched(match.id);
  const record = existing || { id: match.id, home: match.home.name, away: match.away.name, homeLogo: match.home.logo, awayLogo: match.away.logo, league: match.league.name, sport: match.sport, kickoff: match.kickoff, homeScore: match.homeScore, awayScore: match.awayScore, venue: match.venue || ground?.name || null, attended: false };
  if (attended) {
    const updated = { ...record, attended: !record.attended, venue: record.venue || ground?.name || null };
    state.watched = existing ? state.watched.map((g) => (g.id === match.id ? updated : g)) : [...state.watched, updated];
  } else {
    state.watched = existing ? state.watched.filter((g) => g.id !== match.id) : [...state.watched, record];
  }
  save("kerkida-season", state.watched);
}

const formDots = (form) => form.map((r) => `<i class="form ${r}">${r === "W" ? "Ν" : r === "L" ? "Η" : "Ι"}</i>`).join("") || "<small>–</small>";

async function loadPreviewInto(box, data, tableRows, token) {
  const match = data.match;
  box.innerHTML = scarfBar(null);
  const [homeGames, awayGames, fpl] = await Promise.all([api.teamHistory(match.league.id, match.home.id, 1), api.teamHistory(match.league.id, match.away.id, 1), match.league.id === "eng.1" ? api.fantasyData() : null]);
  if (token !== renderToken || !box.isConnected) return;
  const squadOf = (name) => {
    if (!fpl?.teams?.length) return [];
    const team = fpl.teams.map((t) => [t, teamSimilarity(t.name, name)]).sort((a, b) => b[1] - a[1])[0];
    return team && team[1] >= 0.7 ? fpl.players.filter((p) => p.team === team[0].id) : [];
  };
  const out = (list) => list.filter((p) => p.status !== "a" && (p.chance ?? 0) < 75 && p.news).sort((a, b) => b.starts - a.starts);
  const absences = { home: out(squadOf(match.home.name)), away: out(squadOf(match.away.name)) };
  const preview = buildPreview(match, homeGames, awayGames, tableRows, absences);
  const eleven = async (game) => {
    if (!game?.linkable || game.basic) return null;
    const last = await api.matchDetails(match.league.id, game.eventId).catch(() => null);
    if (!last) return null;
    return game.home.id === last.match.home.id && (game.home.id === match.home.id || game.home.id === match.away.id) ? { h: last.home, a: last.away, last } : { h: last.home, a: last.away, last };
  };
  const [lastHome, lastAway] = await Promise.all([eleven(preview.lastHome), eleven(preview.lastAway)]);
  if (token !== renderToken || !box.isConnected) return;
  const lineupOf = (found, teamId) => (found ? (found.last.match.home.id === teamId ? found.h : found.a) : null);
  const homeLine = data.home?.players?.some((p) => p.starter) ? data.home : lineupOf(lastHome, match.home.id);
  const awayLine = data.away?.players?.some((p) => p.starter) ? data.away : lineupOf(lastAway, match.away.id);
  const official = data.home?.players?.some((p) => p.starter);
  const absent = (team, list) => (list.length ? `<li><b>${esc(team)}</b>${list.slice(0, 6).map((p) => `<small>${esc(p.name)}: ${esc(p.news)}</small>`).join("")}</li>` : "");
  box.innerHTML = `${preview.insights.length ? `<h2 class="section">Σημεία προσοχής</h2><section class="card notes">${preview.insights.map((n) => `<p>${esc(n)}</p>`).join("")}</section>` : ""}
  <h2 class="section">Φόρμα (το πιο πρόσφατο πρώτο)</h2><section class="card formcard"><div><span>${esc(match.home.name)}</span><span>${formDots(preview.homeForm)}</span></div><div><span>${esc(match.away.name)}</span><span>${formDots(preview.awayForm)}</span></div></section>
  <h2 class="section">Απουσίες</h2><section class="card notes">${absences.home.length || absences.away.length ? `<ul>${absent(match.home.name, absences.home)}${absent(match.away.name, absences.away)}</ul>` : `<p>${match.league.id === "eng.1" ? "Δεν υπάρχουν γνωστές απουσίες." : "Οι απουσίες είναι διαθέσιμες μόνο για την Premier League."}</p>`}</section>
  ${homeLine || awayLine ? `<h2 class="section">${official ? "Ενδεκάδες" : "Πιθανή ενδεκάδα"}</h2>${official ? "" : '<p class="fresh">Εκτίμηση: ίδια με τον τελευταίο αγώνα.</p>'}<div class="pitches">${homeLine ? pitchHtml(match.home.name, homeLine, false, [], match.league.id) : ""}${awayLine ? pitchHtml(match.away.name, awayLine, true, [], match.league.id) : ""}</div>` : ""}`;
}

async function loadH2h(box, match, token) {
  const games = await api.teamHistory(match.league.id, match.home.id, 5).catch(() => []);
  if (token !== renderToken || !box.isConnected) return;
  const met = games.filter((g) => g.id !== match.id && g.status === "FINISHED" && g.homeScore !== null && ((g.home.id === match.home.id && g.away.id === match.away.id) || (g.home.id === match.away.id && g.away.id === match.home.id)) && !isHidden(g)).sort((a, b) => b.kickoff - a.kickoff);
  if (!met.length) { box.innerHTML = ""; return; }
  const count = (r) => met.filter((g) => resultFor(g, match.home.id) === r).length;
  box.innerHTML = `<section class="card h2h"><h3>Μεταξύ τους</h3><div class="h2hrow"><span><b>${count("W")}</b>${esc(match.home.name)}</span><span><b>${count("D")}</b>Ισοπαλίες</span><span><b>${count("L")}</b>${esc(match.away.name)}</span></div><ul>${met.slice(0, 6).map((g) => `<li><small>${new Date(g.kickoff).toLocaleDateString(LOCALE(), { day: "numeric", month: "numeric", year: "2-digit" })}</small><span>${esc(g.home.name)} <b>${g.homeScore} – ${g.awayScore}</b> ${esc(g.away.name)}</span></li>`).join("")}</ul></section>`;
}

let speakTimer = null;
let spokenFor = null;

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const line = new SpeechSynthesisUtterance(text);
  line.lang = LOCALE();
  speechSynthesis.speak(line);
}

async function viewMatch(leagueId, eventId, wanted) {
  const token = ++renderToken;
  clearInterval(speakTimer);
  if (!api.leagueById(leagueId)) await api.loadCatalog();
  view.innerHTML = pageHead(api.leagueById(leagueId)?.name || "Αγώνας") + scarfBar(null);
  let data;
  try {
    data = await api.matchDetails(leagueId, eventId);
  } catch {
    if (token === renderToken) view.innerHTML = pageHead("Αγώνας") + message("Ο αγώνας δεν φορτώθηκε", "Δοκίμασε ξανά σε λίγο.");
    return;
  }
  const [guide, videoFile, tableGroups, photos, fpl, find] = await Promise.all([api.tvGuide(), api.highlights(), api.standings(leagueId).catch(() => []), api.commonsPhotos(), leagueId === "eng.1" ? api.fantasyData() : null, api.groundFinder()]);
  if (token !== renderToken) return;
  photoIndex = photos;
  if (fpl?.players) fplCodes = new Map(fpl.players.filter((p) => p.code).flatMap((p) => [`${p.first} ${p.second}`, p.name].map((n) => [n.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, ""), `https://resources.premierleague.com/premierleague25/photos/players/110x140/${p.code}.png`])));
  listings = guide.items || [];
  const match = data.match;
  known.set(match.id, match);
  const ground = find(match);
  const videos = state.flags.highlights && match.status === "FINISHED" ? videosFor(match, videoFile.videos || []) : [];
  const channels = matchChannels(match);
  const highlightsTab = videos.length ? [["highlights", "Highlights"]] : [];
  const previewTab = state.flags.preview && match.status === "SCHEDULED" && match.sport === "FOOTBALL" ? [["preview", "Προεπισκόπηση"]] : [];
  // The Greek league pages give results only, with no events or line-ups.
  const available = data.basic
    ? [["table", "Βαθμολογία"], ...highlightsTab, ["info", "Στοιχεία"]]
    : [["events", "Φάσεις"], ...highlightsTab, ...previewTab, ["lineups", "Παίκτες"], ["table", "Βαθμολογία"], ["info", "Στοιχεία"]];
  let tab = available.some(([id]) => id === wanted) ? wanted : available[0][0];
  const hiddenNotice = message("Ο αγώνας είναι κρυφός", "Πάτα το μάτι για να δεις σκορ, φάσεις και βαθμούς.", "EyeOff");
  const flat = tableGroups.flatMap((g) => g.rows);
  const paint = () => {
    const hidden = isHidden(match);
    const log = isWatched(match.id);
    const content = {
      events: () => (hidden ? hiddenNotice : eventsHtml(data)),
      highlights: () => `<div class="videos">${videos.map((v) => videoCard(v, match)).join("")}</div>`,
      preview: () => '<div id="previewbox"></div>',
      lineups: () => (hidden ? hiddenNotice : lineupsHtml(data)),
      table: () => tableHtml(tableGroups.map((g) => ({ ...g, leagueId })), [match.home.id, match.away.id]),
      info: () => `<div class="actions">
        ${match.status !== "SCHEDULED" ? `<button class="chip ${log ? "on" : ""}" data-act="watched">${icon("Check", 16)}Το είδα</button><button class="chip ${log?.attended ? "on" : ""}" data-act="attended">${icon("Pin", 16)}Ήμουν στο γήπεδο</button>` : `<button class="chip" data-act="ics">${icon("Calendar", 16)}Στο ημερολόγιο</button>`}
        ${ground ? `<a class="chip" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${ground.lat},${ground.lng}">${icon("Pin", 16)}Οδηγίες</a>` : ""}
      </div>
      <section class="card info"><dl><dt>Ημερομηνία</dt><dd>${esc(longDay(match.kickoff))}, ${time(match.kickoff)}</dd><dt>Διοργάνωση</dt><dd>${esc(match.league.name)}</dd>${match.venue || ground ? `<dt>Γήπεδο</dt><dd>${esc(match.venue || ground.name)}</dd>` : ""}<dt>Μετάδοση</dt><dd>${channels.length ? esc(channels.join(", ")) : "Δεν υπάρχει γνωστό κανάλι"}</dd></dl>${novaButton(channels)}</section><div id="h2hbox"></div>`,
    }[tab]();
    const teamLink = (team) => (team.id ? `href="#/team/${encodeURIComponent(leagueId)}/${encodeURIComponent(team.id)}"` : "");
    view.innerHTML = `${pageHead(match.league.name)}<section class="hero">
      <a class="heroteam" ${teamLink(match.home)}>${crest(match.home, "big")}<b>${esc(match.home.name)}</b></a>
      <div class="heroscore">${scoreCell(match)}<small>${esc(dayLabel(match.kickoff))} · ${time(match.kickoff)}</small></div>
      <a class="heroteam" ${teamLink(match.away)}>${crest(match.away, "big")}<b>${esc(match.away.name)}</b></a>
      ${match.status === "LIVE" ? `<button class="iconbtn herosound ${state.flags.speak ? "on" : ""}" data-act="speak" aria-label="Εκφώνηση φάσεων">${icon(state.flags.speak ? "SoundOn" : "SoundOff")}</button>` : ""}
      ${match.status !== "SCHEDULED" ? `<button class="iconbtn heroeye" data-hide="${esc(match.id)}" aria-pressed="${hidden}" aria-label="${hidden ? "Εμφάνιση αγώνα" : "Απόκρυψη αγώνα"}">${icon(hidden ? "EyeOff" : "Eye")}</button>` : ""}
    </section>${tabs(available, tab)}<div class="tabbody">${content}</div>`;
    view.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { tab = button.dataset.tab; paint(); }));
    view.querySelector(".heroeye")?.addEventListener("click", (event) => { event.stopPropagation(); toggleHidden(match.id); paint(); });
    view.querySelectorAll("[data-rate]").forEach((button) => button.addEventListener("click", () => rateDetail(data, button.dataset.rate)));
    view.querySelectorAll("[data-act]").forEach((button) => button.addEventListener("click", () => {
      const act = button.dataset.act;
      if (act === "ics") downloadIcs([{ ...match, channel: channels[0] }], `${match.home.name} ${match.away.name}`);
      if (act === "watched") { logWatch(match, ground, false); paint(); }
      if (act === "attended") { logWatch(match, ground, true); paint(); }
      if (act === "speak") { setFlag("speak", !state.flags.speak); paint(); }
    }));
    if (tab === "preview") loadPreviewInto(document.getElementById("previewbox"), data, flat, token);
    if (tab === "info" && !data.basic) loadH2h(document.getElementById("h2hbox"), match, token);
  };
  paint();
  if (match.status === "LIVE" && !data.basic) {
    spokenFor = new Set(data.events.map((e) => `${e.minute}|${e.kind}|${e.player}`));
    speakTimer = setInterval(async () => {
      if (token !== renderToken) { clearInterval(speakTimer); return; }
      const fresh = await api.matchDetails(leagueId, eventId).catch(() => null);
      if (!fresh || token !== renderToken) return;
      const added = fresh.events.filter((e) => !spokenFor.has(`${e.minute}|${e.kind}|${e.player}`));
      added.forEach((e) => spokenFor.add(`${e.minute}|${e.kind}|${e.player}`));
      Object.assign(data, fresh);
      Object.assign(match, fresh.match);
      if (state.flags.speak && !isHidden(match)) added.filter((e) => /goal|red/i.test(e.kind)).forEach((e) => speak(`${e.text}, ${e.player}, ${e.minute}`));
      if (added.length && ["events", "lineups"].includes(tab)) paint();
    }, 45_000);
  }
}

async function tonightHtml(items) {
  const date = today();
  const leagues = api.LEAGUES.filter((l) => l.kind === "team" && l.sport === "FOOTBALL" && api.isFollowed(l));
  const games = (await api.loadDay(leagues, date)).filter((g) => ["SCHEDULED", "LIVE"].includes(g.status));
  const entries = await Promise.all(games.map(async (match) => {
    const channels = channelsFor(match, items);
    if (!channels.length && !isMine(match)) return null;
    const rows = (await api.standings(match.league.id).catch(() => [])).flatMap((g) => g.rows);
    return { match, channels, worth: worth(match, rows) };
  }));
  const canWatch = (e) => e.channels.some((c) => !isPaid(c) || state.mine.has(networkOf(c)));
  const score = (e) => (isMine(e.match) ? 0 : 4) + (canWatch(e) ? 0 : 2) + (e.worth?.level === "TOP" ? 0 : e.worth ? 0.5 : 1);
  const ranked = entries.filter(Boolean).sort((a, b) => score(a) - score(b) || a.match.kickoff - b.match.kickoff).slice(0, 6);
  if (!ranked.length) return "";
  return `<h2 class="section">Απόψε</h2><section class="card">${ranked.map((e) => `<a class="tvrow" href="#/match/${encodeURIComponent(e.match.league.id)}/${encodeURIComponent(e.match.eventId)}"><b class="tvtime">${time(e.match.kickoff)}</b><div><b>${esc(e.match.home.name)} – ${esc(e.match.away.name)}</b><small class="channel">${icon("Tv", 14)} ${esc(e.channels[0] || "Δεν υπάρχει γνωστό κανάλι")}</small>${isMine(e.match) ? '<span class="tag">Η ομάδα μου</span>' : ""}${e.worth ? `<span class="tag ${e.worth.level === "TOP" ? "top" : ""}">${esc(e.worth.label)}</span>` : ""}</div></a>`).join("")}</section>`;
}

const tvKey = (item) => `${item.startMs}|${item.channel}|${item.title}`;

async function viewTv() {
  const token = ++renderToken;
  const pages = [["guide", "Πρόγραμμα"], ...(state.flags.highlights ? [["highlights", "Highlights"]] : [])];
  if (!pages.some(([id]) => id === state.tvTab)) state.tvTab = "guide";
  view.innerHTML = `<header class="pagehead"><h1>Τι παίζει στην TV</h1></header>${tabs(pages, state.tvTab)}<div id="tvbody">${scarfBar(null)}</div>`;
  view.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.tvTab = button.dataset.tab; viewTv(); }));
  const [guide, videoFile] = await Promise.all([api.tvGuide(), api.highlights()]);
  if (token !== renderToken) return;
  const box = document.getElementById("tvbody");
  if (state.tvTab === "highlights") {
    const all = videoFile.videos || [];
    const sources = [...new Set(all.map((v) => v.channel))];
    const paintVideos = () => {
      const shown = all.filter((v) => (!state.tvSource || v.channel === state.tvSource) && (state.tvSource !== "__mine" || true));
      const mineOnly = state.tvSource === "__mine" ? all.filter((v) => state.favTeams.some((t) => mentionsTeam(v.title, t.name))) : shown;
      box.innerHTML = `<div class="strip chips"><button class="chip ${state.tvSource === "__mine" ? "on" : ""}" data-src="__mine">Οι ομάδες μου</button>${sources.map((s) => `<button class="chip ${state.tvSource === s ? "on" : ""}" data-src="${esc(s)}">${esc(s)}</button>`).join("")}</div>${mineOnly.length ? `<div class="videos">${mineOnly.slice(0, 60).map((v) => videoCard(v)).join("")}</div>` : message("Δεν υπάρχουν ακόμα highlights", "Ανανεώνονται αυτόματα από τα επίσημα κανάλια.", "Tv")}`;
      box.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => { state.tvSource = state.tvSource === b.dataset.src ? null : b.dataset.src; paintVideos(); }));
    };
    paintVideos();
    return;
  }
  const items = guide.items || [];
  listings = items;
  const days = [...new Set(items.map((item) => item.date))].sort();
  const now = today();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (!days.includes(state.tvDay)) state.tvDay = days.includes(todayKey) ? todayKey : days[0];
  const paint = () => {
    const q = state.tvQuery.trim();
    const nowMs = Date.now();
    const shown = items.filter((item) => item.date === state.tvDay && (!q || matchesQuery(`${item.title} ${item.competition} ${item.channel}`, q) || `${item.title} ${item.competition} ${item.channel}`.toLowerCase().includes(q.toLowerCase())))
      .filter((item) => (state.tvFilter === "live" ? nowMs >= item.startMs && nowMs < item.endMs : state.tvFilter === "mine" ? !isPaid(item.channel) || state.mine.has(networkOf(item.channel)) : state.tvFilter === "stars" ? state.tvStars.has(tvKey(item)) : true));
    const groups = new Map();
    for (const item of shown) {
      const key = `${item.startMs}|${item.title}`;
      if (!groups.has(key)) groups.set(key, { ...item, channels: [] });
      groups.get(key).channels.push(item.channel);
    }
    document.getElementById("tvlist").innerHTML = groups.size ? `<section class="card">${[...groups.values()].map((item) => {
      const liveNow = nowMs >= item.startMs && nowMs < item.endMs;
      const channels = [...new Set(item.channels)];
      const star = state.tvStars.has(tvKey(item));
      return `<div class="tvrow"><b class="tvtime ${liveNow ? "live" : ""}">${esc(item.time)}</b><div><b>${esc(item.title)}</b><small>${esc(item.competition)}</small><small class="channel">${icon("Tv", 14)} ${esc(channels.join(", "))} · ${channels.some((c) => state.mine.has(networkOf(c))) ? "το έχεις" : isPaid(channels[0]) ? "Συνδρομητικό" : "Ελεύθερο"}</small>${novaButton(channels)}</div><button class="iconbtn ${star ? "on" : ""}" data-tvstar="${esc(tvKey(item))}" aria-label="Αγαπημένη μετάδοση">${icon("Star", 20)}</button></div>`;
    }).join("")}</section>` : message("Δεν βρέθηκαν μεταδόσεις", "Δοκίμασε άλλη ημέρα ή αναζήτηση.", "Tv");
    document.querySelectorAll("[data-tvstar]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.tvstar;
      if (state.tvStars.has(k)) state.tvStars.delete(k); else state.tvStars.add(k);
      save("kerkida-tv-stars", [...state.tvStars].slice(-200));
      paint();
    }));
  };
  const FILTER = [["live", "Τώρα live"], ["mine", "Τα κανάλια μου"], ["stars", "Αγαπημένα"]];
  box.innerHTML = days.length ? `<div id="tonight"></div><nav class="strip dates">${days.map((day) => {
    const date = new Date(`${day}T12:00:00`);
    return `<button class="day ${day === state.tvDay ? "on" : ""}" data-tvday="${day}"><span>${day === todayKey ? "Σήμερα" : esc(date.toLocaleDateString(LOCALE(), { weekday: "short" }))}</span><b>${day.slice(8)}/${day.slice(5, 7)}</b></button>`;
  }).join("")}</nav><label class="search">${icon("Search", 20)}<input id="tvsearch" value="${esc(state.tvQuery)}" placeholder="Ομάδα, διοργάνωση ή κανάλι" aria-label="Αναζήτηση στο πρόγραμμα"></label><div class="strip chips">${FILTER.map(([id, label]) => `<button class="chip ${state.tvFilter === id ? "on" : ""}" data-tvfilter="${id}">${label}</button>`).join("")}</div><div id="tvlist"></div>${guide.updated ? `<p class="fresh">Ενημέρωση: ${esc(new Date(guide.updated).toLocaleString(LOCALE(), { dateStyle: "short", timeStyle: "short" }))}</p>` : ""}` : message("Το πρόγραμμα δεν είναι διαθέσιμο", "Θα εμφανιστεί με την επόμενη αυτόματη ενημέρωση.", "Tv");
  if (!days.length) return;
  box.querySelectorAll("[data-tvday]").forEach((button) => button.addEventListener("click", () => {
    state.tvDay = button.dataset.tvday;
    box.querySelectorAll("[data-tvday]").forEach((b) => b.classList.toggle("on", b === button));
    paint();
  }));
  box.querySelectorAll("[data-tvfilter]").forEach((button) => button.addEventListener("click", () => {
    state.tvFilter = state.tvFilter === button.dataset.tvfilter ? "all" : button.dataset.tvfilter;
    box.querySelectorAll("[data-tvfilter]").forEach((b) => b.classList.toggle("on", b.dataset.tvfilter === state.tvFilter));
    paint();
  }));
  document.getElementById("tvsearch").addEventListener("input", (event) => { state.tvQuery = event.target.value; paint(); });
  paint();
  tonightHtml(items).then((html) => { const slot = document.getElementById("tonight"); if (token === renderToken && slot) slot.innerHTML = html; }).catch(() => {});
}

function viewLeagues() {
  ++renderToken;
  const open = [...api.LEAGUES].filter((l) => api.hasTable(l) && api.isFollowed(l));
  const groups = [...new Set(open.map((l) => l.sport))];
  view.innerHTML = `<header class="pagehead"><h1>Λίγκες</h1><a class="chip push" href="#/picker">Λίγκες που ακολουθώ</a></header>${groups.map((sport) => `<h2 class="section">${esc(api.SPORTS.find((s) => s.id === sport).label)}</h2><section class="card">${open.filter((l) => l.sport === sport).map((league) => `<div class="listrow"><a href="#/league/${encodeURIComponent(league.id)}"><i class="badge square">${esc(initial(league.name))}</i><span><b>${esc(league.name)}</b><small>${esc(league.country || "")}</small></span></a><button class="iconbtn ${state.favLeagues.includes(league.id) ? "on" : ""}" data-fav-league="${esc(league.id)}" aria-label="Αγαπημένη λίγκα">${icon("Star", 20)}</button></div>`).join("")}</section>`).join("")}`;
}

async function viewLeague(id) {
  const token = ++renderToken;
  if (!api.leagueById(id)) await api.loadCatalog();
  const league = api.leagueById(id);
  if (!league) { view.innerHTML = message("Δεν βρέθηκε η λίγκα"); return; }
  view.innerHTML = pageHead(league.name) + scarfBar(null);
  const groups = await api.standings(id).catch(() => []);
  if (token !== renderToken) return;
  view.innerHTML = pageHead(league.name) + `<div class="tabbody">${tableHtml(groups.map((g) => ({ ...g, leagueId: id })))}</div>`;
}

async function clubHtml(team, leagueId) {
  const league = api.leagueById(leagueId);
  const profile = await clubProfile(`${leagueId}:${team.id}`, team.name, league?.sport || "FOOTBALL", league?.country === "Ελλάδα").catch(() => null);
  if (!profile) return message("Δεν βρέθηκαν στοιχεία συλλόγου", "Προτιμούμε να μη δείξουμε λάθος σύλλογο.", "Info");
  const photo = profile.ground?.file ? `<img class="groundphoto" src="https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(profile.ground.file.replaceAll(" ", "_"))}?width=720" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `${profile.about ? `<section class="card notes"><p>${esc(profile.about)}</p></section>` : ""}
  <section class="card info"><dl>${profile.founded ? `<dt>Ίδρυση</dt><dd>${esc(profile.founded)}</dd>` : ""}${profile.city ? `<dt>Πόλη</dt><dd>${esc(profile.city)}</dd>` : ""}${profile.ground ? `<dt>Γήπεδο</dt><dd>${esc(profile.ground.name)}${profile.ground.opened ? ` (${profile.ground.opened})` : ""}</dd>` : ""}</dl></section>
  ${profile.ground ? `<section class="card">${photo}${profile.ground.about ? `<div class="notes"><p>${esc(profile.ground.about)}</p></div>` : ""}</section>` : ""}
  ${profile.honours.length ? `<h2 class="section">Τίτλοι</h2><section class="card notes"><ul class="honours">${profile.honours.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></section>` : ""}
  ${profile.url ? `<p class="fresh">Πηγή: <a href="${esc(profile.url)}" target="_blank" rel="noopener">Wikipedia</a>, Wikidata (CC BY-SA)</p>` : ""}`;
}

async function viewTeam(leagueId, teamId) {
  const token = ++renderToken;
  if (!api.leagueById(leagueId)) await api.loadCatalog();
  view.innerHTML = pageHead("Ομάδα") + scarfBar(null);
  let team;
  try {
    team = await api.teamSchedule(leagueId, teamId);
  } catch {
    if (token === renderToken) view.innerHTML = pageHead("Ομάδα") + message("Η ομάδα δεν φορτώθηκε", "Δοκίμασε ξανά σε λίγο.");
    return;
  }
  if (token !== renderToken) return;
  team.id = teamId;
  const coming = team.games.filter((g) => g.status === "SCHEDULED" || g.status === "LIVE").slice(0, 12);
  const played = team.games.filter((g) => g.status === "FINISHED").slice(-12).reverse();
  const groups = await api.standings(leagueId).catch(() => []);
  if (token !== renderToken) return;
  const pages = [["matches", "Αγώνες"], ...(groups.length ? [["table", "Βαθμολογία"]] : []), ...(state.flags.club ? [["club", "Σύλλογος"]] : [])];
  let tab = "matches";
  const section = (title, games) => (games.length ? `<h2 class="section">${title}</h2><section class="card">${games.map((game) => `<p class="rowdate">${esc(dayLabel(game.kickoff))}</p>${matchRow(game)}`).join("")}</section>` : "");
  const paint = () => {
    const fav = isFavTeam(teamId);
    view.innerHTML = `${pageHead(team.name)}<section class="hero single">${crest(team, "big")}<b>${esc(team.name)}</b><small>${esc(api.leagueById(leagueId)?.name || "")}</small><div class="actions center"><button class="favbtn ${fav ? "on" : ""}" data-fav-team="${esc(teamId)}" data-team-name="${esc(team.name)}" data-team-league="${esc(leagueId)}" data-team-logo="${esc(team.logo || "")}">${icon("Star", 18)} ${fav ? "Στα αγαπημένα" : "Προσθήκη στα αγαπημένα"}</button>${coming.length ? `<button class="favbtn" data-team-ics>${icon("Calendar", 18)} Στο ημερολόγιο</button>` : ""}</div></section>${tabs(pages, tab)}<div class="tabbody" id="teambody"></div>`;
    const body = document.getElementById("teambody");
    if (tab === "matches") body.innerHTML = `${section("Επόμενοι αγώνες", coming)}${section("Τελευταίοι αγώνες", played)}${!coming.length && !played.length ? message("Δεν υπάρχουν αγώνες") : ""}`;
    if (tab === "table") body.innerHTML = tableHtml(groups.map((g) => ({ ...g, leagueId })), [teamId]);
    if (tab === "club") { body.innerHTML = scarfBar(null); clubHtml(team, leagueId).then((html) => { if (token === renderToken && tab === "club") body.innerHTML = html; }); }
    view.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; paint(); }));
    view.querySelector("[data-team-ics]")?.addEventListener("click", () => downloadIcs(team.games.filter((g) => g.status === "SCHEDULED"), `Kerkida ${team.name}`));
  };
  paint();
}

let teamIndex = null;

async function buildTeamIndex() {
  if (teamIndex) return teamIndex;
  const leagues = api.LEAGUES.filter(api.hasTable);
  const lists = await Promise.all(leagues.map((league) => api.standings(league.id).then((groups) => groups.flatMap((group) => group.rows.map((row) => ({ ...row.team, leagueId: league.id, league: league.name })))).catch(() => [])));
  const seen = new Set();
  teamIndex = lists.flat().filter((team) => !seen.has(`${team.leagueId}:${team.id}`) && seen.add(`${team.leagueId}:${team.id}`));
  return teamIndex;
}

async function viewSearch() {
  const token = ++renderToken;
  view.innerHTML = `<header class="pagehead"><h1>Αναζήτηση</h1></header><label class="search">${icon("Search", 20)}<input id="q" placeholder="Ομάδα ή λίγκα, και στα ελληνικά" aria-label="Αναζήτηση" autocomplete="off"></label><div id="results">${message("Βρες την ομάδα σου", "Γράψε όνομα ομάδας ή λίγκας.", "Search")}</div>`;
  const input = document.getElementById("q");
  input.focus();
  const box = document.getElementById("results");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { box.innerHTML = message("Βρες την ομάδα σου", "Γράψε όνομα ομάδας ή λίγκας.", "Search"); return; }
      if (!teamIndex) box.innerHTML = scarfBar(null);
      const teams = await buildTeamIndex();
      if (token !== renderToken || input.value.trim() !== q) return;
      const foundTeams = teams.filter((team) => matchesQuery(team.name, q)).slice(0, 20);
      const foundLeagues = api.LEAGUES.filter((league) => api.hasTable(league) && matchesQuery(league.name, q));
      box.innerHTML = foundTeams.length || foundLeagues.length ? `${foundTeams.length ? `<h2 class="section">Ομάδες</h2><section class="card">${foundTeams.map((team) => `<div class="listrow"><a href="#/team/${encodeURIComponent(team.leagueId)}/${encodeURIComponent(team.id)}">${crest(team)}<span><b>${esc(team.name)}</b><small>${esc(team.league)}</small></span></a></div>`).join("")}</section>` : ""}${foundLeagues.length ? `<h2 class="section">Λίγκες</h2><section class="card">${foundLeagues.map((league) => `<div class="listrow"><a href="#/league/${encodeURIComponent(league.id)}"><i class="badge square">${esc(initial(league.name))}</i><span><b>${esc(league.name)}</b><small>${esc(league.country || "")}</small></span></a></div>`).join("")}</section>` : ""}` : message("Δεν βρέθηκε κάτι", "Δοκίμασε άλλη γραφή.", "Search");
    }, 250);
  });
}

const CHANNEL_OPTIONS = [["nova", "Nova"], ["magenta", "Magenta"], ["eurosport", "Eurosport"], ["dazn", "DAZN"], ["ant1plus", "ΑΝΤ1+"]];

function viewFavourites() {
  ++renderToken;
  const leagues = state.favLeagues.map(api.leagueById).filter(Boolean);
  view.innerHTML = `<header class="pagehead"><h1>Αγαπημένα</h1><a class="chip push" href="#/season">${icon("Trophy", 16)}Η σεζόν μου</a></header><div id="dashboard"></div>
  ${state.favTeams.length ? `<h2 class="section">Ομάδες</h2><section class="card">${state.favTeams.map((team) => `<div class="listrow"><a href="#/team/${encodeURIComponent(team.league)}/${encodeURIComponent(team.id)}">${crest(team)}<span><b>${esc(team.name)}</b><small>${esc(api.leagueById(team.league)?.name || "")}</small></span></a><button class="iconbtn on" data-fav-team="${esc(team.id)}" data-team-name="${esc(team.name)}" data-team-league="${esc(team.league)}" aria-label="Αφαίρεση">${icon("Star", 20)}</button></div>`).join("")}</section>` : ""}
  ${leagues.length ? `<h2 class="section">Λίγκες</h2><section class="card">${leagues.map((league) => `<div class="listrow"><a href="#/league/${encodeURIComponent(league.id)}"><i class="badge square">${esc(initial(league.name))}</i><span><b>${esc(league.name)}</b><small>${esc(league.country || "")}</small></span></a><button class="iconbtn on" data-fav-league="${esc(league.id)}" aria-label="Αφαίρεση">${icon("Star", 20)}</button></div>`).join("")}</section>` : ""}
  ${!state.favTeams.length && !leagues.length ? message("Δεν έχεις αγαπημένα ακόμα", "Πάτα το αστέρι σε μια ομάδα ή λίγκα.", "Star") : ""}
  <p class="fresh">Όλα αυτά μένουν μόνο σε αυτόν τον browser.</p>`;
  const token = renderToken;
  Promise.all(state.favTeams.slice(0, 6).map(async (team) => {
    const data = await api.teamSchedule(team.league, team.id).catch(() => null);
    if (!data) return "";
    const last = data.games.filter((g) => g.status === "FINISHED").at(-1);
    const next = data.games.find((g) => g.status === "SCHEDULED" || g.status === "LIVE");
    return `<section class="card"><header class="cardhead">${crest(team)}<a href="#/team/${encodeURIComponent(team.league)}/${encodeURIComponent(team.id)}"><b>${esc(team.name)}</b></a></header>${last ? `<p class="rowdate">Τελευταίος · ${esc(dayLabel(last.kickoff))}</p>${matchRow(last)}` : ""}${next ? `<p class="rowdate">Επόμενος · ${esc(dayLabel(next.kickoff))}</p>${matchRow(next)}` : ""}</section>`;
  })).then((cards) => { const box = document.getElementById("dashboard"); if (token === renderToken && box) box.innerHTML = cards.join(""); });
}

function viewSeason() {
  ++renderToken;
  const seasons = [...new Set(state.watched.map((g) => seasonOf(g.kickoff)))].sort((a, b) => b - a);
  const season = seasons.includes(state.season) ? state.season : seasons[0];
  if (!seasons.length) { view.innerHTML = pageHead("Η σεζόν μου") + message("Δεν έχεις καταγράψει αγώνες", "Άνοιξε έναν αγώνα, πήγαινε στα Στοιχεία και πάτα «Το είδα».", "Trophy"); return; }
  const s = seasonSummary(state.watched, season);
  const list = state.watched.filter((g) => seasonOf(g.kickoff) === season).sort((a, b) => b.kickoff - a.kickoff);
  const grounds = Object.entries(state.watched.filter((g) => g.attended && g.venue).reduce((m, g) => ({ ...m, [g.venue]: (m[g.venue] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const top = (title, rows) => (rows.length ? `<h2 class="section">${title}</h2><section class="card">${rows.map(([name, n]) => `<div class="kv"><span>${esc(name)}</span><b>${n}</b></div>`).join("")}</section>` : "");
  const line = (g) => `<div class="kv"><span>${esc(g.home)} ${g.homeScore ?? ""}${g.homeScore !== null && g.homeScore !== undefined ? " – " : " – "}${g.awayScore ?? ""} ${esc(g.away)}<small>${esc(g.league)} · ${esc(dayLabel(g.kickoff))}${g.attended ? " · στο γήπεδο" : ""}</small></span></div>`;
  view.innerHTML = `${pageHead("Η σεζόν μου")}${seasons.length > 1 ? `<div class="strip chips">${seasons.map((y) => `<button class="chip ${y === season ? "on" : ""}" data-season="${y}">${y}/${String(y + 1).slice(2)}</button>`).join("")}</div>` : ""}
  <section class="stats"><div><b>${s.matches}</b>αγώνες</div><div><b>${s.goals}</b>γκολ</div><div><b>${s.perMatch.toFixed(1)}</b>ανά αγώνα</div><div><b>${s.grounds}</b>γήπεδα</div></section>
  ${s.biggest ? `<h2 class="section">Τα περισσότερα γκολ</h2><section class="card">${line(s.biggest)}</section>` : ""}${top("Όσους είδες πιο πολύ", s.topTeams)}${top("Διοργανώσεις", s.topLeagues)}${top("Γήπεδα που πήγες", grounds)}<h2 class="section">Αγώνες που είδες</h2><section class="card">${list.map(line).join("")}</section>`;
  view.querySelectorAll("[data-season]").forEach((b) => b.addEventListener("click", () => { state.season = Number(b.dataset.season); viewSeason(); }));
}

async function viewWeekend() {
  const token = ++renderToken;
  view.innerHTML = pageHead("Το Σαββατοκύριακό μου") + scarfBar(null);
  const days = weekendDays(today());
  const leagues = [...new Set([...api.leaguesFor("FOOTBALL"), ...api.leaguesFor("BASKETBALL"), ...api.leaguesFor("VOLLEYBALL")])];
  const [guide, find, ...lists] = await Promise.all([api.tvGuide(), api.groundFinder(), ...days.map((day) => api.loadDay(leagues, day))]);
  if (token !== renderToken) return;
  const items = guide.items || [];
  const place = state.place;
  const nowMs = Date.now();
  const canWatch = (c) => !isPaid(c) || state.mine.has(networkOf(c));
  const entries = lists.flat().filter((g) => ["SCHEDULED", "LIVE"].includes(g.status) && g.kickoff >= nowMs - 7_200_000).map((match) => {
    const ground = find(match);
    const raw = place && ground ? distanceKm(place.lat, place.lng, ground.lat, ground.lng) : null;
    const km = raw !== null && raw <= state.radius ? raw : null;
    const channels = matchChannels(match).filter(canWatch);
    const mine = isMine(match);
    if (!mine && km === null && !channels.length) return null;
    return { key: match.id, title: `${match.home.name} – ${match.away.name}`, startMs: match.kickoff, endMs: match.kickoff + (match.sport === "BASKETBALL" ? 125 : 115) * 60_000, match, channels, km, ground: ground?.name, mine, score: (mine ? 100 : 0) + (km !== null ? 40 - km / 5 : 0) + (channels.length ? 20 : 0) };
  }).filter(Boolean);
  const taken = new Set(entries.flatMap((e) => e.channels.map((c) => `${c}|${e.startMs}`)));
  const dayKeys = days.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  const tv = new Map();
  for (const item of items) {
    if (!dayKeys.includes(item.date) || item.endMs <= nowMs || !canWatch(item.channel) || taken.has(`${item.channel}|${item.startMs}`)) continue;
    const key = `${item.startMs}|${item.title}`;
    if (!tv.has(key)) tv.set(key, { key, title: item.title, startMs: item.startMs, endMs: item.endMs, channels: [], score: 20 });
    tv.get(key).channels.push(item.channel);
  }
  const plan = markPicks([...entries, ...tv.values()]);
  const render = (entry) => {
    const inner = `<b class="tvtime">${time(entry.startMs)}</b><div><b>${esc(entry.title)}</b>${entry.isPick ? '<span class="tag top">Η πρότασή μας</span>' : ""}${entry.mine ? '<span class="tag">Η ομάδα μου</span>' : ""}${entry.channels.length ? `<small class="channel">${icon("Tv", 14)} ${esc([...new Set(entry.channels)].join(", "))}</small>` : ""}${entry.km !== null && entry.km !== undefined ? `<small>${icon("Pin", 13)} ${esc(entry.ground)} · ${Math.max(1, Math.round(entry.km))} χλμ · φύγε στις ${time(leaveAt(entry.startMs, entry.km))}</small>` : ""}${entry.clashesWith ? `<small>Συμπίπτει με: ${esc(entry.clashesWith)}</small>` : ""}</div>`;
    return entry.match?.linkable ? `<a class="tvrow" href="#/match/${encodeURIComponent(entry.match.league.id)}/${encodeURIComponent(entry.match.eventId)}">${inner}</a>` : `<div class="tvrow">${inner}</div>`;
  };
  const sections = days.map((day) => {
    const list = plan.filter((e) => api.sameDay(e.startMs, day));
    return list.length ? `<h2 class="section">${esc(longDay(day.getTime()))}</h2><section class="card">${list.map(render).join("")}</section>` : "";
  }).join("");
  const picks = plan.filter((e) => e.isPick && e.match && e.match.kickoff > nowMs);
  view.innerHTML = `${pageHead("Το Σαββατοκύριακό μου")}${place ? `<p class="fresh">Κοντά σε: ${esc(place.name)}, έως ${state.radius} km</p>` : '<p class="notice">Διάλεξε περιοχή στο <a href="#/nearby">Κοντά μου</a> για αγώνες που μπορείς να πας.</p>'}${picks.length ? '<div class="actions"><button class="chip" data-week-ics>' + icon("Calendar", 16) + "Στο ημερολόγιο</button></div>" : ""}${sections || message("Δεν έχει τίποτα ακόμα", "Πρόσθεσε ομάδες, κανάλια ή περιοχή.", "Calendar")}`;
  view.querySelector("[data-week-ics]")?.addEventListener("click", () => downloadIcs(picks.map((e) => ({ ...e.match, channel: e.channels[0] })), "Kerkida Weekend"));
}

async function viewFantasy() {
  const token = ++renderToken;
  view.innerHTML = pageHead("Fantasy Premier League") + scarfBar(null);
  const data = await api.fantasyData();
  if (token !== renderToken) return;
  if (!data.players?.length) { view.innerHTML = pageHead("Fantasy Premier League") + message("Τα στοιχεία δεν είναι διαθέσιμα", "Θα εμφανιστούν με την επόμενη αυτόματη ενημέρωση.", "Trophy"); return; }
  const byId = new Map(data.players.map((p) => [p.id, p]));
  const teams = new Map(data.teams.map((t) => [t.id, t]));
  const POS = { 1: "ΤΕΡ", 2: "ΑΜΥ", 3: "ΜΕΣ", 4: "ΕΠΙ" };
  const LIMIT = { 1: 2, 2: 5, 3: 5, 4: 3 };
  let query = "";
  const paint = () => {
    state.squad.players = state.squad.players.filter((id) => byId.has(id));
    const result = fantasyPoints(state.squad, data.live || {});
    const count = (type) => state.squad.players.filter((id) => byId.get(id).type === type).length;
    const cost = state.squad.players.reduce((sum, id) => sum + byId.get(id).cost, 0) / 10;
    const q = query.trim();
    const found = q.length >= 2 ? data.players.filter((p) => matchesQuery(`${p.first} ${p.second}`, q) || matchesQuery(p.name, q) || matchesQuery(teams.get(p.team)?.name || "", q)).slice(0, 12) : [...data.players].sort((a, b) => Number(b.form) - Number(a.form)).slice(0, 10);
    const row = (p, chosen) => `<div class="listrow fpl"><span class="fplpos">${POS[p.type]}</span><span class="fplname"><b>${esc(p.name)}</b><small>${esc(teams.get(p.team)?.short || "")} · £${(p.cost / 10).toFixed(1)} · φόρμα ${esc(p.form)}${p.status !== "a" ? ` · ${esc(p.news)}` : ""}</small></span>${chosen ? `<b class="fplpts">${data.live?.[p.id]?.points ?? 0}</b><button class="chip ${state.squad.captain === p.id ? "on" : ""}" data-cap="${p.id}">C</button><button class="iconbtn" data-drop="${p.id}" aria-label="Αφαίρεση">${icon("Close", 18)}</button>` : `<button class="chip" data-add="${p.id}" ${state.squad.players.includes(p.id) || count(p.type) >= LIMIT[p.type] || state.squad.players.length >= 15 ? "disabled" : ""}>+</button>`}</div>`;
    const deadline = data.deadline ? new Date(data.deadline) : null;
    view.innerHTML = `${pageHead("Fantasy Premier League")}<section class="stats"><div><b>${data.gameweek ?? "–"}</b>αγωνιστική</div><div><b>${result.total}</b>πόντοι</div><div><b>${state.squad.players.length}/15</b>παίκτες</div><div><b>£${cost.toFixed(1)}</b>αξία</div></section>
    ${deadline ? `<p class="notice">Deadline αγωνιστικής ${data.nextGameweek ?? ""}: <b>${esc(deadline.toLocaleString(LOCALE(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}</b></p>` : ""}
    <p class="notice">Το επίσημο FPL δεν επιτρέπει σύνδεση λογαριασμού από στατικό site. Φτιάξε εδώ την ομάδα σου για να βλέπεις τους πόντους της. Οι πρώτοι 11 μετράνε.</p>
    ${state.squad.players.length ? `<h2 class="section">Η ομάδα μου</h2><section class="card">${state.squad.players.map((id, index) => (index === 11 ? '<p class="rowdate">Πάγκος</p>' : "") + row(byId.get(id), true)).join("")}</section>` : ""}
    <h2 class="section">${q ? "Αποτελέσματα" : "Σε φόρμα"}</h2><label class="search">${icon("Search", 20)}<input id="fplq" value="${esc(query)}" placeholder="Παίκτης ή ομάδα" aria-label="Αναζήτηση παίκτη"></label><section class="card">${found.map((p) => row(p, false)).join("") || "<p class='fresh'>Δεν βρέθηκε</p>"}</section>${data.updated ? `<p class="fresh">Ενημέρωση: ${esc(new Date(data.updated).toLocaleString(LOCALE(), { dateStyle: "short", timeStyle: "short" }))}</p>` : ""}`;
    const input = document.getElementById("fplq");
    input.addEventListener("input", () => { query = input.value; clearTimeout(input.t); input.t = setTimeout(() => { paint(); const next = document.getElementById("fplq"); next.focus(); next.setSelectionRange(query.length, query.length); }, 220); });
    const store = () => { save("kerkida-squad", state.squad); paint(); };
    view.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { state.squad.players.push(Number(b.dataset.add)); store(); }));
    view.querySelectorAll("[data-drop]").forEach((b) => b.addEventListener("click", () => { const id = Number(b.dataset.drop); state.squad.players = state.squad.players.filter((x) => x !== id); if (state.squad.captain === id) state.squad.captain = null; store(); }));
    view.querySelectorAll("[data-cap]").forEach((b) => b.addEventListener("click", () => { state.squad.captain = Number(b.dataset.cap); store(); }));
  };
  paint();
}

function setFlag(key, value) {
  state.flags[key] = value;
  save("kerkida-flags", state.flags);
  if (key === "alerts") startAlerts();
}

const FLAG_ROWS = [["autoHide", "Κρύψε αυτόματα τα αγαπημένα", "Σκορ και φάσεις των ομάδων σου μένουν κρυφά μέχρι να τα ανοίξεις."], ["ratings", "Βαθμολογίες με εξήγηση", "Βαθμοί παικτών με τις ενέργειες πίσω από αυτούς."], ["preview", "Προεπισκόπηση αγώνα", "Φόρμα, απουσίες, πιθανή ενδεκάδα και σημεία προσοχής."], ["highlights", "Highlights", "Επίσημα βίντεο από λίγκες, παρόχους και ομάδες."], ["photos", "Φωτογραφίες παικτών", "Στις ενδεκάδες, όπου υπάρχουν."], ["nova", "Κουμπί Nova TV", "Ανοίγει το κανάλι στην εφαρμογή Nova TV."], ["club", "Προφίλ συλλόγου", "Ιστορία, τίτλοι και γήπεδο από τη Wikipedia."], ["speak", "Εκφώνηση φάσεων", "Διαβάζει γκολ και κόκκινες σε ανοιχτό live αγώνα."]];

function viewSettings() {
  ++renderToken;
  const theme = document.documentElement.dataset.theme;
  const lang = document.documentElement.lang;
  const toggle = (key, title, body) => `<label class="switch"><span><b>${esc(title)}</b><small>${esc(body)}</small></span><input type="checkbox" data-flag="${key}" ${state.flags[key] ? "checked" : ""}></label>`;
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  view.innerHTML = `<header class="pagehead"><h1>Ρυθμίσεις</h1></header>
  <h2 class="section">Εμφάνιση</h2><div class="strip chips wrap"><button class="chip ${theme === "dark" ? "on" : ""}" data-theme-set="dark">Σκούρο</button><button class="chip ${theme === "light" ? "on" : ""}" data-theme-set="light">Φωτεινό</button></div>
  <h2 class="section">Γλώσσα</h2><div class="strip chips wrap"><button class="chip ${lang === "el" ? "on" : ""}" data-lang="el">Ελληνικά</button><button class="chip ${lang === "en" ? "on" : ""}" data-lang="en">English</button></div>
  <h2 class="section">Τα κανάλια μου</h2><div class="strip chips wrap">${CHANNEL_OPTIONS.map(([id, label]) => `<button class="chip ${state.mine.has(id) ? "on" : ""}" data-channel="${id}">${esc(label)}</button>`).join("")}</div>
  <h2 class="section">Λίγκες</h2><section class="card"><div class="listrow"><a href="#/picker"><i class="badge square">${icon("Leagues", 18)}</i><span><b>Λίγκες που ακολουθώ</b><small>Διάλεξε από όλες τις διοργανώσεις</small></span></a></div></section>
  <h2 class="section">Λειτουργίες</h2><section class="card">${FLAG_ROWS.map((r) => toggle(...r)).join("")}</section>
  <h2 class="section">Ειδοποιήσεις</h2><section class="card">${permission === "unsupported" ? '<p class="fresh">Ο browser δεν υποστηρίζει ειδοποιήσεις.</p>' : toggle("alerts", "Έξυπνες ειδοποιήσεις", "Κόκκινες, γκολ στο τέλος και ανατροπές για τις ομάδες σου, όσο το site είναι ανοιχτό.")}</section>
  <h2 class="section">Σχετικά</h2><section class="card notes"><p>Η Kerkida είναι ανεξάρτητο έργο. Όλες οι ρυθμίσεις και τα αγαπημένα μένουν σε αυτόν τον browser.</p><p><a href="https://github.com/NikosAnat/kerkida-web" target="_blank" rel="noopener">GitHub</a></p></section>`;
  view.querySelectorAll("[data-flag]").forEach((input) => input.addEventListener("change", async () => {
    const key = input.dataset.flag;
    if (key === "alerts" && input.checked && Notification.permission !== "granted") {
      const answer = await Notification.requestPermission();
      if (answer !== "granted") { input.checked = false; return; }
    }
    setFlag(key, input.checked);
  }));
  view.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { setLanguage(b.dataset.lang); route(true); }));
}

async function viewPicker() {
  const token = ++renderToken;
  view.innerHTML = pageHead("Λίγκες που ακολουθώ") + scarfBar(null);
  await api.loadCatalog();
  if (token !== renderToken) return;
  const all = [...api.LEAGUES, ...await api.loadCatalog()];
  let sport = "FOOTBALL";
  let query = "";
  const paint = () => {
    const q = query.trim();
    const shown = all.filter((l) => (q.length >= 2 ? matchesQuery(l.name, q) || l.name.toLowerCase().includes(q.toLowerCase()) : l.sport === sport)).sort((a, b) => Number(api.isFollowed(b)) - Number(api.isFollowed(a)) || a.name.localeCompare(b.name));
    document.getElementById("pickbody").innerHTML = `<section class="card">${shown.slice(0, 260).map((l) => `<label class="switch"><span><b>${esc(l.name)}</b>${l.country ? `<small>${esc(l.country)}</small>` : ""}</span><input type="checkbox" data-pick="${esc(l.id)}" ${api.isFollowed(l) ? "checked" : ""}></label>`).join("") || "<p class='fresh'>Δεν βρέθηκε</p>"}</section>`;
    document.querySelectorAll("[data-pick]").forEach((input) => input.addEventListener("change", () => { api.setFollowed(api.leagueById(input.dataset.pick), input.checked); nearbyGames = null; teamIndex = null; }));
  };
  view.innerHTML = `${pageHead("Λίγκες που ακολουθώ")}<label class="search">${icon("Search", 20)}<input id="pickq" placeholder="Αναζήτηση λίγκας" aria-label="Αναζήτηση λίγκας"></label><nav class="strip sports">${api.SPORTS.map((s) => `<button class="sport ${s.id === sport ? "on" : ""}" data-picksport="${s.id}">${icon(s.icon, 22)}<span>${esc(s.label)}</span></button>`).join("")}</nav><div id="pickbody"></div>`;
  document.getElementById("pickq").addEventListener("input", (event) => { query = event.target.value; paint(); });
  view.querySelectorAll("[data-picksport]").forEach((b) => b.addEventListener("click", (event) => {
    event.stopPropagation();
    sport = b.dataset.picksport;
    view.querySelectorAll("[data-picksport]").forEach((x) => x.classList.toggle("on", x === b));
    paint();
  }));
  paint();
}

let alertTimer = null;

async function checkAlerts() {
  if (!state.flags.alerts || Notification.permission !== "granted" || !state.favTeams.length) return;
  const memory = load("kerkida-alert-memory", {});
  const leagueIds = [...new Set(state.favTeams.map((t) => t.league))].map(api.leagueById).filter((l) => l?.kind === "team");
  const games = (await api.loadDay(leagueIds, today())).filter((g) => g.status === "LIVE" && isMine(g) && !isHidden(g));
  for (const game of games) {
    const detail = await api.matchDetails(game.league.id, game.eventId).catch(() => null);
    if (!detail) continue;
    const { alerts, memory: next } = detectAlerts(memory[game.id] || null, detail.match, detail.events);
    memory[game.id] = next;
    alerts.forEach((text) => new Notification(`${game.home.name} – ${game.away.name}`, { body: text, icon: "favicon.svg", tag: `${game.id}-${text}` }));
  }
  save("kerkida-alert-memory", memory);
}

function startAlerts() {
  clearInterval(alertTimer);
  if (state.flags.alerts && "Notification" in window) {
    checkAlerts().catch(() => {});
    alertTimer = setInterval(() => checkAlerts().catch(() => {}), 90_000);
  }
}

const TEXT_ORIGINAL = new WeakMap();
const translate = (text) => {
  const trimmed = text.trim();
  const found = EN[trimmed];
  return found ? text.replace(trimmed, found) : text;
};

function translateTree(root) {
  if (document.documentElement.lang !== "en") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = translate(node.nodeValue);
    if (next !== node.nodeValue) { TEXT_ORIGINAL.set(node, node.nodeValue); node.nodeValue = next; }
  }
  if (root.querySelectorAll) {
    root.querySelectorAll("[placeholder],[aria-label]").forEach((el) => {
      for (const attr of ["placeholder", "aria-label"]) if (el.hasAttribute(attr)) el.setAttribute(attr, translate(el.getAttribute(attr)));
    });
  }
}

new MutationObserver((changes) => {
  if (document.documentElement.lang !== "en") return;
  for (const change of changes) change.addedNodes.forEach((node) => { if (node.nodeType === 1) translateTree(node); else if (node.nodeType === 3) { const next = translate(node.nodeValue); if (next !== node.nodeValue) node.nodeValue = next; } });
}).observe(document.body, { childList: true, subtree: true });

function setLanguage(lang) {
  const before = document.documentElement.lang;
  document.documentElement.lang = lang;
  save("kerkida-lang", lang);
  if (before === "en" && lang === "el") location.reload();
  else translateTree(document.body);
}

const PLACES = [["Πάτρα", 38.2466, 21.7346], ["Αίγιο", 38.2505, 22.0852], ["Αθήνα", 37.9838, 23.7275], ["Πειραιάς", 37.9429, 23.6469], ["Θεσσαλονίκη", 40.6401, 22.9444], ["Ηράκλειο", 35.3387, 25.1442], ["Λάρισα", 39.639, 22.4191], ["Βόλος", 39.3622, 22.942], ["Ιωάννινα", 39.665, 20.8537], ["Τρίπολη", 37.5089, 22.3794], ["Καλαμάτα", 37.0389, 22.1142], ["Αγρίνιο", 38.6214, 21.4078], ["Χανιά", 35.5138, 24.018], ["Ρόδος", 36.4341, 28.2176], ["Ξάνθη", 41.1349, 24.888], ["Λιβαδειά", 38.4361, 22.875]];
const RADII = [10, 25, 50, 100, 200, 500];
const NEARBY_LEAGUES = ["gre.1", "grl.4640", "grl.5830", "uefa.champions", "uefa.europa", "uefa.europa.conf", "euroleague", "eurocup", "gbl", "elite", "volley-men", "volley-women"];
let nearbyGames = null;

async function loadNearby(onProgress) {
  if (nearbyGames) return nearbyGames;
  const leagues = [...new Set([...NEARBY_LEAGUES.map(api.leagueById), ...api.LEAGUES.filter((l) => l.file === "lower" && api.isFollowed(l))])];
  const found = new Map();
  const days = Array.from({ length: 8 }, (_, i) => api.addDays(today(), i));
  for (let i = 0; i < days.length; i++) {
    for (const game of await api.loadDay(leagues, days[i])) found.set(game.id, game);
    onProgress?.((i + 1) / days.length, [...found.values()]);
  }
  nearbyGames = [...found.values()];
  return nearbyGames;
}

function destroyMap() {
  activeMap?.remove();
  activeMap = null;
}

async function viewNearby() {
  const token = ++renderToken;
  destroyMap();
  const place = state.place;
  view.innerHTML = `<header class="pagehead"><h1>Αγώνες κοντά μου</h1></header>
  <div class="strip chips"><button class="chip ${place?.name === "Η περιοχή μου" ? "on" : ""}" data-locate>${icon("Pin", 16)}Η περιοχή μου</button>${PLACES.map(([name]) => `<button class="chip ${place?.name === name ? "on" : ""}" data-place="${esc(name)}">${esc(name)}</button>`).join("")}</div>
  <div class="strip chips">${RADII.map((km) => `<button class="chip ${state.radius === km ? "on" : ""}" data-radius="${km}">${km} km</button>`).join("")}</div>
  <div id="nearbybar"></div><div id="nearbybody"></div>`;
  view.querySelector("[data-place].on")?.scrollIntoView({ inline: "center", block: "nearest" });
  const body = document.getElementById("nearbybody");
  if (!place) {
    body.innerHTML = message("Βρες αγώνες κοντά σου", "Διάλεξε πόλη ή χρησιμοποίησε την τοποθεσία σου. Η Kerkida δεν τη στέλνει σε δικό της server. Ο χάρτης φορτώνει εικόνες της περιοχής από το OpenFreeMap.", "Pin");
    return;
  }
  const find = await api.groundFinder();
  const results = (games) => games
    .filter((g) => g.status === "SCHEDULED" || g.status === "LIVE")
    .map((match) => {
      const ground = find(match);
      return ground ? { match, ground, km: distanceKm(place.lat, place.lng, ground.lat, ground.lng) } : null;
    }).filter((r) => r && r.km <= state.radius).sort((a, b) => a.match.kickoff - b.match.kickoff);
  const paint = (games) => {
    if (token !== renderToken) return;
    const found = results(games);
    const switcher = `<div class="segment"><button class="${state.nearbyMode === "list" ? "on" : ""}" data-mode="list">Λίστα</button><button class="${state.nearbyMode === "map" ? "on" : ""}" data-mode="map">Χάρτης</button></div>`;
    if (state.nearbyMode === "map") {
      if (!document.getElementById("map")) {
        body.innerHTML = `${switcher}<div class="mapbox"><div id="map"></div><a class="credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenFreeMap · © OpenMapTiles · © OpenStreetMap</a><div id="groundcard"></div></div>`;
        fitMap();
      }
      updateMap(place, found);
    } else {
      destroyMap();
      const days = new Map();
      for (const r of found) {
        const key = new Date(r.match.kickoff).toDateString();
        if (!days.has(key)) days.set(key, []);
        days.get(key).push(r);
      }
      body.innerHTML = switcher + (found.length ? [...days.values()].map((list) => `<h2 class="section">${esc(longDay(list[0].match.kickoff))}</h2>${list.map((r) => `<section class="card">${matchRow(r.match)}<p class="groundline">${icon("Pin", 15)} ${esc(r.ground.name)} · ${esc(r.match.league.name)}<b>${Math.max(1, Math.round(r.km))} χλμ</b></p></section>`).join("")}`).join("") : message("Δεν υπάρχουν αγώνες κοντά", "Δοκίμασε μεγαλύτερη απόσταση.", "Pin"));
    }
    body.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
      if (state.nearbyMode === button.dataset.mode) return;
      state.nearbyMode = button.dataset.mode;
      destroyMap();
      body.innerHTML = "";
      paint(nearbyGames || games);
    }));
  };
  const bar = document.getElementById("nearbybar");
  if (!nearbyGames) bar.innerHTML = scarfBar(null);
  const games = await loadNearby((_, partial) => paint(partial));
  if (token !== renderToken) return;
  bar.innerHTML = "";
  paint(games);
}

/** On phones the map ends right above the bottom menu, whatever the browser's bars are doing. */
function fitMap() {
  const box = document.querySelector(".mapbox");
  if (!box) return;
  if (matchMedia("(max-width:760px)").matches) {
    const menuTop = document.querySelector(".mainnav").getBoundingClientRect().top;
    box.style.height = `${Math.max(300, Math.round(menuTop - (box.getBoundingClientRect().top + scrollY) - 8))}px`;
  } else {
    box.style.height = "";
  }
  activeMap?.resize();
}

addEventListener("resize", fitMap);

function loadMapLibrary() {
  if (window.maplibregl) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/maplibre-gl.css";
    document.head.append(css);
    const script = document.createElement("script");
    script.src = "vendor/maplibre-gl.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

const pinsJson = (pins) => ({ type: "FeatureCollection", features: pins.map((pin) => ({ type: "Feature", geometry: { type: "Point", coordinates: [pin.lng, pin.lat] }, properties: { key: pin.key, games: pin.games.length } })) });

async function updateMap(place, found) {
  const pins = groupByGround(found);
  const ring = radiusRing(place.lat, place.lng, state.radius);
  if (activeMap) {
    activeMap.__pins = pins;
    if (activeMap.isStyleLoaded() && activeMap.getSource("grounds")) activeMap.getSource("grounds").setData(pinsJson(pins));
    return;
  }
  const container = document.getElementById("map");
  if (container.dataset.starting) { container.__pins = pins; return; }
  container.dataset.starting = "1";
  try { await loadMapLibrary(); } catch {
    container.innerHTML = message("Ο χάρτης δεν φορτώθηκε", "Έλεγξε τη σύνδεσή σου.", "Pin");
    return;
  }
  if (!document.body.contains(container)) return;
  const fit = ring.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(ring[0], ring[0]));
  const dark = document.documentElement.dataset.theme === "dark";
  const map = new maplibregl.Map({
    container,
    style: `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`,
    bounds: fit,
    fitBoundsOptions: { padding: 34 },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  activeMap = map;
  map.__pins = container.__pins || pins;
  map.on("load", () => {
    const cluster = ["has", "point_count"];
    map.addSource("radius", { type: "geojson", data: { type: "Polygon", coordinates: [ring] } });
    map.addSource("place", { type: "geojson", data: { type: "Point", coordinates: [place.lng, place.lat] } });
    map.addSource("grounds", { type: "geojson", data: pinsJson(map.__pins), cluster: true, clusterRadius: 44, clusterMaxZoom: 13, clusterProperties: { games: ["+", ["get", "games"]] } });
    map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#00B37A", "fill-opacity": 0.07 } });
    map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": "#00B37A", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "place", type: "circle", source: "place", paint: { "circle-radius": 6, "circle-color": "#F2B134", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "clusters", type: "circle", source: "grounds", filter: cluster, paint: { "circle-radius": 19, "circle-color": "#0B1F4B", "circle-stroke-color": "#00B37A", "circle-stroke-width": 2.5 } });
    map.addLayer({ id: "pins", type: "circle", source: "grounds", filter: ["!", cluster], paint: { "circle-radius": 15, "circle-color": "#00B37A", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({ id: "counts", type: "symbol", source: "grounds", layout: { "text-field": ["to-string", ["get", "games"]], "text-font": ["Noto Sans Regular"], "text-size": 13, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": ["case", cluster, "#FFFFFF", "#0B1F4B"] } });
    map.on("click", "clusters", async (event) => {
      const feature = event.features[0];
      const zoom = await map.getSource("grounds").getClusterExpansionZoom(feature.properties.cluster_id);
      map.easeTo({ center: feature.geometry.coordinates, zoom: zoom + 0.3 });
    });
    map.on("click", "pins", (event) => {
      const feature = event.features[0];
      const pin = map.__pins.find((p) => p.key === feature.properties.key);
      if (!pin) return;
      map.easeTo({ center: feature.geometry.coordinates });
      const km = Math.max(1, Math.round(distanceKm(place.lat, place.lng, pin.lat, pin.lng)));
      document.getElementById("groundcard").innerHTML = `<section class="card ground"><header>${icon("Pin", 20)}<span><b>${esc(pin.name)}</b><small>${km} χλμ</small></span><button class="iconbtn" data-close-card aria-label="Κλείσιμο">${icon("Close", 20)}</button></header><div class="groundgames">${pin.games.map((game) => `<p class="rowdate">${esc(dayLabel(game.kickoff))} · ${esc(game.league.name)}</p>${matchRow(game)}`).join("")}</div></section>`;
    });
    for (const layer of ["clusters", "pins"]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }
  });
}

function setActiveNav(path) {
  const root = path === "" ? "matches" : path;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const on = link.dataset.nav === root || (root === "match" && link.dataset.nav === "matches") || (["league", "team"].includes(root) && link.dataset.nav === "leagues");
    link.classList.toggle("on", on);
    if (on) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
}

function route(animate) {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const [page = "", a, b] = parts;
  if (page !== "nearby") destroyMap();
  setActiveNav(page);
  if (!animate) scrollTo(0, 0);
  if (page === "match" && a && b) return viewMatch(a, b);
  if (page === "tv") return viewTv();
  if (page === "leagues") return viewLeagues();
  if (page === "league" && a) return viewLeague(a);
  if (page === "team" && a && b) return viewTeam(a, b);
  if (page === "search") return viewSearch();
  if (page === "favourites") return viewFavourites();
  if (page === "season") return viewSeason();
  if (page === "weekend") return viewWeekend();
  if (page === "fantasy") return viewFantasy();
  if (page === "settings") return viewSettings();
  if (page === "picker") return viewPicker();
  if (page === "nearby") return viewNearby();
  return viewMatches(animate);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  const d = target.dataset;
  if (d.date) { state.date = new Date(Number(d.date)); viewMatches(); }
  else if (d.sport && d.sport !== state.sport) { state.sport = d.sport; viewMatches(d.sport); }
  else if (d.filter) { state.filter = state.filter === d.filter ? "all" : d.filter; document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("on", b.dataset.filter === state.filter)); paintDay(1, 1); }
  else if (d.hide && !target.classList.contains("heroeye")) { toggleHidden(d.hide); if (document.getElementById("daylist")) paintDay(1, 1); else route(true); }
  else if (d.favLeague) {
    state.favLeagues = state.favLeagues.includes(d.favLeague) ? state.favLeagues.filter((id) => id !== d.favLeague) : [...state.favLeagues, d.favLeague];
    save("kerkida-fav-leagues", state.favLeagues);
    if (document.getElementById("daylist")) paintDay(1, 1); else route(true);
  } else if (d.favTeam) {
    state.favTeams = isFavTeam(d.favTeam) ? state.favTeams.filter((team) => team.id !== d.favTeam) : [...state.favTeams, { id: d.favTeam, name: d.teamName, league: d.teamLeague, logo: d.teamLogo || null }];
    save("kerkida-fav-teams", state.favTeams);
    route(true);
  } else if (d.channel) {
    if (state.mine.has(d.channel)) state.mine.delete(d.channel); else state.mine.add(d.channel);
    save("kerkida-channels", [...state.mine]);
    viewSettings();
  } else if (d.themeSet) { setTheme(d.themeSet); viewSettings(); }
  else if (d.place) {
    const [name, lat, lng] = PLACES.find(([n]) => n === d.place);
    state.place = { name, lat, lng };
    save("kerkida-place", state.place);
    viewNearby();
  } else if (d.radius) { state.radius = Number(d.radius); save("kerkida-radius", state.radius); viewNearby(); }
  else if ("locate" in d) {
    navigator.geolocation?.getCurrentPosition((position) => {
      state.place = { name: "Η περιοχή μου", lat: position.coords.latitude, lng: position.coords.longitude };
      viewNearby();
    }, () => {
      document.getElementById("nearbybar").innerHTML = `<p class="notice">Η τοποθεσία δεν ήταν διαθέσιμη. Διάλεξε μια πόλη.</p>`;
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  } else if ("closeRate" in d) { document.getElementById("ratedetail").innerHTML = "";
  } else if ("closeCard" in d) { document.getElementById("groundcard").innerHTML = ""; }
  else if ("back" in d) { if (history.length > 1) history.back(); else location.hash = "#/"; }
});

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  save("kerkida-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0B1F4B");
}

addEventListener("hashchange", () => route(false));
document.documentElement.dataset.theme = load("kerkida-theme", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
document.querySelectorAll("[data-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.icon, 22); });
document.documentElement.lang = load("kerkida-lang", "el");
translateTree(document.body);
api.loadCatalog().then(() => { if (!location.hash || location.hash === "#/") viewMatches(); });
startAlerts();
playIntro();
route(false);
