from curl_cffi import requests as cureq
from bs4 import BeautifulSoup

session = cureq.Session(impersonate="chrome120")
url = ("https://tomsk.cian.ru/cat.php?deal_type=sale&engine_version=2"
       "&offer_type=suburban&region=5016&type=4")
r = session.get(url, headers={
    "Accept-Language": "ru-RU,ru;q=0.9",
    "Referer": "https://tomsk.cian.ru/",
}, timeout=15)
html = r.text

print("Статус:", r.status_code)
print("Длина HTML:", len(html))

soup = BeautifulSoup(html, "html.parser")

# 1. Ищем карточки по разным селекторам
print("\n--- Селекторы карточек ---")
for sel in [
    'article[data-name="CardComponent"]',
    'div[data-name="CardComponent"]',
    'div[data-name="OfferSnippet"]',
    'article[data-name="OfferSnippet"]',
    '[data-testid="offer-card"]',
    'div[data-testid="offer-card"]',
    'article',
]:
    n = len(soup.select(sel))
    print(f"{sel} → {n}")

# 2. Ищем ссылки
print("\n--- Ссылки ---")
for sel in [
    'a[href*="/suburban/deal/"]',
    'a[href*="/sale/suburban/"]',
    'a[href*="cian.ru/sale/suburban"]',
    'a[data-name="TitleComponent"]',
    'a[href*="/suburban/"]',
]:
    n = len(soup.select(sel))
    print(f"{sel} → {n}")

# 3. Что вообще за теги с data-name
print("\n--- Все data-name на странице (топ-20) ---")
from collections import Counter
names = Counter()
for el in soup.find_all(attrs={"data-name": True}):
    names[el["data-name"]] += 1
for name, cnt in names.most_common(20):
    print(f"{name}: {cnt}")

# 4. Пример первой ссылки, если есть
print("\n--- Примеры ссылок ---")
for a in soup.find_all("a", href=True)[:30]:
    href = a["href"]
    if "suburban" in href or "deal" in href:
        print(repr(href[:120]))