#!/usr/bin/env python3
"""Récupère les cartes d'un set depuis uvsultra.online.

Usage :
    python3 tools/fetch_cards.py [--extension-id 27] [--set-slug streetfighter]
                                 [--out assets/sets] [--cookie "PHPSESSID=...; lang=fr"]

Produit, dans <out>/<set-slug>/ :
    - img/<extension_id>_<numero>.jpg   (illustrations preview)
    - cards.json                        (métadonnées, source canonique)
    - cards.js                          (wrapper window.SETS, compatible file://)
Et <out>/index.json listant les sets disponibles.
"""

import argparse
import gzip
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from pathlib import Path

BASE_URL = "https://uvsultra.online"
DEFAULT_COOKIE = "PHPSESSID=7db39d49bf52fa38d904fce811a85080; lang=fr"
PAGE_SIZE = 50

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
    "Accept": "*/*",
    "Accept-Language": "fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/?lang=fr",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

KNOWN_RARITIES = {
    "commune": "Commune",
    "inhabituelle": "Inhabituelle",
    "rare": "Rare",
    "ultra-rare": "Ultra-rare",
    "promotionnelle": "Promotionnelle",
    "se": "SE",
    "secret-rare": "Secret-rare",
}
RARITY_ALIASES = {
    "commune": "commune",
    "inhabituelle": "inhabituelle",
    "rare": "rare",
    "ultra-rare": "ultra-rare",
    "promotionnelle": "promotionnelle",
    "promo": "promotionnelle",
    "se": "se",
    "secret-rare": "secret-rare",
    "secret rare": "secret-rare",
    "secret": "secret-rare",
}

CARD_BLOCK_RE = re.compile(
    r'<div onmouseover="preview2\(\'(?P<set_dir>[^\']*)\', \'(?P<num>[^\']*)\', '
    r"\'(?P<kind>[^\']*)'\);\">(?P<body>.*?)<div class=\"clear\">",
    re.S,
)
NAME_RE = re.compile(r"<h1>(.*?)</h1>", re.S)
TYPE_RE = re.compile(r'class="label lc-label card-list-([a-z]+)">([^<]*)</span>')
RARITY_RE = re.compile(
    r'class="label lc-label card-list-[a-z]+">[^<]*</span><br />\s*([^<\n]*?)\s*</div>'
)
SET_RE = re.compile(
    r'Set (?P<set_num>\d+) - <span[^>]*><a[^>]*>(?P<set_name>[^<]*)</a> #(?P<numero>\d+)'
)
SITE_ID_RE = re.compile(r"card\.php\?id=(\d+)")
TOTAL_RE = re.compile(r"(\d+)\s+cartes")
RESULTS_RE = re.compile(r"([\d\s]+)\s*Results")

TYPE_SLUGS = {
    "character": "character",
    "action": "action",
    "attack": "attack",
    "foundation": "foundation",
    "asset": "asset",
}


def decode_response(data: bytes, encoding: str) -> bytes:
    if "gzip" in encoding:
        data = gzip.decompress(data)
    elif "deflate" in encoding:
        try:
            data = zlib.decompress(data)
        except zlib.error:
            data = zlib.decompress(data, -zlib.MAX_WBITS)
    return data


def http_request(url: str, *, data: bytes = None, cookie: str, tries: int = 3) -> bytes:
    headers = dict(HEADERS)
    headers["Cookie"] = cookie
    if data is not None:
        headers["Content-Length"] = str(len(data))
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return decode_response(resp.read(), resp.headers.get("Content-Encoding", ""))
        except urllib.error.HTTPError as exc:
            body = exc.read()
            if exc.code in (429, 500, 502, 503) and attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise SystemExit(f"Erreur HTTP {exc.code} sur {url}") from exc
        except urllib.error.URLError as exc:
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise SystemExit(f"Erreur réseau sur {url} : {exc.reason}") from exc
    raise SystemExit(f"Echec après {tries} essais : {url}")


def fetch_text(url: str, *, data: bytes = None, cookie: str) -> str:
    return http_request(url, data=data, cookie=cookie).decode("utf-8", errors="replace")


def build_form(extension_id: int, page: int) -> bytes:
    params = [
        ("name", ""),
        ("card_text", ""),
        ("spotlightDD", "aot"),
        ("extension[]", str(extension_id)),
        ("difficulty_operand", "="),
        ("difficulty", ""),
        ("keyword_text", ""),
        ("bm_operand", "="),
        ("block", ""),
        ("as_operand", "="),
        ("speed", ""),
        ("ad_operand", "="),
        ("damage", ""),
        ("ac_operand", "="),
        ("ability_count", ""),
        ("kc_operand", "="),
        ("keyword_count", ""),
        ("v_operand", "="),
        ("vitality", ""),
        ("custom_format", ""),
        ("page", str(page)),
    ]
    return urllib.parse.urlencode(params).encode("ascii")


def normalize_rarity(raw: str, card_label: str) -> dict:
    key = RARITY_ALIASES.get(raw.strip().lower().rstrip("."))
    if key is None:
        raise SystemExit(f"Rareté inconnue pour « {card_label} » : {raw!r}")
    return {"slug": key, "label": KNOWN_RARITIES[key]}


def parse_page(html: str, extension_id: int) -> list[dict]:
    cards = []
    for match in CARD_BLOCK_RE.finditer(html):
        body = match.group("body")
        num_str = match.group("num")
        set_dir = match.group("set_dir")

        name_m = NAME_RE.search(body)
        type_m = TYPE_RE.search(body)
        rarity_m = RARITY_RE.search(body)
        set_m = SET_RE.search(body)
        site_m = SITE_ID_RE.search(body)
        if not (name_m and type_m and rarity_m and set_m):
            raise SystemExit(f"Bloc de carte incomplet pour le numéro {num_str}")

        name = name_m.group(1).strip()
        type_slug_raw = type_m.group(1)
        type_slug = TYPE_SLUGS.get(type_slug_raw)
        if type_slug is None:
            raise SystemExit(f"Type inconnu pour « {name} » : {type_slug_raw!r}")

        number = int(num_str)
        set_number = int(set_m.group("set_num"))
        numero = int(set_m.group("numero"))
        if number != numero:
            raise SystemExit(
                f"Incoherence de numero pour « {name} » : preview2={number}, liste={numero}"
            )

        cards.append(
            {
                "id": f"{set_dir}-{number:03d}",
                "number": number,
                "name": name,
                "type": {"slug": type_slug, "label": type_m.group(2).strip()},
                "rarity": normalize_rarity(rarity_m.group(1), name),
                "image": f"img/{extension_id}_{number:03d}.jpg",
                "set": {
                    "id": extension_id,
                    "slug": set_dir,
                    "number": set_number,
                    "name": set_m.group("set_name").strip(),
                },
                "siteId": int(site_m.group(1)) if site_m else None,
            }
        )
    return cards


def parse_total(html: str) -> int:
    m = TOTAL_RE.search(html) or RESULTS_RE.search(html)
    if not m:
        raise SystemExit("Impossible de lire le nombre total de cartes dans la réponse.")
    return int(m.group(1).replace(" ", ""))


def login_page_detected(html: str) -> bool:
    return "login" in html.lower() and "card_title" not in html and "<h1>" not in html


def fetch_cards(extension_id: int, cookie: str) -> tuple[list[dict], str]:
    first_html = fetch_text(
        f"{BASE_URL}/listing_cards.php", data=build_form(extension_id, 0), cookie=cookie
    )
    if login_page_detected(first_html):
        raise SystemExit(
            "L'API semble renvoyer une page de connexion : le cookie PHPSESSID a probablement "
            "expiré. Fournis un nouveau cookie via --cookie."
        )
    total = parse_total(first_html)
    print(f"Total annonce par l'API : {total} cartes")

    all_cards = parse_page(first_html, extension_id)
    pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    for page in range(1, pages):
        time.sleep(1)
        html = fetch_text(
            f"{BASE_URL}/listing_cards.php",
            data=build_form(extension_id, page),
            cookie=cookie,
        )
        batch = parse_page(html, extension_id)
        print(f"Page {page + 1}/{pages} : {len(batch)} cartes")
        all_cards.extend(batch)

    return all_cards, total


def download_images(cards: list[dict], set_slug: str, extension_id: int, cookie: str,
                    img_dir: Path) -> None:
    img_dir.mkdir(parents=True, exist_ok=True)
    for i, card in enumerate(cards, 1):
        dest = img_dir / Path(card["image"]).name
        if dest.exists() and dest.stat().st_size > 0:
            continue
        url = (
            f"{BASE_URL}/images/extensions/{set_slug}/"
            f"{card['number']:03d}-preview.jpg"
        )
        data = http_request(url, cookie=cookie)
        if not data.startswith(b"\xff\xd8"):
            raise SystemExit(f"Image invalide (pas un JPEG) : {url}")
        dest.write_bytes(data)
        if i % 25 == 0 or i == len(cards):
            print(f"Images {i}/{len(cards)}")
        time.sleep(0.15)


def write_outputs(out_dir: Path, set_slug: str, payload: dict, extension_id: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    cards_json = out_dir / "cards.json"
    cards_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "cards.js").write_text(
        "window.SETS = window.SETS || {};\n"
        f"window.SETS[{json.dumps(set_slug)}] = "
        f"{json.dumps(payload, ensure_ascii=False)};\n",
        encoding="utf-8",
    )

    index_path = out_dir.parent / "index.json"
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
    else:
        index = {"sets": []}
    entry = {
        "slug": set_slug,
        "setId": extension_id,
        "name": payload["setName"],
        "cardCount": payload["cardCount"],
        "path": f"{set_slug}/cards.json",
    }
    index["sets"] = [s for s in index["sets"] if s.get("slug") != set_slug] + [entry]
    index["sets"].sort(key=lambda s: s.get("setId", 0))
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir.parent / "sets.js").write_text(
        "window.SET_LIST = "
        f"{json.dumps(index['sets'], ensure_ascii=False)};\n",
        encoding="utf-8",
    )


def validate(cards: list[dict], expected_total: int, img_dir: Path,
             extension_id: int) -> None:
    problems = []
    if len(cards) != expected_total:
        problems.append(f"{len(cards)} cartes parsées au lieu de {expected_total}")

    numbers = [c["number"] for c in cards]
    if len(set(numbers)) != len(numbers):
        dupes = sorted({n for n in numbers if numbers.count(n) > 1})
        problems.append(f"numéros dupliqués : {dupes}")

    for card in cards:
        path = img_dir / Path(card["image"]).name
        if not path.exists() or path.stat().st_size == 0:
            problems.append(f"image manquante : {path.name}")
        elif not path.read_bytes().startswith(b"\xff\xd8"):
            problems.append(f"image corrompue : {path.name}")

    rarities: dict[str, int] = {}
    types: dict[str, int] = {}
    for card in cards:
        rarities[card["rarity"]["label"]] = rarities.get(card["rarity"]["label"], 0) + 1
        types[card["type"]["label"]] = types.get(card["type"]["label"], 0) + 1

    print("\nValidation")
    print(f"  cartes     : {len(cards)} / {expected_total}")
    print(f"  images     : {len(list(img_dir.glob('*.jpg')))} fichiers dans {img_dir}")
    print(f"  raretés    : {rarities}")
    print(f"  types      : {types}")
    print(f"  plages     : {min(numbers)}–{max(numbers)}")

    if problems:
        print("\nProblèmes détectés :")
        for p in problems:
            print(f"  - {p}")
        raise SystemExit(1)
    print("  statut     : OK")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extension-id", type=int, default=27)
    parser.add_argument("--set-slug", default="streetfighter")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "assets" / "sets"))
    parser.add_argument("--cookie", default=DEFAULT_COOKIE)
    parser.add_argument("--skip-images", action="store_true")
    args = parser.parse_args()

    cards, total = fetch_cards(args.extension_id, args.cookie)
    cards.sort(key=lambda c: c["number"])
    first = cards[0] if cards else None

    payload = {
        "setId": args.extension_id,
        "setSlug": args.set_slug,
        "setNumber": first["set"]["number"] if first else None,
        "setName": first["set"]["name"] if first else args.set_slug,
        "cardCount": len(cards),
        "cards": [
            {k: v for k, v in card.items() if k != "set"} for card in cards
        ],
    }

    out_dir = Path(args.out) / args.set_slug
    if not args.skip_images:
        download_images(cards, args.set_slug, args.extension_id, args.cookie,
                        out_dir / "img")

    write_outputs(out_dir, args.set_slug, payload, args.extension_id)
    validate(cards, total, out_dir / "img", args.extension_id)
    print(f"\nÉcrit : {out_dir}/cards.json, cards.js, img/, "
          f"{out_dir.parent}/index.json et sets.js")


if __name__ == "__main__":
    main()
