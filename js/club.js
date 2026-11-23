/** Club, ground and town details from Wikidata and Wikipedia. A wrong club is worse than none. */
import { plain } from "./logic.js";

const WIKIDATA = "https://www.wikidata.org/w/api.php?format=json&origin=*";
const FOOTBALL = new Set(["Q476028", "Q103229495", "Q15944511"]);
const BASKETBALL = new Set(["Q13393265"]);
const VOLLEYBALL = new Set(["Q18558301", "Q1194951"]);
const ANY_CLUB = new Set(["Q847017", "Q12973014", "Q4438121"]);
const SPORT_ITEM = { FOOTBALL: "Q2736", BASKETBALL: "Q5372", VOLLEYBALL: "Q1734" };
const GENERIC = new Set(["club", "team", "athens", "crete", "city", "patras", "thessaloniki", "piraeus", "women", "men", "bc", "fc", "vc", "ac", "as", "gs", "ae", "ao", "ne", "bk", "cf", "sc"]);
const HONOURS = /^(τίτλοι|τιμές|τιμητικές διακρίσεις|διακρίσεις|επιτυχίες|τρόπαια|honours|honors|achievements|titles)/i;
const memory = new Map();

const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
const snaks = (entity, property) => (entity.claims?.[property] || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
const itemIds = (entity, property) => snaks(entity, property).map((v) => v.id).filter(Boolean);
const yearOf = (entity, property) => { const t = snaks(entity, property)[0]?.time; return t ? Number(t.slice(1, 5)) : null; };
const label = (entity) => entity.labels?.el?.value || entity.labels?.en?.value || null;
const nameKey = (text) => plain(text).replace(/[^a-z0-9α-ω ]/g, " ").replace(/\s+/g, " ").trim();

function fits(entity, teamName, sport, greek) {
  const kinds = new Set(itemIds(entity, "P31"));
  const wanted = sport === "BASKETBALL" ? BASKETBALL : sport === "VOLLEYBALL" ? VOLLEYBALL : FOOTBALL;
  const played = itemIds(entity, "P641");
  const item = SPORT_ITEM[sport] || SPORT_ITEM.FOOTBALL;
  if (played.length && !played.includes(item)) return false;
  if (![...kinds].some((k) => wanted.has(k)) && !(played.includes(item) && [...kinds].some((k) => ANY_CLUB.has(k)))) return false;
  if (greek && !itemIds(entity, "P17").includes("Q41")) return false;
  const words = nameKey(teamName).split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w));
  if (!words.length) return true;
  const known = [...Object.values(entity.labels || {}).map((l) => l.value), ...Object.values(entity.aliases || {}).flat().map((a) => a.value)].map(nameKey);
  return words.some((word) => known.some((name) => name.includes(word)));
}

async function entities(ids, props) {
  if (!ids.length) return {};
  const root = await getJson(`${WIKIDATA}&action=wbgetentities&ids=${encodeURIComponent(ids.join("|"))}&props=${encodeURIComponent(props)}&languages=${encodeURIComponent("el|en")}&sitefilter=${encodeURIComponent("elwiki|enwiki")}`);
  return root.entities || {};
}

async function findClub(name, sport, greek) {
  const short = name.split(" ").filter((w) => !GENERIC.has(w.toLowerCase())).join(" ");
  for (const query of [...new Set([name, short])].filter(Boolean)) {
    const found = new Set();
    for (const language of ["el", "en"]) {
      const root = await getJson(`${WIKIDATA}&action=wbsearchentities&search=${encodeURIComponent(query)}&language=${language}&uselang=${language}&type=item&limit=8`);
      (root.search || []).forEach((hit) => found.add(hit.id));
    }
    if (!found.size) continue;
    const ids = [...found].slice(0, 20);
    const loaded = await entities(ids, "claims|sitelinks|labels|aliases");
    const club = ids.map((id) => loaded[id]).find((entity) => entity && fits(entity, name, sport, greek));
    if (club) return club;
  }
  return null;
}

const articleOf = (entity) => (entity?.sitelinks?.elwiki ? ["el", entity.sitelinks.elwiki.title] : entity?.sitelinks?.enwiki ? ["en", entity.sitelinks.enwiki.title] : null);
const wikiApi = (language) => `https://${language}.wikipedia.org/w/api.php?format=json&formatversion=2&origin=*`;

async function intro(page, sentences) {
  if (!page) return null;
  const root = await getJson(`${wikiApi(page[0])}&action=query&prop=extracts&exintro=1&explaintext=1&exsentences=${sentences}&titles=${encodeURIComponent(page[1])}`);
  return root.query?.pages?.[0]?.extract?.trim() || null;
}

const textOf = (html) => {
  const box = new DOMParser().parseFromString(html.replace(/<(style|script|sup)[^>]*>[\s\S]*?<\/\1>/g, " "), "text/html").body;
  return (box.textContent || "").replace(/\[[^\]]{0,24}\]/g, " ").replace(/\s+/g, " ").trim();
};

async function honours(page) {
  if (!page) return [];
  const base = `${wikiApi(page[0])}&action=parse&page=${encodeURIComponent(page[1])}`;
  const sections = (await getJson(`${base}&prop=sections`)).parse?.sections || [];
  const section = sections.find((s) => HONOURS.test(textOf(s.line || "")));
  if (!section) return [];
  const html = (await getJson(`${base}&prop=text&section=${section.index}&disableeditsection=1`)).parse?.text || "";
  const body = new DOMParser().parseFromString(html.replace(/<(style|script|sup)[^>]*>[\s\S]*?<\/\1>/g, " "), "text/html").body;
  const lines = [...body.querySelectorAll("li:not(.toclevel-1)")].map((li) => li.textContent.replace(/\[[^\]]{0,24}\]/g, " ").replace(/\s+/g, " ").trim());
  const rows = [...body.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join(": "));
  return [...new Set([...lines, ...rows])].filter((t) => t.length >= 6 && t.length <= 170 && /\d/.test(t) && /\p{L}/u.test(t) && !/^\d/.test(t)).slice(0, 20);
}

export async function clubProfile(id, name, sport, greek) {
  if (memory.has(id)) return memory.get(id);
  const job = (async () => {
    const club = await findClub(name, sport, greek);
    if (!club) return null;
    const groundId = itemIds(club, "P115")[0];
    const cityId = [...itemIds(club, "P159"), ...itemIds(club, "P131")][0];
    const around = await entities([groundId, cityId].filter(Boolean), "claims|sitelinks|labels");
    const page = articleOf(club);
    const [about, list, groundAbout] = await Promise.all([
      intro(page, 5).catch(() => null), honours(page).catch(() => []), intro(articleOf(around[groundId]), 2).catch(() => null),
    ]);
    const founded = about?.match(/(?:[Ιι]δρύθηκε|[Ff]ounded|[Ee]stablished)[^.]{0,60}?\b(1[89]\d{2}|20\d{2})\b/)?.[1] || yearOf(club, "P571");
    const file = around[groundId] && snaks(around[groundId], "P18")[0];
    return {
      about, honours: list, founded,
      ground: around[groundId] ? { name: label(around[groundId]), about: groundAbout, opened: yearOf(around[groundId], "P1619") || yearOf(around[groundId], "P571"), file } : null,
      city: around[cityId] ? label(around[cityId]) : null,
      url: page ? `https://${page[0]}.wikipedia.org/wiki/${encodeURIComponent(page[1].replaceAll(" ", "_"))}` : null,
    };
  })();
  memory.set(id, job);
  job.catch(() => memory.delete(id));
  return job;
}
