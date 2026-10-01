import asyncio
import concurrent.futures
import json
import re
import time
from datetime import datetime
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from curl_cffi import requests as cureq
from playwright.async_api import async_playwright
import psycopg2
from psycopg2.extras import execute_values
import requests

# ──────────────────────────────── КОНФИГ ────────────────────────────────

DB_CONFIG = {
    "host": "localhost",
    "database": "land_plots_db",
    "user": "postgres",
    "password": "126120qah111",
    "port": 5432,
    "client_encoding": "UTF8",
}

PAGES_RU09   = 30
PAGES_CIAN   = 20
PAGES_AVITO  = 8

HTTP_TIMEOUT       = 12
RETRY_ATTEMPTS     = 3
RETRY_BACKOFF      = 2.0
SLEEP_BETWEEN_RU09 = 0.15
SLEEP_BETWEEN_CIAN = 1.0
SLEEP_BETWEEN_AVITO = 1.2

CIAN_REGION = 5016   # Томская область

# ─── Флаги разовой чистки (поставьте False после первого запуска) ───
CLEAN_DUPLICATES_ON_START = True    # убрать уже существующие дубли
REMOVE_DEAD_LINKS         = False   # ⚠️ медленно: 1 HTTP-запрос на URL
DEAD_LINK_CHECK_LIMIT     = 300     # сколько проверять за раз (если включено)

MONTHS_MAP = {
    "января": "01", "февраля": "02", "марта": "03",
    "апреля": "04", "мая": "05", "июня": "06",
    "июля": "07", "августа": "08", "сентября": "09",
    "октября": "10", "ноября": "11", "декабря": "12",
}

# ──────────────────────── URL-УТИЛИТЫ (NEW) ────────────────────────


def normalize_url(url):
    """
    Убирает трекинг-параметры (?context=..., ?utm_...) из URL.
    Нужно для дедупликации Avito, у которого context меняется
    при каждом запросе.

    ВАЖНО: URL ru09 не трогаем — там query-параметры это и есть ID
    объявления (?subaction=detail&id=5212998).
    """
    if not url:
        return url
    if "tomsk.ru09.ru" in url:
        return url
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


# ──────────────────────── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ────────────────────────


def sanitize_text(text, limit=None):
    if not text:
        return ""
    s = re.sub(r"\s+", " ", str(text)).strip()
    return s[:limit] if limit else s


def clean_district(val):
    return re.sub(r"(ском|ом|ий)$", "ский район", val.strip()) if val else None


def extract_locality(address):
    if not address:
        return "г. Томск"
    m = re.search(
        r"(село|пос\.|деревня|д\.|п\.|с\.|ст\.|ст\b)\s*([^,]+)",
        address,
        re.IGNORECASE,
    )
    return f"{m.group(1)} {m.group(2).strip()}" if m else "г. Томск"


def extract_district(address):
    if not address:
        return "Томский район"
    m = re.search(r"([А-Яа-я]+(?:\s+[А-Яа-я]+)?)\s+р-н", address, re.IGNORECASE)
    if m:
        return clean_district(m.group(1))
    for d in ["Кировский", "Советский", "Ленинский", "Октябрьский"]:
        if d.lower() in address.lower():
            return f"{d} район"
    return "Томский район"


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
    if any(k in t for k in ["пром", "коммерч"]):
        vri.append("коммерческое использование")
    return ", ".join(vri) if vri else "ИЖС"


def check_feature(text, keywords):
    """Возвращает True/False для BOOLEAN-колонок в БД."""
    t = str(text).lower()
    return any(k in t for k in keywords)


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


# ──────────────────────── Поток 1: tomsk.ru09 ────────────────────────


def worker_ru09(max_pages=PAGES_RU09):
    print("[Старт] Поток tomsk.ru09...")
    base_url = "http://www.tomsk.ru09.ru"
    catalog_url = "http://www.tomsk.ru09.ru/realty/?type=3"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/120.0.0.0 Safari/537.36"
    }
    session = requests.Session()
    now_str = now_iso()
    rows = []

    for p in range(1, max_pages + 1):
        url = f"{catalog_url}&page={p}"
        text = _fetch_with_retry(session, url, headers)
        if not text:
            break
        soup = BeautifulSoup(text, "html.parser")

        for a in soup.find_all("a", href=True):
            if "subaction=detail" not in a["href"] or "id=" not in a["href"]:
                continue
            card_url = normalize_url(urljoin(base_url, a["href"]))
            parent = a.find_parent("tr") or a.find_parent("div")
            raw_text = parent.get_text(separator=" ", strip=True) if parent else ""
            low_t = raw_text.lower()

            if any(bad in low_t for bad in
                   ["квартир", "комнатн", "кухня", "этаж", "панель"]):
                continue

            m_area = re.search(r"(\d+([.,]\d+)?)\s*сот", raw_text, re.IGNORECASE)
            if not m_area:
                continue
            area = float(m_area.group(1).replace(",", "."))

            price = None
            m_price = re.search(
                r"(\d[\d\s]{2,})\s*(тыс\.?\s*руб|т\.р|руб)",
                raw_text,
                re.IGNORECASE,
            )
            if m_price:
                cleaned = float(re.sub(r"[^\d]", "", m_price.group(1)))
                price = (cleaned * 1000
                         if any(x in m_price.group(2).lower()
                                for x in ["тыс", "т.р"])
                         else cleaned)

            price_unit = round(price / area, 2) if (price and area) else None
            addr = a.get_text(strip=True) or "Томская область"

            rows.append((
                "tomsk.ru09", card_url, today_iso(), now_str, "Томская область",
                extract_district(raw_text), extract_locality(addr), addr,
                price, price_unit, area, "сотка",
                extract_category(raw_text), extract_vri(raw_text), None,
                check_feature(raw_text, ["газ", "газификац"]),
                check_feature(raw_text, ["электр", "свет", "квт"]),
                check_feature(raw_text, ["водопровод", "скважин", "вода"]),
                check_feature(raw_text, ["дом", "домик", "баня"]),
                sanitize_text(raw_text, 400), "Собственник на ru09",
            ))
        time.sleep(SLEEP_BETWEEN_RU09)

    print(f"[Финиш] tomsk.ru09: {len(rows)} объектов.")
    return rows


# ──────────────────────── Поток 2: CIAN ────────────────────────


def worker_cian(max_pages=PAGES_CIAN):
    print("[Старт] Поток CIAN...")
    base_url = (
        f"https://tomsk.cian.ru/cat.php?deal_type=sale&engine_version=2"
        f"&offer_type=suburban&region={CIAN_REGION}&type=4"
    )
    session = cureq.Session(impersonate="chrome120")
    headers = {
        "Accept-Language": "ru-RU,ru;q=0.9",
        "Referer": "https://tomsk.cian.ru/",
    }
    now_str = now_iso()
    rows = []

    for p in range(1, max_pages + 1):
        text = _fetch_with_retry(session, f"{base_url}&p={p}", headers)
        if not text:
            break

        soup = BeautifulSoup(text, "html.parser")
        cards = soup.select(
            'article[data-name="CardComponent"], '
            '[data-testid="offer-card"]'
        )
        if not cards:
            print(f"[CIAN] стр.{p}: карточек не найдено, стоп.")
            break

        print(f"[CIAN] стр.{p}: HTML cards = {len(cards)}")
        for card in cards:
            row = _build_cian_row_from_html(card, now_str)
            if row:
                rows.append(row)

        time.sleep(SLEEP_BETWEEN_CIAN)

    print(f"[Финиш] CIAN: {len(rows)} объектов.")
    return rows


def _build_cian_row_from_html(card, now_str):
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
    price_unit = round(price / area, 2) if (price and area and area > 0) else None

    addr = "Томская область"
    for sel in [
        '[data-name="GeoLabel"]',
        '[data-name="Geo"]',
        'a[href*="/cat.php?"]',
    ]:
        el = card.select_one(sel)
        if el:
            t = el.get_text(strip=True)
            if t and len(t) > 3:
                addr = t
                break

    title_el = card.select_one('[data-name="TitleComponent"]')
    title = sanitize_text(title_el.get_text(strip=True)) if title_el else ""

    full_ctx = sanitize_text(f"{title} {addr} {c_text}")

    return (
        "cian", c_url, today_iso(), now_str, "Томская область",
        extract_district(addr), extract_locality(addr), addr,
        price, price_unit, area, "сотка",
        extract_category(full_ctx), extract_vri(full_ctx), None,
        check_feature(full_ctx, ["газ", "газификац"]),
        check_feature(full_ctx, ["электр", "свет", "квт", "220"]),
        check_feature(full_ctx, ["водопровод", "скважин", "вода"]),
        check_feature(full_ctx, ["дом", "домик", "баня"]),
        full_ctx[:500], "Собственник на Циан",
    )


# ──────────────────────── Поток 3: Avito ────────────────────────


async def _async_worker_avito(max_pages=PAGES_AVITO):
    base_url = "https://www.avito.ru/tomskaya_oblast/zemelnye_uchastki"
    now_str = now_iso()
    rows = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx = await browser.new_context(
            locale="ru-RU", viewport={"width": 1366, "height": 768}
        )
        page = await ctx.new_page()

        for p_idx in range(1, max_pages + 1):
            try:
                url = f"{base_url}?p={p_idx}" if p_idx > 1 else base_url
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

                print(f"[Avito] стр.{p_idx}: items = {len(items)}")
                for card in items:
                    row = _build_avito_row(card, now_str)
                    if row:
                        rows.append(row)

                await page.wait_for_timeout(int(SLEEP_BETWEEN_AVITO * 1000))
            except Exception as e:
                print(f"[Avito] Ошибка: {e}")
                break

        await browser.close()
    return rows


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

    m_a = re.search(r"(\d+([.,]\d+)?)\s*сот", title, re.I)
    area = float(m_a.group(1).replace(",", ".")) if m_a else None
    price_unit = round(price / area, 2) if (price and area and area > 0) else None

    geo_el = card.select_one('[class*="geo-root"]')
    addr = geo_el.get_text(strip=True) if geo_el else "Томская область"
    full_ctx = sanitize_text(f"{title} {addr}")

    return (
        "avito", c_url, today_iso(), now_str, "Томская область",
        extract_district(addr), extract_locality(addr), addr,
        price, price_unit, area, "сотка",
        extract_category(full_ctx), extract_vri(full_ctx), None,
        check_feature(full_ctx, ["газ", "газификац"]),
        check_feature(full_ctx, ["электр", "свет", "квт"]),
        check_feature(full_ctx, ["водопровод", "скважин", "вода"]),
        check_feature(full_ctx, ["дом", "домик", "баня"]),
        full_ctx[:500], "Продавец на Авито",
    )


def worker_avito(max_pages=PAGES_AVITO):
    print("[Старт] Поток Avito...")
    rows = asyncio.run(_async_worker_avito(max_pages))
    print(f"[Финиш] Avito: {len(rows)} объектов.")
    return rows


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


# ─────────────── ЧИСТКА БД: дубли и мёртвые ссылки (NEW) ───────────────


def clean_existing_duplicates(conn):
    """
    1. Удаляет строки, у которых нормализованный URL (без ?...) уже есть
       в другой строке — оставляет самую старую (min id).
    2. Нормализует все оставшиеся URL: убирает ?context=... и т.п.
       (кроме ru09 — там query-параметры это ID).

    Возвращает (сколько_удалено, сколько_нормализовано).
    """
    with conn.cursor() as cur:
        # 1. Сначала посмотрим сколько дублей
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
            # Удаляем дубли, оставляя строку с минимальным id в каждой группе
            cur.execute("""
                DELETE FROM land_plots_report a
                USING land_plots_report b
                WHERE a.id > b.id
                  AND split_part(a.source_url, '?', 1) = split_part(b.source_url, '?', 1)
                  AND a.source != 'tomsk.ru09'
                  AND b.source != 'tomsk.ru09';
            """)
            deleted = cur.rowcount
            print(f"[Чистка] Удалено дублей: {deleted}")

        # 2. Нормализуем оставшиеся URL (убираем query-параметры)
        cur.execute("""
            UPDATE land_plots_report
            SET source_url = split_part(source_url, '?', 1)
            WHERE source_url LIKE '%?%'
              AND source != 'tomsk.ru09';
        """)
        normalized = cur.rowcount
        if normalized:
            print(f"[Чистка] Нормализовано URL: {normalized}")

    conn.commit()


def validate_url_is_alive(url, session):
    """HEAD-запрос: живая ли ссылка. True = живая, False = мёртвая."""
    try:
        r = session.head(url, timeout=8, allow_redirects=True)
        return r.status_code not in (404, 410, 451)
    except Exception:
        # при ошибке сети считаем ссылку живой, чтобы не удалять зря
        return True


def remove_dead_links(conn, limit=DEAD_LINK_CHECK_LIMIT):
    """
    Проходит по ссылкам в БД, проверяет HEAD-запросом.
    Удаляет те, что отдают 404 / 410 / 451.
    """
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

    session = requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    dead_ids = []
    print(f"[Ссылки] Проверяю {len(candidates)} URL...")
    for i, (id_, source, url) in enumerate(candidates, 1):
        if not validate_url_is_alive(url, session):
            dead_ids.append(id_)
            print(f"  [мёртвая] {url}")
        if i % 25 == 0:
            print(f"  ... проверено {i}/{len(candidates)}")

    if dead_ids:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM land_plots_report WHERE id = ANY(%s);",
                (dead_ids,),
            )
        conn.commit()
        print(f"[Ссылки] Удалено мёртвых: {len(dead_ids)}")
    else:
        print("[Ссылки] Мёртвых ссылок не найдено.")


# ──────────────────────── СОХРАНЕНИЕ В БД ────────────────────────


def dedupe_rows(rows):
    """
    Убирает дубликаты по нормализованному URL внутри одного запуска.
    Также нормализует сам URL в строке.
    """
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
            category_land   = EXCLUDED.category_land,
            vri             = EXCLUDED.vri,
            has_gas         = EXCLUDED.has_gas,
            has_electricity = EXCLUDED.has_electricity,
            has_water       = EXCLUDED.has_water,
            has_house       = EXCLUDED.has_house,
            description     = EXCLUDED.description,
            parsed_at       = EXCLUDED.parsed_at;
    """

    try:
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


def main():
    start = time.time()
    print("=" * 60)
    print("ПАРАЛЛЕЛЬНЫЙ СБОР (tomsk.ru09 + CIAN + Avito)")
    print("=" * 60)

    # ─── Разовая чистка БД ───
    if CLEAN_DUPLICATES_ON_START or REMOVE_DEAD_LINKS:
        print("\n[Этап] Подключение к БД для чистки...")
        conn = psycopg2.connect(**DB_CONFIG)
        try:
            if CLEAN_DUPLICATES_ON_START:
                clean_existing_duplicates(conn)
            if REMOVE_DEAD_LINKS:
                remove_dead_links(conn)
        except Exception as e:
            print(f"[Чистка] Ошибка: {e}")
        finally:
            conn.close()
        print()

    # ─── Сбор данных ───
    all_results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        futures = {
            ex.submit(worker_ru09, PAGES_RU09): "ru09",
            ex.submit(worker_cian, PAGES_CIAN): "cian",
            ex.submit(worker_avito, PAGES_AVITO): "avito",
        }
        for fut in concurrent.futures.as_completed(futures):
            name = futures[fut]
            try:
                data = fut.result()
                all_results.extend(data)
                print(f"[{name}] +{len(data)} записей.")
            except Exception as exc:
                print(f"[{name}] Ошибка потока: {exc}")

    print(
        f"\nСбор завершён за {round(time.time() - start, 1)} сек. "
        f"Собрано: {len(all_results)}."
    )
    save_to_db(all_results)


if __name__ == "__main__":
    main()