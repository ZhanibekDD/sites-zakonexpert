#!/usr/bin/env python3
"""Scraper for findh.org - private judicial bailiffs (ЧСИ) all regions of Kazakhstan."""

import gzip
import json
import os
import time
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup

REGIONS = [
    ("astana",    "город Астана"),
    ("almaty",    "город Алматы"),
    ("shymkent",  "город Шымкент"),
    ("abay",      "область Абай"),
    ("akmol",     "Акмолинская область"),
    ("aktobe",    "Актюбинская область"),
    ("almobl",    "Алматинская область"),
    ("atyrau",    "Атырауская область"),
    ("vko",       "Восточно-Казахстанская область"),
    ("zhambyl",   "Жамбылская область"),
    ("zhetysu",   "область Жетысу"),
    ("zko",       "Западно-Казахстанская область"),
    ("karaganda", "Карагандинская область"),
    ("kostanay",  "Костанайская область"),
    ("kyzylorda", "Кызылординская область"),
    ("mangistau", "Мангистауская область"),
    ("pavlodar",  "Павлодарская область"),
    ("sko",       "Северо-Казахстанская область"),
    ("turkestan", "Туркестанская область"),
    ("ulytau",    "область Улытау"),
]

BASE_URL = "https://findh.org/3674-spisok-chastnyh-sudebnyh-ispolnitelej-v-kazahstane.html"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9",
}


def parse_region(region_slug, region_name):
    """Parse all bailiffs for a given region."""
    url = f"{BASE_URL}?region={region_slug}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.encoding = "utf-8"
    except requests.RequestException as e:
        print(f"  ERROR fetching {url}: {e}")
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    bailiffs = []

    # Find all tables and pick the one with bailiff data
    table = None
    for t in soup.find_all("table"):
        headers_row = t.find("tr")
        if headers_row:
            header_text = headers_row.get_text(strip=True).lower()
            if "фио" in header_text or "№" in header_text or "лицен" in header_text:
                table = t
                break

    if not table:
        # Fallback: take first table
        table = soup.find("table")

    if not table:
        print(f"  WARNING: No table found for {region_name}")
        return []

    rows = table.find_all("tr")
    for row in rows[1:]:  # skip header
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        texts = [c.get_text(separator=" ", strip=True) for c in cells]

        # Columns seen: №, ФИО, Номер лицензии, Адрес, Контакты
        entry = {
            "Область":          region_name,
            "№":                texts[0] if len(texts) > 0 else "",
            "ФИО":              texts[1] if len(texts) > 1 else "",
            "Номер лицензии":   texts[2] if len(texts) > 2 else "",
            "Адрес офиса":      texts[3] if len(texts) > 3 else "",
            "Контакты":         texts[4] if len(texts) > 4 else "",
        }
        # Skip completely empty rows
        if not any([entry["ФИО"], entry["Номер лицензии"]]):
            continue
        bailiffs.append(entry)

    return bailiffs


def main():
    all_bailiffs = []

    for region_slug, region_name in REGIONS:
        print(f"Fetching: {region_name} ({region_slug})...")
        bailiffs = parse_region(region_slug, region_name)
        print(f"  Found {len(bailiffs)} bailiffs")
        all_bailiffs.extend(bailiffs)
        time.sleep(0.7)  # polite delay

    print(f"\nTotal bailiffs scraped: {len(all_bailiffs)}")

    if not all_bailiffs:
        print("No data collected.")
        return

    output_file = "registry/bailiffs.json.gz"
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    records = [[
        item["Область"], item["№"], item["ФИО"], item["Номер лицензии"],
        item["Адрес офиса"], item["Контакты"],
    ] for item in all_bailiffs]
    document = {
        "format": "zakonexpert.registry.v1",
        "entity": "bailiffs",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": BASE_URL,
        "records": records,
    }
    with gzip.open(output_file, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(document, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Saved to {output_file}")


if __name__ == "__main__":
    main()
