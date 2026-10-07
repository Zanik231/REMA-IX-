# -*- coding: utf-8 -*-
"""
ПАРСЕР ЗЕМЕЛЬНЫХ УЧАСТКОВ (REMA)
=================================
Собирает ТОЛЬКО земельные участки на ПРОДАЖУ (не аренду) с трёх источников:

  1) tomsk.ru09  — раздел «Земля» (продажа):  /realty/?type=1&otype=5&deal_type=sale
  2) ЦИАН        — земельные участки:   /kupit-zemelniy-uchastok-tomskaya-oblast/
                                        /kupit-zemelniy-uchastok/
  3) Авито       — земельные участки (продажа): /tomskaya_oblast/zemelnye_uchastki/prodam-ASgBAgICAUSWA9oQ
                                        /tomsk/zemelnye_uchastki/prodam-ASgBAgICAUSWA9oQ

Особенности:
  * ТОЛЬКО ПРОДАЖА: отсекаются объявления об аренде («снять», «аренда», «сдаётся»).
  * ru09: карточки на странице не содержат площадь — для ВСЕХ новых записей
    загружается детальная страница (площадь, цена, дата публикации, кадастр,
    коммуникации, описание). Свежие записи (parsed_at < 24 ч) не перечитываются.
  * Реальные даты публикации (раньше все записи писались «сегодня»).
  * Разбор района/населённого пункта из адреса (раньше всё «Томский район»).
  * Защита от жилой недвижимости: карточки с заголовком «Дом/Квартира/Таунхаус»
    без слов про участок отбрасываются.
  * Ранний выход из пагинации, если страница не приносит новых ссылок.

Запуск:
    python parser.py                     # полный сбор
    python parser.py --sources ru09,cian # только выбранные источники
    python parser.py --quick             # мало страниц (отладка)
    python parser.py --no-details        # без загрузки деталей ru09
    python parser.py --report-nonland    # показать записи, похожие на жильё
"""

import argparse
import asyncio
import concurrent.futures
import os
import re
import sys
import time
from datetime import date, datetime, timedelta

from bs4 import BeautifulSoup

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ──────────────────────────────── КОНФИГ ────────────────────────────────

DB_CONFIG = {
    "host": os.getenv("REMA_DB_HOST", "localhost"),
    "database": os.getenv("REMA_DB_NAME", "land_plots_db"),
    "user": os.getenv("REMA_DB_USER", "postgres"),
    "password": os.getenv("REMA_DB_PASSWORD", "126120qah111"),
    "port": int(os.getenv("REMA_DB_PORT", "5432")),
    "client_encoding": "UTF8",
}

# ─── Источники (только земельные участки) ───
RU09_LAND_URL = "http://www.tomsk.ru09.ru/realty/?type=1&otype=5&deal_type=sale"

CIAN_BASE = ("https://tomsk.cian.ru/cat.php?deal_type=sale&engine_version=2"
             "&object_type%5B0%5D=3&offer_type=suburban&region=4620")

# Гостевой лимит ЦИАН — 15 страниц на запрос. Сортировки меняют САМ набор
# объявлений (пересечение между выдачами минимально), поэтому собираем
# по нескольким сортировкам и дедуплицируем по URL.
CIAN_SEEDS = [
    CIAN_BASE,                               # без сортировки
    CIAN_BASE + "&sort=price_object_order",  # сначала дешёвые
    CIAN_BASE + "&sort=-price_object_order", # сначала дорогие
    CIAN_BASE + "&sort=pub_date",            # сначала свежие
]

AVITO_SEEDS = [
    "https://www.avito.ru/tomskaya_oblast/zemelnye_uchastki/prodam-ASgBAgICAUSWA9oQ",
    "https://www.avito.ru/tomsk/zemelnye_uchastki/prodam-ASgBAgICAUSWA9oQ",
]

PAGES_RU09 = 90      # в разделе ~812 объявлений (~10 на страницу)
PAGES_CIAN = 16      # гостевой лимит ЦИАН — 15 страниц, +1 на проверку стопа
PAGES_AVITO = 15     # на каждый seed

HTTP_TIMEOUT = 12
RETRY_ATTEMPTS = 3
RETRY_BACKOFF = 2.0
SLEEP_BETWEEN_RU09 = 0.15
SLEEP_BETWEEN_CIAN = 1.0
SLEEP_BETWEEN_AVITO = 1.2

# Детальные страницы ru09 (площадь/дата/кадастр есть только там)
FETCH_RU09_DETAILS = True
RU09_DETAIL_THREADS = 3
RU09_DETAIL_SLEEP = 0.1
DETAIL_FRESH_HOURS = 24       # не перечитывать записи младше N часов
MAX_EMPTY_PAGES = 2           # стоп после N страниц без новых ссылок

CIAN_REGION = 5016

# ─── Флаги разовой чистки ───
CLEAN_DUPLICATES_ON_START = False   # True — убрать дубли по URL (разовая чистка)
REMOVE_DEAD_LINKS = False           # ⚠️ медленно: 1 HTTP-запрос на URL
DEAD_LINK_CHECK_LIMIT = 300

MONTHS_MAP = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
    "мая": 5, "июня": 6, "июля": 7, "августа": 8,
    "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}
MONTHS_SHORT = {
    "янв": 1, "фев": 2, "мар": 3, "апр": 4, "мая": 5, "июн": 6,
    "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
}

# Ключевые слова «это жильё, а не участок» (для отсева и отчёта)
RE_HOUSING_WORD = re.compile(
    r"\b(квартир|комнат|таунхаус|апартамент|студия|дуплекс)\b", re.IGNORECASE
)
RE_HOUSING_TITLE = re.compile(
    r"^\s*(?:продается|продам|продадут|сдаётся|сдается|купить)?\s*"
    r"(?:дома|дом|коттедж|дача)\b",
    re.IGNORECASE,
)
# Признаки земельного участка в заголовке (без «сот» — у домов тоже есть соты)
RE_LAND_WORD = re.compile(
    r"участ|земельн|землю|земли|земл\b|снт|днт|лпх|ижс", re.IGNORECASE
)

RE_CADASTRAL = re.compile(r"\d{2}\s*:\s*\d{2}\s*:\s*\d{4,7}\s*:\s*\d{3,4}")


# ──────────────────────── URL-УТИЛИТЫ ────────────────────────


def normalize_url(url):
    """
    Убирает трекинг-параметры (?context=..., ?utm_...) из URL.
    Нужно для дедупликации Avito/ЦИАН, у которых context меняется
    при каждом запросе.

    ВАЖНО: URL ru09 не трогаем — там query-параметры это и есть ID
    объявления (?subaction=detail&id=5212998).
    """
    if not url:
        return url
    if "tomsk.ru09.ru" in url:
        return url
    parts = re.split(r"[?#]", url, maxsplit=1)
    return parts[0]


# ──────────────────────── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ────────────────────────


def sanitize_text(text, limit=None):
    if not text:
        return ""
    s = re.sub(r"\s+", " ", str(text)).strip()
    return s[:limit] if limit else s


def to_float(value):
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return float(value)
        s = re.sub(r"[^\d.,]", "", str(value)).replace(",", ".")
        if s.count(".") > 1:
            s = s.replace(".", "")
        return float(s) if s else None
    except (ValueError, TypeError):
        return None


def now_iso():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_iso():
    return datetime.now().strftime("%Y-%m-%d")


# ──────────────── ДАТА ПУБЛИКАЦИИ ────────────────


def _date_to_iso(y, m, d):
    try:
        obj = date(int(y), int(m), int(d))
    except ValueError:
        return None
    if obj > date.today():          # «15 сен» без года в 마ежсезонье
        try:
            obj = obj.replace(year=obj.year - 1)
        except ValueError:
            return None
    return obj.isoformat()


def parse_published_date(text):
    """
    Понимает:
      «Опубликовано: 08 сентября 2026», «25 сентября 2026»,
      «15 сен, 05:48», «3 дня назад», «2 недели назад»,
      «сегодня», «вчера».
    Возвращает ISO-дату или None.
    """
    if not text:
        return None
    t = str(text).lower()

    # 08 сентября 2026 / 25 сентября 2026
    m = re.search(
        r"(\d{1,2})\s+("
        + "|".join(MONTHS_MAP)
        + r")\s+(\d{4})",
        t,
    )
    if m:
        return _date_to_iso(m.group(3), MONTHS_MAP[m.group(2)], m.group(1))

    # 15 сен / 15 сен, 2026 (короткие месяцы)
    m = re.search(
        r"(\d{1,2})\s+("
        + "|".join(MONTHS_SHORT)
        + r")[а-я]*\.?\s*,?\s*(\d{4})?",
        t,
    )
    if m:
        return _date_to_iso(m.group(3) or date.today().year,
                            MONTHS_SHORT[m.group(2)], m.group(1))

    # N дней/недель/месяцев назад
    m = re.search(r"(\d+)\s*(день|дня|дней|недел|месяц|месяцев|месяца)\w*\s*назад", t)
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        if unit.startswith("недел"):
            delta = timedelta(weeks=n)
        elif unit.startswith("месяц"):
            delta = timedelta(days=30 * n)
        else:
            delta = timedelta(days=n)
        return (date.today() - delta).isoformat()

    if "сегодня" in t:
        return today_iso()
    if "вчера" in t:
        return (date.today() - timedelta(days=1)).isoformat()

    return None


# ──────────────── АДРЕС / РАЙОН / НАСЕЛЁННЫЙ ПУНКТ ────────────────


# Районы Томской области и Томска (для валидации найденного района)
KNOWN_DISTRICTS = {
    "Асиновский", "Бакчарский", "Верхнекетский", "Кожевниковский",
    "Молчановский", "Парабельский", "Первомайский", "Шегарский",
    "Томский", "Зырянский", "Александровский", "Городищенский",
    "Кировский", "Советский", "Ленинский", "Октябрьский",
    "Дзержинский", "Калининский", "Алексеевский", "Белый Яр",
}


def extract_district(text):
    """
    Район из текста: «Ленинский район», «р-н Кировский», «Кировский р-н».
    Возвращает None, если не найден или не входит в список известных районов.
    """
    if not text:
        return None
    t = str(text)

    candidates = []

    m = re.search(r"\bр-н\s+([А-ЯЁ][а-яё]+)", t)          # р-н Кировский
    if m:
        candidates.append(m.group(1))

    m = re.search(r"\b([А-ЯЁ][а-яё]+)\s+р-н\b", t)          # Кировский р-н
    if m:
        candidates.append(m.group(1))

    for m in re.finditer(r"\b([А-ЯЁ][а-яё]+)\s+район\b", t):  # Ленинский район
        candidates.append(m.group(1))

    for name in candidates:
        if name in KNOWN_DISTRICTS:
            return f"{name} район"

    # Населённые пункты Томской области (если район не назван явно)
    for d in sorted(KNOWN_DISTRICTS):
        if f"{d.lower()} район" in t.lower():
            return f"{d} район"

    return None


def extract_locality(address):
    """Населённый пункт из адреса: «пос. Зональная станция», «с. Дзержинское»…"""
    if not address:
        return None
    m = re.search(
        r"\b(город|г\.|поселок|пос\.|п\.|село|с\.|деревня|д\.|ст\.|СТ|СНТ)\s*([А-Яа-яЁё0-9][^,;/]{0,60})",
        address,
    )
    if m:
        kind, name = m.group(1), m.group(2)
        # отрезаем мусор: «… Томский район», «… 12 сот», «… улица Ленина»,
        # «…) 6», «… "Ветеран»
        name = re.split(
            r"\s+район\b|\s+ул\.|\s+улица|\s+\d+(?:[.,]\d+)?\s+сот|\s+\d+\s+т\.р"
            r"|\(|\"",
            name,
        )[0]
        name = re.sub(r"\s*[).\"']+$", "", name.strip(" .,;\"'"))
        # «ул. Молодежная», «141А» — не населённый пункт
        if len(name) < 3 or name[0].isdigit() or name.lower().startswith(
            ("ул.", "улица", "пер.", "проспект")
        ):
            return None
        kind = "г." if kind in ("город", "г.", "г") else kind
        return f"{kind} {name}".strip()

    # «Томск, улица Ленина» → «г. Томск»
    m = re.match(r"^\s*([А-Яа-яЁё-]+)\s*,", address)
    if m and len(m.group(1)) > 2:
        return f"г. {m.group(1)}"

    return None


def extract_category(text):
    t = str(text).lower()
    if any(k in t for k in ["сельхоз", "снт", "днт", "садовод"]):
        return "земли сельскохозяйственного назначения"
    if any(k in t for k in ["пром", "производ"]):
        return "земли промышленности"
    return "земли населённых пунктов"


def extract_vri(text):
    t = str(text).lower()
    vri = []
    if "ижс" in t:
        vri.append("ИЖС")
    if "лпх" in t:
        vri.append("ЛПХ")
    if any(k in t for k in ["садовод", "снт", "дач"]):
        vri.append("садоводство")
    if any(k in t for k in ["фермер", "крестьянск", "кфх"]):
        vri.append("фермерское хозяйство")
    if any(k in t for k in ["пром", "коммерч"]):
        vri.append("коммерческое использование")
    return ", ".join(vri) if vri else "ИЖС"


def check_feature(text, keywords):
    """Возвращает True/False для BOOLEAN-колонок в БД."""
    t = str(text).lower()
    return any(k in t for k in keywords)


def extract_cadastral(text):
    m = RE_CADASTRAL.search(str(text or ""))
    if not m:
        return None
    return ":".join(part.strip() for part in m.group(0).split(":"))



def is_rental(title, full_text=""):
    """
    True, если объявление — это аренда (снять/сдаётся), а не продажа.
    Отсекаем объявления об аренде земельных участков.
    """
    t = str(title or "").lower()
    ft = str(full_text or "").lower()
    combined = f"{t} {ft}"
    
    # Явные признаки аренды
    rental_keywords = [
        "аренда", "снять", "сдаётся", "сдается", "сдам", "сдаю",
        "арендодатель", "арендатор", "помесячно", "в месяц",
        "за месяц", "ежемесячно", "арендная плата"
    ]
    
    for keyword in rental_keywords:
        if keyword in combined:
            # Но если есть слово "продажа" или "продам" — это продажа
            if any(sale_word in combined for sale_word in ["продажа", "продам", "продается", "продаю"]):
                continue
            return True
    
    return False

def looks_like_housing(title, full_text=""):
    """
    True, если карточка — это жильё (дом/квартира/таунхаус), а не земельный
    участок. Заголовки вида «Продам земельный участок…», «Участок, 12 сот.»
    проходят; «Продается дом 54 м²» — нет.
    """
    t = str(title or "").strip()
    if RE_HOUSING_WORD.search(t) and not RE_LAND_WORD.search(t):
        return True
    if RE_HOUSING_TITLE.match(t) and not RE_LAND_WORD.search(t):
        return True
    # совсем без упоминания земли/участка — жильё
    ft = str(full_text or "")
    if ft and not RE_LAND_WORD.search(ft) and RE_HOUSING_WORD.search(ft):
        return True
    return False


def clip(value, limit):
    """Усечение до лимита VARCHAR-колонки (страховка от StringDataRightTruncation)."""
    if value is None:
        return None
    s = str(value)
    return s if len(s) <= limit else s[:limit]


def build_row(*, source, url, date_published, district, locality, address,
              price, area, category, vri, cadastral, gas, electricity, water,
              house, description, contact):
    price_unit = round(price / area, 2) if (price and area and area > 0) else None
    return (
        clip(source, 50), url, date_published or today_iso(), now_iso(),
        clip("Томская область", 100),
        clip(district or "Томский район", 100), clip(locality, 200), address,
        price, price_unit, area, clip("сотка", 20),
        clip(category, 200), clip(vri, 200), clip(cadastral, 50),
        gas, electricity, water, house,
        description, clip(contact, 200),
    )


# ──────────────────────── ОБЩИЕ HTTP-ХЕЛПЕРЫ ────────────────────────


def _fetch_with_retry(session, url, headers):
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            r = session.get(url, headers=headers, timeout=HTTP_TIMEOUT)
            if r.status_code == 200:
                try:
                    r.encoding = r.apparent_encoding
                except Exception:
                    pass
                return r.text
            if r.status_code in (403, 404, 429):
                print(f"[HTTP {r.status_code}] {url}")
                return None
        except Exception as e:
            print(f"[retry {attempt}/{RETRY_ATTEMPTS}] {url} -> {e}")
            time.sleep(RETRY_BACKOFF * attempt)
    return None


# ══════════════════════════════════════════════════════════════════════
# Поток 1: tomsk.ru09 — раздел «Земля»
# ══════════════════════════════════════════════════════════════════════

RU09_ITEM_SELECTORS = (
    "tr.realty_ad_text_3",
    "div.special_item_wrapper",
    "div.slidebox_frame",
)


def _ru09_detail_urls(max_pages):
    """Собирает уникальные URL детальных страниц со страниц раздела."""
    import requests

    session = requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
    headers = {}
    found = {}          # url -> текст карточки (запасной вариант)
    empty_streak = 0

    for p in range(1, max_pages + 1):
        url = f"{RU09_LAND_URL}&page={p}" if p > 1 else RU09_LAND_URL
        text = _fetch_with_retry(session, url, headers)
        if not text:
            break
        soup = BeautifulSoup(text, "html.parser")

        new_on_page = 0
        for selector in RU09_ITEM_SELECTORS:
            for item in soup.select(selector):
                a = item.find("a", href=re.compile(r"subaction=detail"))
                if not a:
                    continue
                m = re.search(r"id=(\d+)", a["href"])
                if not m:
                    continue
                href = normalize_url(
                    a["href"] if a["href"].startswith("http")
                    else f"http://www.tomsk.ru09.ru{a['href']}"
                )
                if href in found:
                    continue
                found[href] = sanitize_text(item.get_text(" ", strip=True))
                new_on_page += 1

        # страховка: ссылки вне известных контейнеров
        for a in soup.find_all("a", href=re.compile(r"subaction=detail.*id=\d+")):
            href = normalize_url(
                a["href"] if a["href"].startswith("http")
                else f"http://www.tomsk.ru09.ru{a['href']}"
            )
            if href not in found:
                found[href] = sanitize_text(a.get_text(" ", strip=True))
                new_on_page += 1

        print(f"[ru09] стр.{p}: новых ссылок +{new_on_page} (всего {len(found)})")

        empty_streak = empty_streak + 1 if new_on_page == 0 else 0
        if empty_streak >= MAX_EMPTY_PAGES:
            print("[ru09] страницы без новых ссылок — стоп.")
            break
        time.sleep(SLEEP_BETWEEN_RU09)

    return found


def _load_fresh_ru09_urls():
    """URL ru09, детальные страницы которых уже читались недавно."""
    import psycopg2

    fresh = set()
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT source_url FROM land_plots_report "
                "WHERE source = 'tomsk.ru09' AND parsed_at > %s;",
                (datetime.now() - timedelta(hours=DETAIL_FRESH_HOURS),),
            )
            fresh = {row[0] for row in cur.fetchall()}
        conn.close()
    except Exception as e:
        print(f"[ru09] не удалось получить свежие URL из БД: {e}")
    return fresh


def _parse_ru09_detail(html, url, card_text):
    """Разбирает детальную страницу ru09 → строка для БД (или None)."""
    soup = BeautifulSoup(html, "html.parser")
    text = sanitize_text(soup.get_text(" ", strip=True), 4000)

    if re.search(r"объявление\s+не\s+найдено|страница\s+не\s+найдена", text, re.I):
        return None
    if re.search(r"статус:\s*(снят|удалён|архив)", text, re.I):
        return None

    ctx = f"{card_text} {text}"

    if looks_like_housing(text[:400], ctx):
        return None

    # ── Заголовок ──
    h1 = soup.find("h1")
    title = sanitize_text(h1.get_text(" ", strip=True)) if h1 else ""

    # Только продажа: отсекаем аренду
    if is_rental(title, ctx):
        return None

    # ── Площадь: «Площадь участка 20 сот» ──
    area = None
    m = re.search(r"Площадь\s+участка[^0-9]{0,30}(\d+(?:[.,]\d+)?)", text, re.I)
    if m:
        area = to_float(m.group(1))
    if area is None:
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*сот", ctx, re.I)
        if m:
            area = to_float(m.group(1))
    if area is None:
        return None                      # без площади запись не нужна

    # ── Цена: «Объявление № 3203768 2 500 000 руб.» ──
    price = None
    m = re.search(r"Объявление\s+№\s*\d+\s+([\d\s\xa0]+?)\s*руб", text)
    if m:
        price = to_float(m.group(1))
    if price is None:
        m = re.search(r"Цена[^0-9]{0,30}([\d\s\xa0]{3,})\s*(?:руб|₽)", text)
        if m:
            price = to_float(m.group(1))
    if price is None:
        m = re.search(r"(\d[\d\s\xa0]{2,})\s*(?:т\.?\s*р\.?|тыс\.?\s*руб)", ctx, re.I)
        if m:
            v = to_float(m.group(1))
            price = v * 1000 if v and v < 100000 else v
    if price is None:
        m = re.search(r"(\d[\d\s\xa0]{4,})\s*(?:руб|₽)", ctx)
        if m:
            price = to_float(m.group(1))

    # ── Адрес и район: «Земля пос. ЛПК 2-й Ленинский район Площадь участка» ──
    address, district = None, None
    m = re.search(
        r"Земля\s+(.+?)\s+([А-ЯЁ][а-яё]+)\s+район\s+Площадь\s+участка",
        text,
    )
    if m:
        address = m.group(1).strip()
        # район принимаем только из списка известных («Корнилово Томский
        # район» — это населённый пункт, а не район)
        if m.group(2) in KNOWN_DISTRICTS:
            district = f"{m.group(2)} район"
    if not address:
        # адрес из заголовка: «… по адресу пос. Петровский участок»
        m = re.search(r"по\s+адресу\s+([^.,]+(?:,\s*[^.,]+)?)", ctx)
        if m:
            address = m.group(1).strip()
    if not address:
        address = title or "Томская область"
    if not district:
        district = extract_district(ctx)

    locality = extract_locality(address) or extract_locality(title) or "г. Томск"

    # ── Дата публикации: «Опубликовано: 08 сентября 2026» ──
    date_published = None
    m = re.search(
        r"Опубликовано:?\s*(\d{1,2}\s+(?:" + "|".join(MONTHS_MAP) + r")\s+\d{4})",
        text,
        re.I,
    )
    if m:
        date_published = parse_published_date(m.group(1))
    if not date_published:
        date_published = parse_published_date(text)

    # ── Описание ──
    description = ""
    m = re.search(r"Описание\s+(.+?)(?:Контактное\s+лицо|Телефон|Объявление\s+№|$)",
                  text, re.S)
    if m:
        description = sanitize_text(m.group(1), 700)
    if not description:
        description = sanitize_text(card_text or text, 700)

    # ── Коммуникации / постройки ──
    com_line = ""
    m = re.search(r"(?:Есть\s+)?центральные\s+коммуникации:\s*([^.]+)", ctx, re.I)
    if m:
        com_line = m.group(1).lower()
    com_ctx = f"{com_line} {description}".lower()

    gas = "газ" in com_ctx or "газификац" in com_ctx
    electricity = any(k in com_ctx for k in ["электр", "свет", "квт", "220", "380"])
    water = any(k in com_ctx for k in ["водопровод", "скважин", "вода", "водоснабж"])
    house = any(k in com_ctx for k in ["дом", "домик", "баня", "гараж", "сарай", "фундамент"])

    # ── Контакт ──
    contact = None
    m = re.search(r"Контактное\s+лицо:\s*([^Т]{1,40}?)(?:\s*Телефон|$)", text)
    if m:
        contact = sanitize_text(m.group(1), 60)

    return build_row(
        source="tomsk.ru09", url=url,
        date_published=date_published,
        district=district, locality=locality, address=address,
        price=price, area=area,
        category=extract_category(ctx), vri=extract_vri(ctx),
        cadastral=extract_cadastral(ctx),
        gas=gas, electricity=electricity, water=water, house=house,
        description=description, contact=contact,
    )


def _ru09_detail_worker(item):
    url, card_text = item
    import requests

    session = requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
    try:
        html = _fetch_with_retry(session, url, {})
        if not html:
            return None
        row = _parse_ru09_detail(html, url, card_text)
        time.sleep(RU09_DETAIL_SLEEP)
        return row
    except Exception as e:
        print(f"[ru09] ошибка detail {url}: {e}")
        return None


def worker_ru09(max_pages=PAGES_RU09, fetch_details=FETCH_RU09_DETAILS):
    print("[Старт] Поток tomsk.ru09 (раздел «Земля»)...")
    found = _ru09_detail_urls(max_pages)
    if not found:
        print("[Финиш] tomsk.ru09: ссылок не найдено.")
        return []

    # Какие детальные страницы уже читаны недавно — их не перечитываем
    fresh = _load_fresh_ru09_urls() if fetch_details else set()
    to_fetch = {u: t for u, t in found.items() if u not in fresh}
    print(f"[ru09] всего ссылок {len(found)}, к загрузке деталей {len(to_fetch)} "
          f"(свежих в БД: {len(found) - len(to_fetch)})")

    rows = []
    if fetch_details and to_fetch:
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=RU09_DETAIL_THREADS
        ) as ex:
            for i, row in enumerate(
                ex.map(_ru09_detail_worker, to_fetch.items()), 1
            ):
                if row:
                    rows.append(row)
                if i % 50 == 0:
                    print(f"[ru09] деталей обработано {i}/{len(to_fetch)}, "
                          f"строк {len(rows)}")
    elif not fetch_details:
        # Запасной вариант без деталей: цена из карточки, без площади — пропуск
        for url, card_text in found.items():
            area_m = re.search(r"(\d+(?:[.,]\d+)?)\s*сот", card_text, re.I)
            price_m = re.search(
                r"(\d[\d\s\xa0]{2,})\s*(?:т\.?\s*р\.?|тыс\.?\s*руб)", card_text, re.I
            )
            if not (area_m and price_m):
                continue
            area = to_float(area_m.group(1))
            price = to_float(price_m.group(1)) * 1000
            rows.append(build_row(
                source="tomsk.ru09", url=url,
                date_published=parse_published_date(card_text) or today_iso(),
                district=extract_district(card_text),
                locality=extract_locality(card_text) or "г. Томск",
                address=card_text[:120],
                price=price, area=area,
                category=extract_category(card_text), vri=extract_vri(card_text),
                cadastral=extract_cadastral(card_text),
                gas=check_feature(card_text, ["газ", "газификац"]),
                electricity=check_feature(card_text, ["электр", "свет", "квт"]),
                water=check_feature(card_text, ["водопровод", "скважин", "вода"]),
                house=check_feature(card_text, ["дом", "домик", "баня"]),
                description=sanitize_text(card_text, 700),
                contact=None,
            ))

    print(f"[Финиш] tomsk.ru09: {len(rows)} объектов.")
    return rows


# ══════════════════════════════════════════════════════════════════════
# Поток 2: CIAN — земельные участки
# ══════════════════════════════════════════════════════════════════════


def _build_cian_row_from_html(card, now_str):
    title_el = card.select_one('[data-name="TitleComponent"]')
    title = sanitize_text(title_el.get_text(" ", strip=True)) if title_el else ""

    link = card.select_one('a[href*="/sale/suburban/"]')
    if not link:
        link = card.select_one('a[data-name="TitleComponent"]')
    if not link:
        return None

    href = link["href"]
    c_url = href if href.startswith("http") else f"https://tomsk.cian.ru{href}"
    c_url = normalize_url(c_url)   # ← убираем ?context=...

    c_text = sanitize_text(card.get_text(separator=" ", strip=True))

    price = None
    for sel in [
        '[data-mark="MainPrice"]',
        'span[color="text-primary-default"]',
        '[data-testid="price"]',
    ]:
        el = card.select_one(sel)
        if el:
            price = to_float(el.get_text())
            if price:
                break

    m_a = re.search(r"(\d+([.,]\d+)?)\s*сот", c_text, re.I)
    area = float(m_a.group(1).replace(",", ".")) if m_a else None

    addr = "Томская область"
    for sel in ['[data-name="GeoLabel"]', '[data-name="Geo"]', 'a[href*="/cat.php?"]']:
        el = card.select_one(sel)
        if el:
            t = el.get_text(strip=True)
            if t and len(t) > 3:
                addr = t
                break

    full_ctx = sanitize_text(f"{title} {addr} {c_text}", 700)

    # Только земельные участки: «Продается дом 54 м²», «Таунхаус» — мимо
    if looks_like_housing(title, full_ctx):
        return None
    # Только продажа: отсекаем аренду
    if is_rental(title, full_ctx):
        return None
    if area is None:
        return None                       # без площади аналитика не нужна

    district = extract_district(f"{addr} {full_ctx}") or "Томский район"
    locality = extract_locality(addr) or "г. Томск"
    date_published = parse_published_date(c_text) or today_iso()

    return build_row(
        source="cian", url=c_url,
        date_published=date_published,
        district=district, locality=locality, address=addr,
        price=price, area=area,
        category=extract_category(full_ctx), vri=extract_vri(full_ctx),
        cadastral=extract_cadastral(full_ctx),
        gas=check_feature(full_ctx, ["газ", "газификац"]),
        electricity=check_feature(full_ctx, ["электр", "свет", "квт", "220", "380"]),
        water=check_feature(full_ctx, ["водопровод", "скважин", "вода", "водоснабж"]),
        house=check_feature(full_ctx, ["дом", "домик", "баня"]),
        description=sanitize_text(full_ctx, 700),
        contact="Собственник на Циан",
    )


def worker_cian(max_pages=PAGES_CIAN, seeds=None):
    from curl_cffi import requests as cureq

    seeds = seeds or CIAN_SEEDS
    print("[Старт] Поток CIAN (земельные участки)...")
    session = cureq.Session(impersonate="chrome120")
    headers = {
        "Accept-Language": "ru-RU,ru;q=0.9",
        "Referer": "https://tomsk.cian.ru/",
    }
    now_str = now_iso()
    seen = set()
    rows = []

    for seed in seeds:
        empty_streak = 0
        for p in range(1, max_pages + 1):
            # URL с параметрами разделяем «&», без параметров — «?»
            sep = "&" if "?" in seed else "?"
            url = seed if p == 1 else f"{seed}{sep}p={p}"
            text = _fetch_with_retry(session, url, headers)
            if not text:
                break

            soup = BeautifulSoup(text, "html.parser")
            cards = soup.select(
                'article[data-name="CardComponent"], [data-testid="offer-card"]'
            )
            if not cards:
                print(f"[CIAN] {seed.split('/')[-2] or seed} стр.{p}: карточек нет, стоп.")
                break

            new = 0
            for card in cards:
                row = _build_cian_row_from_html(card, now_str)
                if not row:
                    continue
                if row[1] in seen:
                    continue
                seen.add(row[1])
                rows.append(row)
                new += 1

            print(f"[CIAN] стр.{p}: карточек {len(cards)}, новых {new} (всего {len(rows)})")

            empty_streak = empty_streak + 1 if new == 0 else 0
            if empty_streak >= MAX_EMPTY_PAGES:
                print("[CIAN] страницы без новых карточек — стоп по этому seed.")
                break
            time.sleep(SLEEP_BETWEEN_CIAN)

    print(f"[Финиш] CIAN: {len(rows)} объектов.")
    return rows


# ══════════════════════════════════════════════════════════════════════
# Поток 3: Avito — земельные участки
# ══════════════════════════════════════════════════════════════════════


def _build_avito_row(card, now_str):
    link_el = card.select_one('a[data-marker="item-title"]')
    if not link_el:
        return None
    href = link_el.get("href")
    c_url = f"https://www.avito.ru{href}" if href.startswith("/") else href
    c_url = normalize_url(c_url)   # ← убираем ?context=...
    title = sanitize_text(link_el.get_text(strip=True))

    price = None
    p_meta = card.select_one('meta[itemprop="price"]')
    if p_meta:
        price = to_float(p_meta.get("content"))
    if not price:
        p_box = card.select_one('[data-marker="item-price"]')
        if p_box:
            price = to_float(p_box.get_text())

    card_text = sanitize_text(card.get_text(" ", strip=True))
    full_ctx = sanitize_text(f"{title} {card_text}", 700)

    if looks_like_housing(title, full_ctx):
        return None
    # Только продажа: отсекаем аренду
    if is_rental(title, full_ctx):
        return None

    # Площадь: и в заголовке, и в параметрах карточки
    area = None
    m_a = re.search(r"(\d+(?:[.,]\d+)?)\s*сот", full_ctx, re.I)
    if m_a:
        area = to_float(m_a.group(1))
    if area is None:
        return None

    geo_el = None
    for sel in [
        '[itemprop="address"]',
        '[data-marker="item-address"]',
        'a[data-marker="item-address"]',
        '[class*="geo-root"]',
        '[class*="geo-"]',
    ]:
        geo_el = card.select_one(sel)
        if geo_el and len(geo_el.get_text(strip=True)) > 3:
            break
        geo_el = None

    if geo_el:
        addr = geo_el.get_text(strip=True)
    else:
        # Фолбэк: ищем адрес прямо в тексте карточки
        m_addr = re.search(
            r"(Томская область[,\s]+[^|]{0,80}|Томск[,\s]+[^|]{0,60})",
            card_text,
        )
        addr = m_addr.group(1).strip() if m_addr else "Томская область"

    district = extract_district(f"{addr} {full_ctx}") or "Томский район"
    locality = extract_locality(addr) or "г. Томск"
    date_published = parse_published_date(card_text) or today_iso()

    return build_row(
        source="avito", url=c_url,
        date_published=date_published,
        district=district, locality=locality, address=addr,
        price=price, area=area,
        category=extract_category(full_ctx), vri=extract_vri(full_ctx),
        cadastral=extract_cadastral(full_ctx),
        gas=check_feature(full_ctx, ["газ", "газификац"]),
        electricity=check_feature(full_ctx, ["электр", "свет", "квт", "220", "380"]),
        water=check_feature(full_ctx, ["водопровод", "скважин", "вода", "водоснабж"]),
        house=check_feature(full_ctx, ["дом", "домик", "баня"]),
        description=sanitize_text(full_ctx, 700),
        contact="Продавец на Авито",
    )


async def _async_worker_avito(max_pages=PAGES_AVITO, seeds=None):
    from playwright.async_api import async_playwright

    seeds = seeds or AVITO_SEEDS
    now_str = now_iso()
    rows = []
    seen = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx = await browser.new_context(
            locale="ru-RU", viewport={"width": 1366, "height": 768}
        )
        page = await ctx.new_page()

        for seed in seeds:
            empty_streak = 0
            for p_idx in range(1, max_pages + 1):
                try:
                    url = seed if p_idx == 1 else f"{seed}?p={p_idx}"
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_timeout(3000)
                    await page.mouse.wheel(0, 3000)
                    await page.wait_for_timeout(2000)

                    content = await page.content()

                    if "Доступ ограничен" in content or "Подтвердите" in content:
                        print("[Avito] IP заблокирован (доступ ограничен). "
                              "Пропускаю Avito, нужны прокси.")
                        break

                    soup = BeautifulSoup(content, "html.parser")
                    items = soup.select('div[data-marker="item"]')
                    if not items:
                        print(f"[Avito] стр.{p_idx}: карточек не найдено.")
                        break

                    new = 0
                    for card in items:
                        row = _build_avito_row(card, now_str)
                        if not row:
                            continue
                        if row[1] in seen:
                            continue
                        seen.add(row[1])
                        rows.append(row)
                        new += 1

                    print(f"[Avito] стр.{p_idx}: items {len(items)}, новых {new} "
                          f"(всего {len(rows)})")

                    empty_streak = empty_streak + 1 if new == 0 else 0
                    if empty_streak >= MAX_EMPTY_PAGES:
                        print("[Avito] страницы без новых карточек — стоп по этому seed.")
                        break

                    await page.wait_for_timeout(int(SLEEP_BETWEEN_AVITO * 1000))
                except Exception as e:
                    print(f"[Avito] Ошибка: {e}")
                    break

        await browser.close()
    return rows


def worker_avito(max_pages=PAGES_AVITO, seeds=None):
    print("[Старт] Поток Avito (земельные участки)...")
    rows = asyncio.run(_async_worker_avito(max_pages, seeds))
    print(f"[Финиш] Avito: {len(rows)} объектов.")
    return rows


# ──────────────────────── ЧИСТКА БД ────────────────────────


def clean_existing_duplicates(conn):
    """
    Удаляет дубли по нормализованному URL (оставляет самую старую строку)
    и нормализует оставшиеся URL (кроме ru09 — там query это ID).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) FROM (
                SELECT split_part(source_url, '?', 1) AS norm_url, COUNT(*) AS cnt
                FROM land_plots_report
                WHERE source != 'tomsk.ru09'
                GROUP BY split_part(source_url, '?', 1)
                HAVING COUNT(*) > 1
            ) t;
        """)
        dup_groups = cur.fetchone()[0]

        if dup_groups == 0:
            print("[Чистка] Существующих дублей не найдено.")
        else:
            print(f"[Чистка] Найдено {dup_groups} групп дублей. Удаляю...")
            cur.execute("""
                DELETE FROM land_plots_report a
                USING land_plots_report b
                WHERE a.id > b.id
                  AND split_part(a.source_url, '?', 1) = split_part(b.source_url, '?', 1)
                  AND a.source != 'tomsk.ru09'
                  AND b.source != 'tomsk.ru09';
            """)
            print(f"[Чистка] Удалено дублей: {cur.rowcount}")

        cur.execute("""
            UPDATE land_plots_report
            SET source_url = split_part(source_url, '?', 1)
            WHERE source_url LIKE '%?%'
              AND source != 'tomsk.ru09';
        """)
        if cur.rowcount:
            print(f"[Чистка] Нормализовано URL: {cur.rowcount}")

    conn.commit()


def report_nonland(conn):
    """Показывает записи, которые похожи на жильё (без удаления)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source, LEFT(description, 90)
            FROM land_plots_report
            WHERE description ~* '^(продается?|купить)?\\s*(дом|квартира|таунхаус|дача)\\b'
              AND description !~* 'участок|земельн|сот'
            ORDER BY id
            LIMIT 30;
        """)
        rows = cur.fetchall()
        cur.execute("""
            SELECT COUNT(*) FROM land_plots_report
            WHERE description ~* '^(продается?|купить)?\\s*(дом|квартира|таунхаус|дача)\\b'
              AND description !~* 'участок|земельн|сот';
        """)
        total = cur.fetchone()[0]
    print(f"\n[Отчёт] Записей, похожих на жильё: {total}")
    for r in rows:
        print(f"  #{r[0]} [{r[1]}] {r[2]}")


def remove_dead_links(conn, limit=DEAD_LINK_CHECK_LIMIT):
    """HEAD-проверка ссылок: 404/410/451 → удалить."""
    import requests as _requests

    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source, source_url
            FROM land_plots_report
            ORDER BY parsed_at DESC
            LIMIT %s;
        """, (limit,))
        candidates = cur.fetchall()

    if not candidates:
        print("[Ссылки] Нечего проверять.")
        return

    session = _requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    dead_ids = []
    print(f"[Ссылки] Проверяю {len(candidates)} URL...")
    for i, (id_, source, url) in enumerate(candidates, 1):
        try:
            r = session.head(url, timeout=8, allow_redirects=True)
            alive = r.status_code not in (404, 410, 451)
        except Exception:
            alive = True       # ошибку сети не считаем мёртвой ссылкой
        if not alive:
            dead_ids.append(id_)
            print(f"  [мёртвая] {url}")
        if i % 25 == 0:
            print(f"  ... проверено {i}/{len(candidates)}")

    if dead_ids:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM land_plots_report WHERE id = ANY(%s);",
                        (dead_ids,))
        conn.commit()
        print(f"[Ссылки] Удалено мёртвых: {len(dead_ids)}")
    else:
        print("[Ссылки] Мёртвых ссылок не найдено.")


# ──────────────────────── СОХРАНЕНИЕ В БД ────────────────────────


def dedupe_rows(rows):
    """Убирает дубликаты по нормализованному URL внутри одного запуска."""
    seen = {}
    for row in rows:
        url = normalize_url(row[1])
        if not url:
            continue
        new_row = list(row)
        new_row[1] = url
        seen[url] = tuple(new_row)
    return list(seen.values())


def save_to_db(rows):
    if not rows:
        print("Данные не получены — нечего сохранять.")
        return

    unique_rows = dedupe_rows(rows)
    skipped = len(rows) - len(unique_rows)
    if skipped:
        print(f"Внутренняя дедупликация: убрано {skipped} дублей URL.")

    query = """
        INSERT INTO land_plots_report (
            source, source_url, date_published, parsed_at, region, district,
            locality, address, price, price_per_unit, area, area_unit,
            category_land, vri, cadastral_number, has_gas, has_electricity,
            has_water, has_house, description, contact_name
        ) VALUES %s
        ON CONFLICT (source_url) DO UPDATE SET
            price           = EXCLUDED.price,
            price_per_unit  = EXCLUDED.price_per_unit,
            area            = EXCLUDED.area,
            district        = EXCLUDED.district,
            locality        = EXCLUDED.locality,
            address         = EXCLUDED.address,
            date_published  = EXCLUDED.date_published,
            category_land   = EXCLUDED.category_land,
            vri             = EXCLUDED.vri,
            cadastral_number = EXCLUDED.cadastral_number,
            has_gas         = EXCLUDED.has_gas,
            has_electricity = EXCLUDED.has_electricity,
            has_water       = EXCLUDED.has_water,
            has_house       = EXCLUDED.has_house,
            description     = EXCLUDED.description,
            contact_name    = EXCLUDED.contact_name,
            parsed_at       = EXCLUDED.parsed_at;
    """

    try:
        import psycopg2
        from psycopg2.extras import execute_values

        conn = psycopg2.connect(**DB_CONFIG)
    except Exception as e:
        raw = str(e)
        try:
            raw = raw.encode("latin-1").decode("cp1251")
        except Exception:
            pass
        print("НЕ УДАЛОСЬ ПОДКЛЮЧИТЬСЯ К БД:", raw)
        raise

    try:
        with conn:
            with conn.cursor() as cur:
                execute_values(cur, query, unique_rows)
        print(f"[V] Отправлено строк: {len(unique_rows)} "
              f"(новые вставлены, существующие обновлены).")
    except Exception as e:
        conn.rollback()
        raw = str(e)
        try:
            raw = raw.encode("latin-1").decode("cp1251")
        except Exception:
            pass
        print(f"[X] Ошибка БД, откат транзакции: {raw}")
        raise
    finally:
        conn.close()


# ──────────────────────── ОРКЕСТРАТОР ────────────────────────


def parse_args():
    ap = argparse.ArgumentParser(description="Парсер земельных участков REMA")
    ap.add_argument("--sources", default="ru09,cian,avito",
                    help="список источников: ru09,cian,avito")
    ap.add_argument("--quick", action="store_true",
                    help="мало страниц (отладка): ru09=2, cian=2, avito=1")
    ap.add_argument("--ru09-pages", type=int, default=PAGES_RU09)
    ap.add_argument("--cian-pages", type=int, default=PAGES_CIAN)
    ap.add_argument("--avito-pages", type=int, default=PAGES_AVITO)
    ap.add_argument("--no-details", action="store_true",
                    help="не загружать детальные страницы ru09")
    ap.add_argument("--clean", action="store_true",
                    help="разовая чистка дублей по URL перед сбором")
    ap.add_argument("--report-nonland", action="store_true",
                    help="показать записи, похожие на жильё, и выйти")
    return ap.parse_args()


def main():
    args = parse_args()
    start = time.time()

    if args.quick:
        args.ru09_pages = min(args.ru09_pages, 2)
        args.cian_pages = min(args.cian_pages, 2)
        args.avito_pages = min(args.avito_pages, 1)

    sources = {s.strip() for s in args.sources.split(",") if s.strip()}

    print("=" * 60)
    print("СБОР ЗЕМЕЛЬНЫХ УЧАСТКОВ:", ", ".join(sorted(sources)))
    print("=" * 60)
    print("Нажмите Ctrl+C для остановки (собранные данные будут сохранены).")

    import psycopg2

    # ─── Чистка / отчёт по БД ───
    if args.clean or args.report_nonland or REMOVE_DEAD_LINKS:
        print("\n[Этап] Подключение к БД...")
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            try:
                if args.report_nonland:
                    report_nonland(conn)
                if args.clean or CLEAN_DUPLICATES_ON_START:
                    clean_existing_duplicates(conn)
                if REMOVE_DEAD_LINKS:
                    remove_dead_links(conn)
            except Exception as e:
                print(f"[БД] Ошибка: {e}")
            finally:
                conn.close()
        except Exception as e:
            print(f"[БД] Не удалось подключиться: {e}")
        if args.report_nonland:
            return
        print()

    # ─── Сбор данных (параллельно) ───
    all_results = []
    jobs = {}
    if "ru09" in sources:
        jobs["ru09"] = (worker_ru09, (args.ru09_pages,),
                        {"fetch_details": FETCH_RU09_DETAILS and not args.no_details})
    if "cian" in sources:
        jobs["cian"] = (worker_cian, (args.cian_pages,), {})
    if "avito" in sources:
        jobs["avito"] = (worker_avito, (args.avito_pages,), {})

    # Флаг для остановки по Ctrl+C
    stop_requested = False

    def signal_handler(sig, frame):
        nonlocal stop_requested
        stop_requested = True
        print("\n[СТОП] Получен сигнал остановки (Ctrl+C), завершаю работу...")

    # Регистрируем обработчик сигнала
    import signal
    signal.signal(signal.SIGINT, signal_handler)

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs) or 1) as ex:
            futures = {
                ex.submit(fn, *a, **kw): name
                for name, (fn, a, kw) in jobs.items()
            }
            
            # Используем wait вместо as_completed для корректной обработки Ctrl+C
            while not stop_requested:
                done, not_done = concurrent.futures.wait(
                    futures, 
                    timeout=0.5,
                    return_when=concurrent.futures.FIRST_COMPLETED
                )
                
                for fut in done:
                    name = futures[fut]
                    try:
                        data = fut.result()
                        all_results.extend(data)
                        print(f"[{name}] +{len(data)} записей.")
                    except Exception as exc:
                        print(f"[{name}] Ошибка потока: {exc}")
                
                # Если все задачи завершены — выходим
                if not not_done:
                    break

        if not stop_requested:
            print(
                f"\nСбор завершён за {round(time.time() - start, 1)} сек. "
                f"Собрано: {len(all_results)}."
            )
        save_to_db(all_results)
    except KeyboardInterrupt:
        pass  # Уже обработано в signal_handler
    finally:
        elapsed = round(time.time() - start, 1)
        if stop_requested:
            print(f"\n[СТОП] Остановлено пользователем через {elapsed} сек.")
            if all_results:
                print(f"[СТОП] Сохраняю {len(all_results)} собранных записей...")
                save_to_db(all_results)
            else:
                print("[СТОП] Нет данных для сохранения.")
            print("[СТОП] Работа завершена.")


if __name__ == "__main__":
    main()
