import * as api from "./api.js";
import { ICONS } from "./icons.js";
import { playIntro } from "./intro.js";
import {
  channelsFor, distanceKm, groupByGround, isPaid, matchesQuery, networkOf, pitchLines, radiusRing, videosFor,
} from "./logic.js";

const view = document.getElementById("view");
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const esc = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name, size = 22) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${(ICONS[name] || []).map((d) => `<path d="${d}"/>`).join("")}</svg>`;
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can refuse storage. */ } };
const time = (ms) => new Date(ms).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (ms) => new Date(ms).toLocaleDateString("el-GR", { weekday: "short", day: "numeric", month: "numeric" });
const longDay = (ms) => new Date(ms).toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long" });
const initial = (name = "") => (name.match(/[\p{L}\p{N}]/u)?.[0] || "").toUpperCase();
/** The club's crest from the score source, with its initial underneath if the image is unavailable. */
const crest = (team, extra = "") => `<i class="badge ${extra}">${esc(initial(team.name))}${team.logo ? `<img src="${esc(team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</i>`;

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
};
let renderToken = 0;
let activeMap = null;
let listings = [];

api.tvGuide().then((data) => { listings = data.items || []; });

const isHidden = (match) => state.hidden.has(match.id);
const isFavTeam = (id) => state.favTeams.some((team) => team.id === id);

function toggleHidden(id) {
  if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
  save("kerkida-hidden", [...state.hidden].slice(-300));
}

function scarfBar(progress) {
  if (progress === null) return `<div class="scarfbar" role="progressbar" aria-label="Φόρτωση"><span class="scarf green travel"></span><span class="scarf white travel second"></span></div>`;
  return `<div class="scarfbar" role="progressbar" aria-valuenow="${Math.round(progress * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Φόρτωση"><span class="scarf green fill" style="width:calc((100% - 24px) * ${progress})"></span></div>`;
}

const message = (title, body = "", iconName = "Info") => `<div class="message">${icon(iconName, 36)}<h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;

function scoreCell(match) {
  const hidden = isHidden(match);
  if (match.status === "SCHEDULED") return `<b class="score">${time(match.kickoff)}</b><small>Έναρξη</small>`;
  if (match.status === "POSTPONED") return `<b class="score">–</b><small>Αναβολή</small>`;
  if (match.status === "CANCELLED") return `<b class="score">–</b><small>Ακύρωση</small>`;
  if (hidden) return `<b class="score">? – ?</b><small>Κρυφό</small>`;
  const live = match.status === "LIVE";
  const main = match.homeScore === null ? (live ? "Live" : "Τέλος") : `${match.homeScore} – ${match.awayScore}`;
  return `<b class="score ${live ? "live" : ""}">${esc(main)}</b><small class="${live ? "livetext" : ""}">${live ? esc(match.clock || "Ζωντανά") : "Τελικό"}</small>`;
}

function channelLine(match) {
  const channels = channelsFor(match, listings);
  if (!channels.length) return "";
  const best = [...channels].sort((a, b) => Number(state.mine.has(networkOf(b))) - Number(state.mine.has(networkOf(a))))[0];
  const tag = state.mine.has(networkOf(best)) ? "το έχεις" : isPaid(best) ? "Συνδρομητικό" : "Ελεύθερο";
  return `<div class="channel">${icon("Tv", 15)} ${esc(best)} · ${tag}</div>`;
}

function matchRow(match) {
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
    const canOpen = known?.kind === "team";
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
    const label = diff === 0 ? "Σήμερα" : diff === -1 ? "Χθες" : diff === 1 ? "Αύριο" : date.toLocaleDateString("el-GR", { weekday: "short" });
    const on = date.getTime() === state.date.getTime();
    return `<button class="day ${on ? "on" : ""}" data-date="${date.getTime()}" ${on ? 'aria-current="date"' : ""}><span>${esc(label)}</span><b>${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}</b></button>`;
  }).join("")}</nav>`;
}

const sportStrip = (animate) => `<nav class="strip sports" aria-label="Άθλημα">${api.SPORTS.map((sport) => `<button class="sport ${sport.id === state.sport ? "on" : ""} ${animate === sport.id ? `play-${sport.motion}` : ""}" data-sport="${sport.id}">${icon(sport.icon, 22)}<span>${esc(sport.label)}</span></button>`).join("")}</nav>`;

const FILTERS = [["all", "Όλα"], ["live", "Ζωντανά"], ["fav", "Αγαπημένα"], ["tv", "Αγώνες στην TV"]];
const filterRow = () => `<div class="strip chips">${FILTERS.map(([id, label]) => `<button class="chip ${state.filter === id ? "on" : ""}" data-filter="${id}">${id === "tv" ? icon("Tv", 16) : ""}${label}</button>`).join("")}</div>`;

function applyFilter(matches) {
  if (state.filter === "live") return matches.filter((m) => m.status === "LIVE");
  if (state.filter === "fav") return matches.filter((m) => state.favLeagues.includes(m.league.id) || isFavTeam(m.home.id) || isFavTeam(m.away.id));
  if (state.filter === "tv") return matches.filter((m) => channelsFor(m, listings).length);
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
  const leagues = api.LEAGUES.filter((league) => league.sport === state.sport);
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

function pitchHtml(name, lineup, flip) {
  const lines = pitchLines(lineup.players, lineup.formation);
  const ordered = flip ? [...lines].reverse() : lines;
  return `<div class="pitchteam"><div class="pitchname"><b>${esc(name)}</b><span>${esc(lineup.formation || "")}</span></div><div class="pitch">${ordered.map((line) => `<div class="pline">${line.map((p) => `<div class="pdot"><i>${esc(p.jersey)}</i><span>${esc(p.name.trim().split(" ").pop())}</span></div>`).join("")}</div>`).join("")}</div></div>`;
}

function lineupsHtml(data) {
  if (!data.home && !data.away) return message("Δεν υπάρχουν ενδεκάδες", "Ανακοινώνονται λίγο πριν τον αγώνα.", "Info");
  const bench = (lineup) => lineup ? lineup.players.filter((p) => !p.starter).map((p) => `<li><i>${esc(p.jersey)}</i>${esc(p.name)}</li>`).join("") : "";
  return `<div class="pitches">${data.home ? pitchHtml(data.match.home.name, data.home, false) : ""}${data.away ? pitchHtml(data.match.away.name, data.away, true) : ""}</div>
  <div class="benches"><section class="card"><h3>Πάγκος · ${esc(data.match.home.name)}</h3><ul>${bench(data.home)}</ul></section><section class="card"><h3>Πάγκος · ${esc(data.match.away.name)}</h3><ul>${bench(data.away)}</ul></section></div>`;
}

function tableHtml(groups, highlight = []) {
  if (!groups.length) return message("Δεν υπάρχει βαθμολογία", "Η πηγή δεν δίνει βαθμολογία για αυτή τη διοργάνωση.", "Leagues");
  return groups.map((group) => {
    const hasPoints = group.rows.some((row) => row.points !== null);
    const leagueId = group.leagueId;
    return `<section class="card table"><h3>${esc(group.name)}</h3><div class="tablewrap"><table><thead><tr><th>#</th><th class="left">Ομάδα</th><th>Αγ</th><th>Ν</th><th>Ι</th><th>Η</th><th>Δ</th>${hasPoints ? "<th>Β</th>" : ""}</tr></thead><tbody>${group.rows.map((row) => `<tr class="${highlight.includes(row.team.id) ? "hl" : ""}"><td>${row.rank}</td><td class="left">${leagueId ? `<a class="tableteam" href="#/team/${encodeURIComponent(leagueId)}/${encodeURIComponent(row.team.id)}">${crest(row.team, "small")}${esc(row.team.name)}</a>` : esc(row.team.name)}</td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.diff > 0 ? "+" : ""}${row.diff}</td>${hasPoints ? `<td><b>${row.points}</b></td>` : ""}</tr>`).join("")}</tbody></table></div></section>`;
  }).join("");
}

const videoCard = (video, match) => {
  const hide = match && isHidden(match);
  const title = hide ? `${match.home.name} – ${match.away.name} · Highlights` : video.title;
  return `<a class="video" href="https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}" target="_blank" rel="noopener"><span class="play">▶</span><span><b>${esc(title)}</b><small>${esc(video.channel)} · ${dayLabel(video.publishedMs)}</small></span></a>`;
};

async function viewMatch(leagueId, eventId, wanted) {
  const token = ++renderToken;
  view.innerHTML = pageHead(api.leagueById(leagueId)?.name || "Αγώνας") + scarfBar(null);
  let data;
  try {
    data = await api.matchDetails(leagueId, eventId);
  } catch {
    if (token === renderToken) view.innerHTML = pageHead("Αγώνας") + message("Ο αγώνας δεν φορτώθηκε", "Δοκίμασε ξανά σε λίγο.");
    return;
  }
  const [guide, videoFile, tableGroups] = await Promise.all([api.tvGuide(), api.highlights(), api.standings(leagueId).catch(() => [])]);
  if (token !== renderToken) return;
  listings = guide.items || [];
  const match = data.match;
  const videos = match.status === "FINISHED" ? videosFor(match, videoFile.videos || []) : [];
  const channels = channelsFor(match, listings);
  const available = [["events", "Φάσεις"], ...(videos.length ? [["highlights", "Highlights"]] : []), ["lineups", "Παίκτες"], ["table", "Βαθμολογία"], ["info", "Στοιχεία"]];
  let tab = available.some(([id]) => id === wanted) ? wanted : "events";
  const hiddenNotice = message("Ο αγώνας είναι κρυφός", "Πάτα το μάτι για να δεις σκορ, φάσεις και βαθμούς.", "EyeOff");
  const paint = () => {
    const hidden = isHidden(match);
    const content = {
      events: () => (hidden ? hiddenNotice : eventsHtml(data)),
      highlights: () => `<div class="videos">${videos.map((v) => videoCard(v, match)).join("")}</div>`,
      lineups: () => (hidden ? hiddenNotice : lineupsHtml(data)),
      table: () => tableHtml(tableGroups.map((g) => ({ ...g, leagueId })), [match.home.id, match.away.id]),
      info: () => `<section class="card info"><dl><dt>Ημερομηνία</dt><dd>${esc(longDay(match.kickoff))}, ${time(match.kickoff)}</dd><dt>Διοργάνωση</dt><dd>${esc(match.league.name)}</dd>${match.venue ? `<dt>Γήπεδο</dt><dd>${esc(match.venue)}</dd>` : ""}<dt>Μετάδοση</dt><dd>${channels.length ? esc(channels.join(", ")) : "Δεν υπάρχει γνωστό κανάλι"}</dd></dl></section>`,
    }[tab]();
    view.innerHTML = `${pageHead(match.league.name)}<section class="hero">
      <a class="heroteam" href="#/team/${encodeURIComponent(leagueId)}/${encodeURIComponent(match.home.id)}">${crest(match.home, "big")}<b>${esc(match.home.name)}</b></a>
      <div class="heroscore">${scoreCell(match)}<small>${esc(dayLabel(match.kickoff))} · ${time(match.kickoff)}</small></div>
      <a class="heroteam" href="#/team/${encodeURIComponent(leagueId)}/${encodeURIComponent(match.away.id)}">${crest(match.away, "big")}<b>${esc(match.away.name)}</b></a>
      ${match.status !== "SCHEDULED" ? `<button class="iconbtn heroeye" data-hide="${esc(match.id)}" aria-pressed="${hidden}" aria-label="${hidden ? "Εμφάνιση αγώνα" : "Απόκρυψη αγώνα"}">${icon(hidden ? "EyeOff" : "Eye")}</button>` : ""}
    </section>${tabs(available, tab)}<div class="tabbody">${content}</div>`;
    view.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { tab = button.dataset.tab; paint(); }));
    view.querySelector(".heroeye")?.addEventListener("click", (event) => { event.stopPropagation(); toggleHidden(match.id); paint(); });
  };
  paint();
}

async function viewTv() {
  const token = ++renderToken;
  view.innerHTML = `<header class="pagehead"><h1>Τι παίζει στην TV</h1></header>${tabs([["guide", "Πρόγραμμα"], ["highlights", "Highlights"]], state.tvTab)}<div id="tvbody">${scarfBar(null)}</div>`;
  view.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.tvTab = button.dataset.tab; viewTv(); }));
  const [guide, videoFile] = await Promise.all([api.tvGuide(), api.highlights()]);
  if (token !== renderToken) return;
  const box = document.getElementById("tvbody");
  if (state.tvTab === "highlights") {
    const videos = videoFile.videos || [];
    box.innerHTML = videos.length ? `<div class="videos">${videos.slice(0, 80).map((v) => videoCard(v)).join("")}</div>` : message("Δεν υπάρχουν ακόμα highlights", "Ανανεώνονται αυτόματα από τα επίσημα κανάλια.", "Tv");
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
    const shown = items.filter((item) => item.date === state.tvDay && (!q || matchesQuery(`${item.title} ${item.competition} ${item.channel}`, q) || `${item.title} ${item.competition} ${item.channel}`.toLowerCase().includes(q.toLowerCase())));
    document.getElementById("tvlist").innerHTML = shown.length ? `<section class="card">${shown.map((item) => {
      const liveNow = Date.now() >= item.startMs && Date.now() < item.endMs;
      return `<div class="tvrow"><b class="tvtime ${liveNow ? "live" : ""}">${esc(item.time)}</b><div><b>${esc(item.title)}</b><small>${esc(item.competition)}</small><small class="channel">${icon("Tv", 14)} ${esc(item.channel)} · ${isPaid(item.channel) ? "Συνδρομητικό" : "Ελεύθερο"}</small></div></div>`;
    }).join("")}</section>` : message("Δεν βρέθηκαν μεταδόσεις", "Δοκίμασε άλλη ημέρα ή αναζήτηση.", "Tv");
  };
  box.innerHTML = days.length ? `<nav class="strip dates">${days.map((day) => {
    const date = new Date(`${day}T12:00:00`);
    return `<button class="day ${day === state.tvDay ? "on" : ""}" data-tvday="${day}"><span>${day === todayKey ? "Σήμερα" : esc(date.toLocaleDateString("el-GR", { weekday: "short" }))}</span><b>${day.slice(8)}/${day.slice(5, 7)}</b></button>`;
  }).join("")}</nav><label class="search">${icon("Search", 20)}<input id="tvsearch" value="${esc(state.tvQuery)}" placeholder="Ομάδα, διοργάνωση ή κανάλι" aria-label="Αναζήτηση στο πρόγραμμα"></label><div id="tvlist"></div>${guide.updated ? `<p class="fresh">Ενημέρωση: ${esc(new Date(guide.updated).toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" }))}</p>` : ""}` : message("Το πρόγραμμα δεν είναι διαθέσιμο", "Θα εμφανιστεί με την επόμενη αυτόματη ενημέρωση.", "Tv");
  if (!days.length) return;
  box.querySelectorAll("[data-tvday]").forEach((button) => button.addEventListener("click", () => {
    state.tvDay = button.dataset.tvday;
    box.querySelectorAll("[data-tvday]").forEach((b) => b.classList.toggle("on", b === button));
    paint();
  }));
  document.getElementById("tvsearch").addEventListener("input", (event) => { state.tvQuery = event.target.value; paint(); });
  paint();
}

function viewLeagues() {
  ++renderToken;
  const open = api.LEAGUES.filter((league) => league.kind === "team");
  const groups = [...new Set(open.map((l) => l.sport))];
  view.innerHTML = `<header class="pagehead"><h1>Λίγκες</h1></header>${groups.map((sport) => `<h2 class="section">${esc(api.SPORTS.find((s) => s.id === sport).label)}</h2><section class="card">${open.filter((l) => l.sport === sport).map((league) => `<div class="listrow"><a href="#/league/${encodeURIComponent(league.id)}"><i class="badge square">${esc(initial(league.name))}</i><span><b>${esc(league.name)}</b><small>${esc(league.country || "")}</small></span></a><button class="iconbtn ${state.favLeagues.includes(league.id) ? "on" : ""}" data-fav-league="${esc(league.id)}" aria-label="Αγαπημένη λίγκα">${icon("Star", 20)}</button></div>`).join("")}</section>`).join("")}`;
}

async function viewLeague(id) {
  const token = ++renderToken;
  const league = api.leagueById(id);
  if (!league) { view.innerHTML = message("Δεν βρέθηκε η λίγκα"); return; }
  view.innerHTML = pageHead(league.name) + scarfBar(null);
  const groups = await api.standings(id).catch(() => []);
  if (token !== renderToken) return;
  view.innerHTML = pageHead(league.name) + `<div class="tabbody">${tableHtml(groups.map((g) => ({ ...g, leagueId: id })))}</div>`;
}

async function viewTeam(leagueId, teamId) {
  const token = ++renderToken;
  view.innerHTML = pageHead("Ομάδα") + scarfBar(null);
  let team;
  try {
    team = await api.teamSchedule(leagueId, teamId);
  } catch {
    if (token === renderToken) view.innerHTML = pageHead("Ομάδα") + message("Η ομάδα δεν φορτώθηκε", "Δοκίμασε ξανά σε λίγο.");
    return;
  }
  if (token !== renderToken) return;
  const coming = team.games.filter((g) => g.status === "SCHEDULED" || g.status === "LIVE").slice(0, 12);
  const played = team.games.filter((g) => g.status === "FINISHED").slice(-12).reverse();
  const fav = isFavTeam(teamId);
  const section = (title, games) => games.length ? `<h2 class="section">${title}</h2><section class="card">${games.map((game) => `<p class="rowdate">${esc(dayLabel(game.kickoff))}</p>${matchRow(game)}`).join("")}</section>` : "";
  view.innerHTML = `${pageHead(team.name)}<section class="hero single">${crest(team, "big")}<b>${esc(team.name)}</b><small>${esc(api.leagueById(leagueId)?.name || "")}</small><button class="favbtn ${fav ? "on" : ""}" data-fav-team="${esc(teamId)}" data-team-name="${esc(team.name)}" data-team-league="${esc(leagueId)}" data-team-logo="${esc(team.logo || "")}">${icon("Star", 18)} ${fav ? "Στα αγαπημένα" : "Προσθήκη στα αγαπημένα"}</button></section>${section("Επόμενοι αγώνες", coming)}${section("Τελευταίοι αγώνες", played)}${!coming.length && !played.length ? message("Δεν υπάρχουν αγώνες") : ""}`;
}

let teamIndex = null;

async function buildTeamIndex() {
  if (teamIndex) return teamIndex;
  const leagues = api.LEAGUES.filter((league) => league.kind === "team");
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
      const foundLeagues = api.LEAGUES.filter((league) => league.kind === "team" && matchesQuery(league.name, q));
      box.innerHTML = foundTeams.length || foundLeagues.length ? `${foundTeams.length ? `<h2 class="section">Ομάδες</h2><section class="card">${foundTeams.map((team) => `<div class="listrow"><a href="#/team/${encodeURIComponent(team.leagueId)}/${encodeURIComponent(team.id)}">${crest(team)}<span><b>${esc(team.name)}</b><small>${esc(team.league)}</small></span></a></div>`).join("")}</section>` : ""}${foundLeagues.length ? `<h2 class="section">Λίγκες</h2><section class="card">${foundLeagues.map((league) => `<div class="listrow"><a href="#/league/${encodeURIComponent(league.id)}"><i class="badge square">${esc(initial(league.name))}</i><span><b>${esc(league.name)}</b><small>${esc(league.country || "")}</small></span></a></div>`).join("")}</section>` : ""}` : message("Δεν βρέθηκε κάτι", "Δοκίμασε άλλη γραφή.", "Search");
    }, 250);
  });
}

const CHANNEL_OPTIONS = [["nova", "Nova"], ["magenta", "Magenta"], ["eurosport", "Eurosport"], ["dazn", "DAZN"], ["ant1plus", "ΑΝΤ1+"]];

function viewFavourites() {
  ++renderToken;
  const leagues = state.favLeagues.map(api.leagueById).filter(Boolean);
  const theme = document.documentElement.dataset.theme;
  view.innerHTML = `<header class="pagehead"><h1>Αγαπημένα</h1></header>
  ${state.favTeams.length ? `<h2 class="section">Ομάδες</h2><section class="card">${state.favTeams.map((team) => `<div class="listrow"><a href="#/team/${encodeURIComponent(team.league)}/${encodeURIComponent(team.id)}">${crest(team)}<span><b>${esc(team.name)}</b><small>${esc(api.leagueById(team.league)?.name || "")}</small></span></a><button class="iconbtn on" data-fav-team="${esc(team.id)}" data-team-name="${esc(team.name)}" data-team-league="${esc(team.league)}" aria-label="Αφαίρεση">${icon("Star", 20)}</button></div>`).join("")}</section>` : ""}
  ${leagues.length ? `<h2 class="section">Λίγκες</h2><section class="card">${leagues.map((league) => `<div class="listrow"><a href="#/league/${encodeURIComponent(league.id)}"><i class="badge square">${esc(initial(league.name))}</i><span><b>${esc(league.name)}</b><small>${esc(league.country || "")}</small></span></a><button class="iconbtn on" data-fav-league="${esc(league.id)}" aria-label="Αφαίρεση">${icon("Star", 20)}</button></div>`).join("")}</section>` : ""}
  ${!state.favTeams.length && !leagues.length ? message("Δεν έχεις αγαπημένα ακόμα", "Πάτα το αστέρι σε μια ομάδα ή λίγκα.", "Star") : ""}
  <h2 class="section">Τα κανάλια μου</h2><div class="strip chips wrap">${CHANNEL_OPTIONS.map(([id, label]) => `<button class="chip ${state.mine.has(id) ? "on" : ""}" data-channel="${id}">${esc(label)}</button>`).join("")}</div>
  <h2 class="section">Εμφάνιση</h2><div class="strip chips wrap"><button class="chip ${theme === "dark" ? "on" : ""}" data-theme-set="dark">Σκούρο</button><button class="chip ${theme === "light" ? "on" : ""}" data-theme-set="light">Φωτεινό</button></div>
  <p class="fresh">Όλα αυτά μένουν μόνο σε αυτόν τον browser.</p>`;
}

const PLACES = [["Πάτρα", 38.2466, 21.7346], ["Αίγιο", 38.2505, 22.0852], ["Αθήνα", 37.9838, 23.7275], ["Πειραιάς", 37.9429, 23.6469], ["Θεσσαλονίκη", 40.6401, 22.9444], ["Ηράκλειο", 35.3387, 25.1442], ["Λάρισα", 39.639, 22.4191], ["Βόλος", 39.3622, 22.942], ["Ιωάννινα", 39.665, 20.8537], ["Τρίπολη", 37.5089, 22.3794], ["Καλαμάτα", 37.0389, 22.1142], ["Αγρίνιο", 38.6214, 21.4078], ["Χανιά", 35.5138, 24.018], ["Ρόδος", 36.4341, 28.2176], ["Ξάνθη", 41.1349, 24.888], ["Λιβαδειά", 38.4361, 22.875]];
const RADII = [10, 25, 50, 100, 200, 500];
const NEARBY_LEAGUES = ["gre.1", "uefa.champions", "uefa.europa", "uefa.europa.conf", "euroleague", "eurocup"];
let nearbyGames = null;

async function loadNearby(onProgress) {
  if (nearbyGames) return nearbyGames;
  const leagues = NEARBY_LEAGUES.map(api.leagueById);
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
    viewFavourites();
  } else if (d.themeSet) { setTheme(d.themeSet); viewFavourites(); }
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
playIntro();
route(false);
