#!/usr/bin/env python3
"""Scraper for enis.kz notary list - all regions."""

import csv
import time
import requests
from bs4 import BeautifulSoup

REGIONS = [
    (1,  "Акмолинская область"),
    (2,  "Актюбинская область"),
    (3,  "Алматинская область"),
    (4,  "город Алматы"),
    (5,  "город Астана"),
    (6,  "Атырауская область"),
    (7,  "Восточно-Казахстанская область"),
    (8,  "Жамбылская область"),
    (9,  "Западно-Казахстанская область"),
    (10, "Карагандинская область"),
    (11, "Кызылординская область"),
    (12, "Костанайская область"),
    (13, "Мангистауская область"),
    (14, "Павлодарская область"),
    (15, "Северо-Казахстанская область"),
    (16, "город Шымкент"),
    (18, "Туркестанская область"),
    (19, "область Абай"),
    (20, "область Жетысу"),
    (21, "область Улытау"),
]

BASE_URL = "https://enis.kz/Notary/NotaryByChamber/{}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


def debug_page(region_id):
    """Print raw HTML snippet for debugging."""
    url = BASE_URL.format(region_id)
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.encoding = "utf-8"
    soup = BeautifulSoup(r.text, "html.parser")

    # Try to find table
    tables = soup.find_all("table")
    print(f"Tables found: {len(tables)}")
    if tables:
        t = tables[0]
        print("Table class:", t.get("class"))
        rows = t.find_all("tr")
        print(f"Rows in first table: {len(rows)}")
        if rows:
            print("Header row:", rows[0])
            if len(rows) > 1:
                print("First data row:", rows[1])
        return

    # Try divs with table-like structure
    print("\nNo tables found. Checking for other structures...")
    # Print a chunk of body
    body = soup.find("body")
    if body:
        print(body.prettify()[:3000])


def parse_region(region_id, region_name):
    """Parse all notaries for a given region."""
    url = BASE_URL.format(region_id)
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.encoding = "utf-8"
    except requests.RequestException as e:
        print(f"  ERROR fetching {url}: {e}")
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    notaries = []

    # Find the main notary table (class tbs0)
    table = soup.find("table", class_="tbs0")
    if not table:
        table = soup.find("table")
    if not table:
        print(f"  WARNING: No table found for region {region_name}")
        return []

    rows = table.find_all("tr")
    # Skip header row(s)
    for row in rows[1:]:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        texts = [c.get_text(separator=" ", strip=True) for c in cells]

        # Typical columns: №, ФИО, Номер лицензии, Дата выдачи, Адрес, Контакты, Режим работы
        entry = {
            "Область": region_name,
            "№": texts[0] if len(texts) > 0 else "",
            "ФИО": texts[1] if len(texts) > 1 else "",
            "Номер лицензии": texts[2] if len(texts) > 2 else "",
            "Дата выдачи": texts[3] if len(texts) > 3 else "",
            "Адрес офиса": texts[4] if len(texts) > 4 else "",
            "Контакты": texts[5] if len(texts) > 5 else "",
            "Режим работы": texts[6] if len(texts) > 6 else "",
        }
        notaries.append(entry)

    return notaries


def main():
    all_notaries = []
    for region_id, region_name in REGIONS:
        print(f"Fetching: {region_name} (ID={region_id})...")
        notaries = parse_region(region_id, region_name)
        print(f"  Found {len(notaries)} notaries")
        all_notaries.extend(notaries)
        time.sleep(0.5)  # polite delay

    print(f"\nTotal notaries scraped: {len(all_notaries)}")

    if not all_notaries:
        print("No data collected. Check debug output above.")
        return

    # Save to CSV
    output_file = "notaries_all_regions.csv"
    fieldnames = ["Область", "№", "ФИО", "Номер лицензии", "Дата выдачи", "Адрес офиса", "Контакты", "Режим работы"]
    with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_notaries)

    print(f"Saved to {output_file}")


if __name__ == "__main__":
    main()
