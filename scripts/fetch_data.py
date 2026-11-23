"""Builds data/tv.json and data/highlights.json for the site.

The browser cannot read these sources directly, so a scheduled GitHub Action prepares them.
If a source fails, the previously published file is kept.
"""
import datetime as dt
import difflib
import gzip
import html as html_text
import json
import pathlib
import re
import subprocess
import sys
import unicodedata
import urllib.error
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SITE = "https://nikosanat.github.io/kerkida-web/data"
GUIDE = "https://epgshare01.online/epgshare01/epg_ripper_GR1.xml.gz"
SPORT_FM = "https://www.sport-fm.gr/tv"
FEED = "https://www.youtube.com/feeds/videos.xml?channel_id="
ATHENS = ZoneInfo("Europe/Athens")
AGENT = "KerkidaWeb/1.0"

CHANNELS = [
    ("UCEIbXco8hU9oDHXGo1kwIlA", "Novasports", "BROADCASTER", None),
    ("UCgMUmr7uLDalwVk63Sf6pBw", "Magenta Sport GR", "BROADCASTER", None),
    ("UCG5qGWdu8nIRZqJ_GgDwQ-w", "Premier League", "LEAGUE", "FOOTBALL"),
    ("UCTv-XvfzLX3i4IGWAm4sbmA", "LALIGA", "LEAGUE", "FOOTBALL"),
    ("UCBJeMCIeLQos7wacox4hmLQ", "Serie A", "LEAGUE", "FOOTBALL"),
    ("UC6UL29enLNe4mqwTfAyeNuw", "Bundesliga", "LEAGUE", "FOOTBALL"),
    ("UCQsH5XtIc9hONE1BQjucM0g", "Ligue 1", "LEAGUE", "FOOTBALL"),
    ("UCyGa1YEx9ST66rYrJTGIKOw", "UEFA", "LEAGUE", "FOOTBALL"),
    ("UCGr3nR_XH9r6E5b09ZJAT9w", "EuroLeague", "LEAGUE", "BASKETBALL"),
    ("UCWJ2lWNubArHWmf3FIHbfcQ", "NBA", "LEAGUE", "BASKETBALL"),
    ("UCZUkv6tSC5OfX54gLgjV9aw", "Basketball Champions League", "LEAGUE", "BASKETBALL"),
    ("UCB_qr75-ydFVKSF9Dmo6izg", "Formula 1", "LEAGUE", "MOTOR"),
    ("UCY_5h5zaSwN7Or4kIJDYNXA", "ATP Tour", "LEAGUE", "TENNIS"),
    ("UCaBIVVpHjq6j3tSyxwTE-8Q", "WTA", "LEAGUE", "TENNIS"),
    ("UCLf7YXb-0PWEeq59Z_q318A", "Olympiacos FC", "CLUB", "FOOTBALL"),
    ("UCInZnZ8JYwmIvs8gtNriwSQ", "PAOK FC", "CLUB", "FOOTBALL"),
    ("UCX8HprRO1BYnQ6Mu2nB9VsQ", "AEK FC", "CLUB", "FOOTBALL"),
    ("UCy8t8HKIih3JQZygj4XTejA", "ARIS FC", "CLUB", "FOOTBALL"),
]

LIVE_MARK = re.compile(r"\((?:Z|Ζ|LIVE)\)|^live\s*:", re.I)
SPORT_CATEGORY = re.compile("ποδοσφαιρο|μπασκετ|τενισ|βολει|χαντμπολ|μηχανοκινητ|formula|πολο|γκολφ|σπορ|αθλητ|moto|fight|mma|χοκει")
SPORT_PREFIX = re.compile(r"^(motorsports|ποδόσφαιρο|μπάσκετ|τένις|βόλεϊ|χάντμπολ|πόλο|μηχανοκίνητα|formula 1)\s*:\s*", re.I)
WANTED = re.compile(r"highlight|resumen|sintesi|σύνοψη|στιγμιότυπα|matchday \d+|(?<!\d)\d{1,3}\s*[-–]\s*\d{1,3}(?!\d)", re.I)
UNWANTED = re.compile(r"#shorts?|συνέντευξη|press|προπόνηση|training|παρακάμερα|behind|top \d+|best |goals of|skills?\b|trailer|podcast|women|γυναικ|u-?\d\d", re.I)
USUAL_MINUTES = {"FOOTBALL": 115, "BASKETBALL": 125, "TENNIS": 180, "MOTOR": 120, "VOLLEYBALL": 120, "HANDBALL": 90,
                 "WATER_POLO": 80, "RUGBY": 110, "AMERICAN_FOOTBALL": 200, "HOCKEY": 150, "BASEBALL": 180, "MMA": 180, "GOLF": 300, "OTHER": 110}
CLASSIFY = [
    ("BASKETBALL", r"nba|euroleague|eurocup|acb|gbl|basket|bcl|μπασκετ|ευρωλιγκα|γιουροκαπ|tbsl|elite league"),
    ("TENNIS", r"atp|wta|τενισ"),
    ("MOTOR", r"formula|moto|erc|wrc|ραλι|γκραν πρι|μηχανοκινητ"),
    ("VOLLEYBALL", r"βολει|volley"),
    ("HANDBALL", r"χαντμπολ|handball"),
    ("WATER_POLO", r"(^|[^α-ω])πολο([^α-ω]|$)|water polo"),
    ("AMERICAN_FOOTBALL", r"nfl|αμερικανικο ποδοσφαιρο|αμερικανικο ποδ"),
    ("HOCKEY", r"nhl|χοκει|hockey"),
    ("BASEBALL", r"mlb|μπειζμπολ|baseball"),
    ("MMA", r"ufc|mma|πυγμαχ|boxing|fight"),
    ("GOLF", r"γκολφ|golf|pga"),
    ("RUGBY", r"rugby|ραγκμπι"),
    ("OTHER", r"futsal|σνουκερ|snooker"),
    ("FOOTBALL", r"λιγκα|league|serie|σεριε|liga|bundesliga|μπουντεσλιγκα|eredivisie|πριμιερσιπ|premiership|κυπελλο|πρωταθλημα|ποδοσφαιρο|καπ|copa|κατηγορια"),
]


def fetch(url, timeout=120):
    done = subprocess.run(["curl", "-fsSL", "--retry", "2", "-m", str(timeout), "-A", AGENT, url], capture_output=True)
    if done.returncode:
        raise OSError(f"{url.split('?')[0]}: curl {done.returncode}")
    return done.stdout


def plain(text):
    lower = "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))
    return lower.replace("ς", "σ")


def classify(competition, title):
    text = plain(f"{competition} {title}")
    for sport, pattern in CLASSIFY:
        if re.search(pattern, text):
            return sport
    return "FOOTBALL" if re.search(r" [-–] |[α-ωa-z]-[α-ωa-z]", title.lower()) else "OTHER"


def sport_of(category, competition, title):
    c = plain(category)
    if "ποδοσφαιρο" in c and "αμερικ" not in c:
        return "FOOTBALL"
    for needle, sport in (("μπασκετ", "BASKETBALL"), ("τενισ", "TENNIS"), ("μηχανοκινητ", "MOTOR"), ("formula", "MOTOR"), ("moto", "MOTOR"),
                          ("βολει", "VOLLEYBALL"), ("χαντμπολ", "HANDBALL"), ("πολο", "WATER_POLO"), ("γκολφ", "GOLF"),
                          ("αμερικ", "AMERICAN_FOOTBALL"), ("fight", "MMA"), ("mma", "MMA"), ("πυγμαχ", "MMA")):
        if needle in c:
            return sport
    return classify(competition, title)


def clean_title(raw):
    text = re.sub(r"^live\s*:\s*", "", raw, flags=re.I)
    text = SPORT_PREFIX.sub("", text)
    text = re.sub(r"\s*\((?:Z|Ζ|LIVE)\)", "", text, flags=re.I).strip()
    index = text.find(" : ")
    return (text, "") if index <= 0 else (text[:index].strip(), text[index + 3:].strip())


def network_known(channel):
    c = plain(channel).strip()
    starts = ("novasport", "magenta", "eurosport", "dazn", "αντ1", "ant1", "σπορ fm", "sport fm", "ερτ", "ert", "εpτ", "mega", "alpha", "σκαι", "skai", "star", "open", "action 24", "one channel")
    return c.startswith(starts) and not ("κεντρικ" in c or "kentrik" in c)


def channel_name(channel):
    channel = re.sub(r"\s+(HD|ΗD)$", "", channel).strip()
    found = re.match(r"^\s*magenta\s*sport\s*([1-9])\s*(?:l|league)\s*$", channel, re.I)
    return f"Magenta Sport {found.group(1)} League" if found else channel


def parse_time(value):
    return dt.datetime.strptime(value, "%Y%m%d%H%M%S %z")


def build_guide(now):
    raw = gzip.decompress(fetch(GUIDE, 180))
    root = ET.fromstring(raw)
    names = {}
    for channel in root.iter("channel"):
        name = channel.findtext("display-name")
        if name:
            names.setdefault(channel.get("id"), name.strip())
    today = now.astimezone(ATHENS).date()
    first, last = today - dt.timedelta(days=1), today + dt.timedelta(days=7)
    items = {}
    for programme in root.iter("programme"):
        channel = names.get(programme.get("channel"))
        title_raw = (programme.findtext("title") or "").strip()
        category = (programme.findtext("category") or "").strip()
        if not channel or not title_raw or not LIVE_MARK.search(title_raw) or not SPORT_CATEGORY.search(plain(category)) or not network_known(channel):
            continue
        try:
            begin = parse_time(programme.get("start"))
        except (TypeError, ValueError):
            continue
        local = begin.astimezone(ATHENS)
        if not first <= local.date() <= last:
            continue
        title, competition = clean_title(title_raw)
        if not title:
            continue
        sport = sport_of(category, competition, title)
        minutes = 0
        try:
            minutes = int((parse_time(programme.get("stop")) - begin).total_seconds() // 60)
        except (TypeError, ValueError):
            pass
        if not 20 <= minutes <= 600:
            minutes = USUAL_MINUTES[sport]
        name = channel_name(channel)
        start = int(begin.timestamp() * 1000)
        items.setdefault((start, name.lower().replace(" ", ""), title), {
            "date": local.date().isoformat(), "time": local.strftime("%H:%M"), "startMs": start, "endMs": start + minutes * 60_000,
            "channel": name, "title": title, "competition": competition or category, "sport": sport,
        })
    return sorted(items.values(), key=lambda item: (item["startMs"], item["channel"]))


def clean_html(fragment):
    text = re.sub(r"<[^>]+>", " ", fragment or "")
    return re.sub(r"\s+", " ", html_text.unescape(text).replace(" ", " ")).strip()


def first_tag(pattern, fragment):
    found = re.search(pattern, fragment, re.I)
    return clean_html(found.group(1)) if found else ""


def build_sport_fm(now):
    page = fetch(SPORT_FM, 60).decode("utf-8", "replace")
    today = now.astimezone(ATHENS).date()
    last = today + dt.timedelta(days=7)
    items = []
    for chunk in re.split(r'<div[^>]*class="tv-day(?:\s[^"]*)?"', page, flags=re.I)[1:]:
        header = re.search(r"(\d{1,2})/(\d{1,2})$", first_tag(r"<h2[^>]*>([\s\S]*?)</h2>", chunk))
        if not header:
            continue
        day, month = int(header.group(1)), int(header.group(2))
        year = today.year + 1 if month + 6 < today.month else today.year - 1 if month - 6 > today.month else today.year
        try:
            date = dt.date(year, month, day)
        except ValueError:
            continue
        if not today - dt.timedelta(days=1) <= date <= last:
            continue
        for tile in re.split(r'class="[^"]*archive-row-tile', chunk, flags=re.I)[1:]:
            if "tv_logos" not in tile:
                continue
            clock = first_tag(r"<time[^>]*>([\s\S]*?)</time>", tile)
            title = first_tag(r"<h3[^>]*>([\s\S]*?)</h3>", tile)
            competition = first_tag(r"<p[^>]*>([\s\S]*?)</p>", tile)
            channel = first_tag(r"<span[^>]*post-category[^>]*>([\s\S]*?)</span>", tile)
            if not re.fullmatch(r"\d{1,2}:\d{2}", clock) or not title or not channel:
                continue
            hour, minute = map(int, clock.split(":"))
            begin = dt.datetime(date.year, date.month, date.day, hour, minute, tzinfo=ATHENS)
            sport = classify(competition, title)
            start = int(begin.timestamp() * 1000)
            items.append({"date": date.isoformat(), "time": f"{hour:02d}:{minute:02d}", "startMs": start, "endMs": start + USUAL_MINUTES[sport] * 60_000,
                          "channel": channel_name(channel), "title": title, "competition": competition, "sport": sport})
    return items


def channel_key(channel):
    return re.sub(r"[^a-z0-9α-ω+]", "", re.sub(r"(hd|ηd|ηδ|4k)", "", plain(channel_name(channel))))


def build_tv(now):
    """ΣΠΟΡ FM leads. The second guide only adds what the first one lacks."""
    merged = []
    for builder in (build_sport_fm, build_guide):
        try:
            found = builder(now)
            print(builder.__name__, len(found))
        except (OSError, ET.ParseError, EOFError, ValueError) as error:
            print(f"{builder.__name__} failed: {error}", file=sys.stderr)
            continue
        for item in found:
            same = any(abs(kept["startMs"] - item["startMs"]) <= 15 * 60_000 and channel_key(kept["channel"]) == channel_key(item["channel"]) and
                       difflib.SequenceMatcher(None, plain(kept["title"]), plain(item["title"])).ratio() >= 0.45 for kept in merged)
            if not same:
                merged.append(item)
    return sorted(merged, key=lambda item: (item["startMs"], item["channel"]))


def build_highlights(now):
    atom = "{http://www.w3.org/2005/Atom}"
    video_tag = "{http://www.youtube.com/xml/schemas/2015}videoId"
    cutoff = now - dt.timedelta(days=14)
    videos = {}
    worked = 0
    for channel_id, name, kind, sport in CHANNELS:
        try:
            root = ET.fromstring(fetch(FEED + channel_id, 40))
            worked += 1
        except (OSError, ET.ParseError) as error:
            print("skip", name, error, file=sys.stderr)
            continue
        for entry in root.iter(f"{atom}entry"):
            video = entry.findtext(video_tag)
            title = (entry.findtext(f"{atom}title") or "").strip()
            published = entry.findtext(f"{atom}published")
            if not video or not published or not WANTED.search(title) or UNWANTED.search(title):
                continue
            when = dt.datetime.fromisoformat(published)
            if when >= cutoff:
                videos[video] = {"id": video, "title": title, "channel": name, "kind": kind, "sport": sport, "publishedMs": int(when.timestamp() * 1000)}
    if not worked:
        raise OSError("no channel answered")
    return sorted(videos.values(), key=lambda item: -item["publishedMs"])


def publish(file, key, builder, now):
    target = DATA / file
    try:
        values = builder(now)
        if not values:
            raise ValueError("empty result")
        target.write_text(json.dumps({"updated": int(now.timestamp() * 1000), key: values}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(file, len(values))
    except (OSError, ValueError, ET.ParseError, EOFError, urllib.error.URLError) as error:
        print(f"{file}: keeping the previous version ({error})", file=sys.stderr)
        try:
            target.write_bytes(fetch(f"{SITE}/{file}", 30))
        except OSError:
            if not target.exists():
                target.write_text(json.dumps({"updated": 0, key: []}), encoding="utf-8")


if __name__ == "__main__":
    moment = dt.datetime.now(dt.timezone.utc)
    DATA.mkdir(exist_ok=True)
    publish("tv.json", "items", build_tv, moment)
    publish("highlights.json", "videos", build_highlights, moment)
