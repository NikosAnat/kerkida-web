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
import time
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


GBL_PAGE = "https://www.esake.gr/el/action/EsakeResults?idchampionship=184645B9&idteam=&idseason=00000001&series={:02d}"
GBL_SITE = "https://www.esake.gr"
GBL_ROUNDS = 26
OPEN_SITE = "https://www.the-sports.org/"
OPEN_ROUND = OPEN_SITE + "ajax_php.php?majajax=resultats_manche_collectif&mancheid={}&langage=en"
OPEN_LEAGUES = [
    ("elite", "BASKETBALL", "basketball-greece-a2-ethniki-regular-season-2026-2027-results-eprd138798.html"),
    ("volley-men", "VOLLEYBALL", "volleyball-greece-men-s-a1-ethniki-volleyball-regular-season-2026-2027-results-eprd139133.html"),
    ("volley-women", "VOLLEYBALL", "volleyball-greece-women-s-a1-ethniki-regular-season-2026-2027-results-eprd139139.html"),
]
GREEK_MONTHS = {"Ιαν": 1, "Φεβ": 2, "Μαρ": 3, "Απρ": 4, "Μαϊ": 5, "Μαι": 5, "Μάι": 5, "Ιουν": 6, "Ιουλ": 7, "Αυγ": 8, "Σεπ": 9, "Οκτ": 10, "Νοε": 11, "Δεκ": 12}
ENGLISH_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SEASON_START = 2026
SETTLED_AFTER = dt.timedelta(days=3)


def gently(url):
    """These are small sites, so requests stay well apart."""
    time.sleep(1.5)
    return fetch(url, 40).decode("utf-8", "replace")


def settled(games, now):
    """A round whose results are in and days old is not read again."""
    if not games:
        return False
    limit = (now - SETTLED_AFTER).timestamp() * 1000
    return all(g.get("homeScore") is not None and g.get("awayScore") is not None and g["kickoff"] < limit for g in games)


def parse_gbl(page):
    games = []
    for block in page.split('<div class="esake-program-game">')[1:]:
        game_id = re.search(r"idgame=([0-9A-Za-z]+)", block)
        round_no = re.search(r"<h5>\s*(\d+)", block)
        if not game_id or not round_no or "esake-program-game-final-score row" not in block:
            continue
        board = block.split("esake-program-game-final-score row", 1)[1].split("esake-program-game-hidden-row", 1)[0]
        cells = re.split(r'<div class="col-lg-', board)[1:]
        if len(cells) < 3:
            continue

        def team(cell):
            badge = re.search(r'src="(/dat/esaketeam/([0-9A-Za-z]+)/[^"]+)"', cell)
            name = re.search(r"<span>(.*?)</span>", cell, re.S)
            return {"id": f"gbl-{badge.group(2)}", "name": clean_html(name.group(1)), "logo": GBL_SITE + badge.group(1)} if badge and name else None

        def info(icon):
            found = re.search(rf'/skn/{icon}\.svg"[^>]*>([^<]*)<', block)
            return clean_html(found.group(1)) if found else ""

        home, away = team(cells[0]), team(cells[2])
        when = re.search(r"(\d{1,2})\s+(\w+)\s*-\s*(\d{1,2}):(\d{2})", info("clock"))
        month = when and (GREEK_MONTHS.get(when.group(2)[:4]) or GREEK_MONTHS.get(when.group(2)[:3]))
        if not home or not away or not month:
            continue
        year = SEASON_START if month >= 8 else SEASON_START + 1
        try:
            kickoff = dt.datetime(year, month, int(when.group(1)), int(when.group(3)), int(when.group(4)), tzinfo=ATHENS)
        except ValueError:
            continue
        side = re.search(r"<span>(.*?)</span>", cells[1], re.S)
        score = re.search(r"(\d{1,3})\s*(?:&nbsp;)?\s*-\s*(?:&nbsp;)?\s*(\d{1,3})", side.group(1)) if side else None
        games.append({"id": game_id.group(1), "round": int(round_no.group(1)), "kickoff": int(kickoff.timestamp() * 1000), "home": home, "away": away,
                      "homeScore": int(score.group(1)) if score else None, "awayScore": int(score.group(2)) if score else None,
                      "venue": info("pointer") or None, "channel": info("tv") or None})
    return games


def open_crests(page):
    return {number: f"{OPEN_SITE}images/equipes/{number}.{ext}" for number, ext in re.findall(r"images/equipes/(\d+)\.(png|jpg)", page) if number.strip("0")}


def open_name(raw):
    return html_text.unescape(raw).strip()


def parse_open_round(page, round_no, crests):
    games = []
    day = None
    for row in page.split("<tr"):
        head = re.search(r'daterenc">(\d{1,2}) (\w+) (\d{4})', row)
        if head:
            day = dt.date(int(head.group(3)), ENGLISH_MONTHS.index(head.group(2)) + 1, int(head.group(1))) if head.group(2) in ENGLISH_MONTHS else None
            continue
        sides = re.findall(r'identity-equ(\d+)\.html" title="([^"]+)"', row)
        if len(sides) < 2 or not day:
            continue
        clock = re.search(r'tdcol-15">(\d{1,2})h(\d{2})', row)
        score = re.search(r"<b>(\d{1,3}) - (\d{1,3})</b>", row)
        begin = dt.datetime(day.year, day.month, day.day, int(clock.group(1)) if clock else 12, int(clock.group(2)) if clock else 0, tzinfo=ATHENS)
        team = lambda s: {"id": f"ts-{s[0]}", "name": open_name(s[1]), "logo": crests.get(s[0])}
        game = {"id": f"{round_no}-{sides[0][0]}-{sides[1][0]}", "round": round_no, "kickoff": int(begin.timestamp() * 1000), "home": team(sides[0]), "away": team(sides[1]),
                "homeScore": int(score.group(1)) if score else None, "awayScore": int(score.group(2)) if score else None}
        if not clock:
            game["noTime"] = True
        games.append(game)
    return games


def parse_open_table(page, crests):
    if 'id="tab110"' not in page:
        return []
    general = page.split('id="tab110"', 1)[1].split('id="tab120"', 1)[0]
    rows = []
    for row in general.split("<tr"):
        side = re.search(r'identity-equ(\d+)\.html" title="([^"]+)"', row)
        numbers = [int(n.lstrip("+")) for n in re.findall(r'<td class="tdcol-\d+">([+-]?\d+)</td>', row)]
        if side and len(numbers) >= 8:
            rows.append({"rank": numbers[0], "team": {"id": f"ts-{side.group(1)}", "name": open_name(side.group(2)), "logo": crests.get(side.group(1))},
                         "played": numbers[2], "won": numbers[3], "drawn": 0, "lost": numbers[4], "diff": numbers[7], "points": numbers[1]})
    return rows


def computed_table(games, now, final_after, volleyball):
    """GBL gives 2 for a win and 1 for a loss. Volleyball gives 3-0, or 2-1 after five sets."""
    teams = {}
    limit = now.timestamp() * 1000 - final_after * 60_000
    for game in games:
        for side in (game["home"], game["away"]):
            teams.setdefault(side["id"], {"team": side, "played": 0, "won": 0, "drawn": 0, "lost": 0, "diff": 0, "points": 0, "_for": 0})
        a, b = game.get("homeScore"), game.get("awayScore")
        if a is None or b is None or a == b or game["kickoff"] > limit:
            continue
        for me, mine, theirs in ((game["home"], a, b), (game["away"], b, a)):
            row = teams[me["id"]]
            won = mine > theirs
            row["played"] += 1
            row["won" if won else "lost"] += 1
            row["diff"] += mine - theirs
            row["_for"] += mine
            if volleyball:
                row["points"] += (2 if won else 1) if min(a, b) == 2 else (3 if won else 0)
            else:
                row["points"] += 2 if won else 1
    ordered = sorted(teams.values(), key=lambda r: (-r["points"], -r["diff"], -r["_for"], r["team"]["name"]))
    return [{**{k: v for k, v in row.items() if k != "_for"}, "rank": index + 1} for index, row in enumerate(ordered)]


def previous_greek():
    try:
        data = json.loads(fetch(f"{SITE}/greek.json", 30))
        return {league["id"]: league for league in data.get("leagues", [])}
    except (OSError, ValueError):
        return {}


def build_gbl(now, old):
    games = []
    failures = 0
    for number in range(1, GBL_ROUNDS + 1):
        saved = [g for g in old.get("games", []) if g["round"] == number]
        if settled(saved, now):
            games += saved
            continue
        try:
            games += parse_gbl(gently(GBL_PAGE.format(number))) or saved
        except OSError as error:
            print(f"gbl round {number}: {error}", file=sys.stderr)
            games += saved
            failures += 1
            if failures >= 3:
                games += [g for g in old.get("games", []) if g["round"] > number]
                break
    if not games:
        raise OSError("no GBL games")
    return {"id": "gbl", "games": sorted(games, key=lambda g: g["kickoff"]), "table": computed_table(games, now, 150, False)}


def build_open(league_id, sport, page_name, now, old):
    index = gently(OPEN_SITE + page_name)
    crests = open_crests(index)
    rounds = {}
    for key, number in re.findall(r'<option value="mancheid=(\d+)"(?: selected)?>Round (\d+)', index):
        rounds.setdefault(int(number), key)
    games = []
    for number, key in sorted(rounds.items()):
        saved = [g for g in old.get("games", []) if g["round"] == number]
        if settled(saved, now):
            games += saved
            continue
        try:
            games += parse_open_round(gently(OPEN_ROUND.format(key)), number, crests) or saved
        except OSError as error:
            print(f"{league_id} round {number}: {error}", file=sys.stderr)
            games += saved
    if not games:
        raise OSError(f"no {league_id} games")
    # The source's own table counts two points a win in every sport, so volleyball is worked out from the sets.
    table = computed_table(games, now, 90, True) if sport == "VOLLEYBALL" else parse_open_table(index, crests) or computed_table(games, now, 90, False)
    return {"id": league_id, "games": sorted(games, key=lambda g: g["kickoff"]), "table": table}


def build_greek(now):
    old = previous_greek()
    leagues = []
    jobs = [("gbl", lambda: build_gbl(now, old.get("gbl", {})))]
    jobs += [(lid, (lambda l=lid, s=sport, p=page: build_open(l, s, p, now, old.get(l, {})))) for lid, sport, page in OPEN_LEAGUES]
    for league_id, job in jobs:
        try:
            league = job()
            print(league_id, len(league["games"]), "games", len(league["table"]), "teams")
            leagues.append(league)
        except (OSError, ValueError) as error:
            print(f"{league_id}: keeping the previous version ({error})", file=sys.stderr)
            if league_id in old:
                leagues.append(old[league_id])
    return leagues


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
    publish("greek.json", "leagues", build_greek, moment)
