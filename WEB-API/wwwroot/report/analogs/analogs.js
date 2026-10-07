(function () {

    const API = {
        find: "/api/analog/find"
    };

    // /api/analog/find отдаёт не больше 100 самых свежих объявлений (Take(100))
    const API_LIMIT = 100;

    const PER_PAGE = 4;

    // Границы совпадают с сегментацией /api/report/calculate (AreaAnalytics)
    const SEGMENTS = [
        { name: "До 30 соток", match: area => area < 30 },
        { name: "От 30 до 50 соток", match: area => area >= 30 && area <= 50 },
        { name: "Свыше 50 соток", match: area => area > 50 }
    ];

    // Значения колонки source, которые пишет парсер
    const SOURCES = {
        "cian": "ЦИАН",
        "avito": "Авито",
        "tomsk.ru09": "Tomsk.ru09"
    };

    const FEATURES = [
        { key: "hasGas", label: "Газ" },
        { key: "hasElectricity", label: "Электричество" },
        { key: "hasWater", label: "Вода" },
        { key: "hasHouse", label: "Постройки" }
    ];

    const RESULT_SECTIONS = [
        "summarySection",
        "statsSection",
        "segmentsSection",
        "resultsSection"
    ];

    const state = {
        items: [],
        stats: null,
        params: null,
        page: 1,
        requestId: 0
    };

    const $ = (id) => document.getElementById(id);

    const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
    const areaFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });


    /* =========================================================
    ФОРМАТИРОВАНИЕ
    ========================================================= */

    function isNumber(value) {
        return typeof value === "number" && isFinite(value);
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === "") return null;

        const number = Number(value);

        return isFinite(number) ? number : null;
    }

    function formatNumber(value) {
        return isNumber(value) ? numberFormat.format(value) : "—";
    }

    function formatPrice(value) {
        return isNumber(value) ? numberFormat.format(Math.round(value)) + " ₽" : "—";
    }

    function plural(count, one, few, many) {
        const mod10 = Math.abs(count) % 10;
        const mod100 = Math.abs(count) % 100;

        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
        return many;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function capitalize(text) {
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    }

    function isSotka(unit) {
        return !unit || /сот/i.test(unit);
    }

    function formatArea(area, unit) {
        if (!isNumber(area)) return "—";

        const value = areaFormat.format(area);

        if (!isSotka(unit)) return `${value} ${unit}`;

        // Для дробных значений — «12,5 сотки»
        return Number.isInteger(area)
            ? `${value} ${plural(area, "сотка", "сотки", "соток")}`
            : `${value} сотки`;
    }

    function formatDate(isoDate) {
        if (!isoDate) return "";

        const date = new Date(String(isoDate).slice(0, 10) + "T00:00:00");

        return isNaN(date) ? "" : date.toLocaleDateString("ru-RU");
    }

    function sourceLabel(source) {
        return SOURCES[String(source || "").toLowerCase()] || source || "—";
    }

    // Ссылки приходят из спарсенных данных — пропускаем только абсолютные http(s)
    function safeUrl(url) {
        if (!url) return null;

        try {
            const parsed = new URL(String(url));

            return parsed.protocol === "http:" || parsed.protocol === "https:"
                ? parsed.href
                : null;
        } catch {
            return null;
        }
    }


    /* =========================================================
    СТАТИСТИКА
    ========================================================= */

    function median(values) {
        if (!values.length) return null;

        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);

        return sorted.length % 2 === 0
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle];
    }

    function average(values) {
        return values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null;
    }

    function priceStats(items) {
        const prices = items
            .map(item => item.pricePerUnit)
            .filter(isNumber);

        return {
            count: items.length,
            priced: prices.length,
            min: prices.length ? Math.min(...prices) : null,
            max: prices.length ? Math.max(...prices) : null,
            average: average(prices),
            median: median(prices)
        };
    }

    function calculateStats(items) {
        return {
            ...priceStats(items),
            segments: SEGMENTS.map(segment => ({
                name: segment.name,
                ...priceStats(
                    items.filter(item => isNumber(item.area) && segment.match(item.area))
                )
            }))
        };
    }


    /* =========================================================
    API
    ========================================================= */

    async function readJson(response) {
        try {
            return await response.json();
        } catch {
            return null;
        }
    }

    // POST /api/analog/find → массив LandPlotsReport, отсортированный по дате публикации
    async function requestAnalogs(params) {
        const response = await fetch(API.find, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                region: params.region || null,
                district: params.district || null,
                minArea: params.minArea,
                maxArea: params.maxArea,
                minPricePerUnit: params.minPricePerUnit,
                maxPricePerUnit: params.maxPricePerUnit,
                categoryLand: params.categoryLand || null,
                vri: params.vri || null
            })
        });

        const data = await readJson(response);

        if (!response.ok) {
            throw new Error(
                data?.message || data?.title || `Сервер вернул ошибку ${response.status}`
            );
        }

        if (!Array.isArray(data)) {
            throw new Error("Сервер вернул ответ в неожиданном формате");
        }

        return data;
    }

    function normalizeItem(raw, index) {
        return {
            id: raw.id ?? index,
            order: index,
            source: raw.source || "",
            sourceUrl: safeUrl(raw.sourceUrl),
            datePublished: raw.datePublished || null,
            region: raw.region || "",
            district: raw.district || "",
            locality: raw.locality || "",
            address: raw.address || "",
            price: toNumber(raw.price),
            pricePerUnit: toNumber(raw.pricePerUnit),
            area: toNumber(raw.area),
            areaUnit: raw.areaUnit || "",
            category: capitalize(raw.categoryLand || ""),
            vri: raw.vri || "",
            features: FEATURES
                .filter(feature => raw[feature.key] === true)
                .map(feature => feature.label)
        };
    }


    /* =========================================================
    ПОИСК
    ========================================================= */

    let toastResetTimer;

    function notify(title, text, isError = false) {
        const toast = $("toast");
        const icon = $("toastIcon");

        toast?.classList.toggle("is-error", isError);

        if (icon) {
            icon.textContent = isError ? "!" : "✓";
        }

        if (typeof showToast === "function") {
            showToast(title, text, isError);
        }

        clearTimeout(toastResetTimer);
        toastResetTimer = setTimeout(() => {
            toast?.classList.remove("is-error");
            if (icon) icon.textContent = "✓";
        }, 3200);
    }

    function readNumber(id) {
        const value = $(id).value.trim();

        return value ? toNumber(value.replace(",", ".")) : null;
    }

    function checkRange(from, to, title) {
        if (from !== null && to !== null && from > to) {
            notify(title, "Значение «От» не может быть больше «До»", true);
            return false;
        }

        return true;
    }

    function readParams() {
        const params = {
            region: $("regionInput").value.trim(),
            district: $("districtInput").value.trim(),
            minArea: readNumber("areaFrom"),
            maxArea: readNumber("areaTo"),
            minPricePerUnit: readNumber("priceFrom"),
            maxPricePerUnit: readNumber("priceTo"),
            categoryLand: $("categoryFilter").value,
            vri: $("vriFilter").value
        };

        if (!checkRange(params.minArea, params.maxArea, "Неверная площадь")) return null;
        if (!checkRange(params.minPricePerUnit, params.maxPricePerUnit, "Неверная цена")) return null;

        return params;
    }

    let findButtonHtml = "";

    function setLoading(loading) {
        const button = $("findAnalogs");

        if (button) {
            button.disabled = loading;
            button.innerHTML = loading
                ? `<span class="search-button-icon">⌕</span> Поиск…`
                : findButtonHtml;
        }

        RESULT_SECTIONS.forEach(id => {
            $(id)?.classList.toggle("is-loading", loading);
        });
    }

    async function findAnalogs(options = {}) {
        const params = readParams();

        if (!params) return;

        const requestId = ++state.requestId;

        setLoading(true);

        try {
            const data = await requestAnalogs(params);

            if (requestId !== state.requestId) return;

            state.params = params;
            state.items = data.map(normalizeItem);
            state.stats = calculateStats(state.items);
            state.page = 1;

            applySort();
            renderAll();

            if (!options.silent) {
                const count = state.items.length;

                notify(
                    count ? "Аналоги подобраны" : "Аналоги не найдены",
                    count
                        ? `Найдено ${formatNumber(count)} ${plural(count, "объявление", "объявления", "объявлений")}`
                        : "Измените параметры поиска и попробуйте ещё раз",
                    !count
                );
            }

        } catch (error) {
            if (requestId !== state.requestId) return;

            const message = error instanceof TypeError
                ? "API недоступен. Проверьте, что сервер запущен."
                : error.message;

            notify("Не удалось подобрать аналоги", message, true);

            // Если удачного поиска ещё не было — показываем ошибку вместо пустого списка
            if (!state.params) {
                renderListMessage("!", "Не удалось загрузить аналоги", message);
            }

        } finally {
            if (requestId === state.requestId) {
                setLoading(false);
            }
        }
    }


    /* =========================================================
    СОРТИРОВКА
    ========================================================= */

    // Пустые значения всегда в конце, при равенстве — порядок API (сначала новые)
    function compareBy(key, direction) {
        return (a, b) => {
            const left = a[key];
            const right = b[key];

            if (left === right) return a.order - b.order;
            if (left === null) return 1;
            if (right === null) return -1;

            return (left - right) * direction || a.order - b.order;
        };
    }

    const SORTERS = {
        "newest": (a, b) => a.order - b.order,
        "price-asc": compareBy("pricePerUnit", 1),
        "price-desc": compareBy("pricePerUnit", -1),
        "area-asc": compareBy("area", 1),
        "area-desc": compareBy("area", -1)
    };

    function applySort() {
        const sorter = SORTERS[$("sortSelect")?.value] || SORTERS.newest;

        state.items.sort(sorter);
    }


    /* =========================================================
    ОТРИСОВКА
    ========================================================= */

    function renderAll() {
        renderLocation();
        renderSummary();
        renderSegments();
        renderCards();
    }

    function renderLocation() {
        const { district, region } = state.params;

        $("heroLocation").textContent = district || region || "Все территории";
    }

    function pricedCaption(stats) {
        if (!stats.count) return "по найденным объектам";

        return stats.priced === stats.count
            ? "по найденным объектам"
            : `по ${formatNumber(stats.priced)} из ${formatNumber(stats.count)} объектов с ценой`;
    }

    function renderSummary() {
        const stats = state.stats;
        const limited = stats.count >= API_LIMIT;

        $("foundCount").textContent = formatNumber(stats.count);
        $("foundLabel").textContent = plural(stats.count, "объявление", "объявления", "объявлений");
        $("resultsNote").hidden = !limited;

        $("statCount").textContent = formatNumber(stats.count);
        $("statCountCaption").textContent = limited
            ? "самых свежих — лимит выдачи API"
            : "в текущей выборке";

        $("statMin").textContent = formatPrice(stats.min);
        $("statMax").textContent = formatPrice(stats.max);
        $("statMinCaption").textContent = pricedCaption(stats);
        $("statMaxCaption").textContent = pricedCaption(stats);

        $("statAverage").textContent = formatPrice(stats.average);
        $("statMedian").textContent = `медиана — ${formatPrice(stats.median)}`;
    }

    function renderSegments() {
        $("segmentGrid").innerHTML = state.stats.segments.map((segment, index) => `
            <article class="segment-card${segment.priced ? "" : " is-empty"}">

                <div class="segment-top">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <b>${formatNumber(segment.count)} ${plural(segment.count, "объект", "объекта", "объектов")}</b>
                </div>

                <h3>${escapeHtml(segment.name)}</h3>

                <div class="segment-price">
                    <strong>${formatPrice(segment.average)}</strong>
                    <span>средняя за сотку</span>
                </div>

                <div class="segment-bottom">
                    <span>Медиана</span>
                    <strong>${formatPrice(segment.median)}</strong>
                </div>

            </article>
        `).join("");
    }

    function renderListMessage(icon, title, text) {
        $("analogsList").innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${escapeHtml(icon)}</div>
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(text)}</p>
            </div>
        `;

        updatePagination(0);
    }

    function itemAddress(item) {
        return item.address
            || [item.locality, item.district, item.region].filter(Boolean).join(", ")
            || "Адрес не указан";
    }

    // Отклонение цены за сотку от медианы текущей выборки
    function medianDeviation(item) {
        const base = state.stats.median;

        if (!isNumber(item.pricePerUnit) || !isNumber(base) || base <= 0 || state.stats.priced < 2) {
            return "";
        }

        const delta = Math.round((item.pricePerUnit - base) / base * 100);

        if (delta === 0) {
            return `<small class="median-deviation">на уровне медианы</small>`;
        }

        return `
            <small class="median-deviation ${delta > 0 ? "above" : "below"}">
                ${delta > 0 ? "↑" : "↓"} на ${Math.abs(delta)}% ${delta > 0 ? "выше" : "ниже"} медианы
            </small>
        `;
    }

    function renderCard(item, number) {
        const date = formatDate(item.datePublished);
        const unitLabel = isSotka(item.areaUnit) ? "сотка" : item.areaUnit;

        return `
            <article class="analog-card">

                <div class="analog-card-top">

                    <div class="analog-number">
                        ${String(number).padStart(2, "0")}
                    </div>

                    ${date ? `<span class="analog-date" title="Дата публикации">${escapeHtml(date)}</span>` : ""}

                </div>


                <h3>
                    ${isNumber(item.area) ? `Участок ${escapeHtml(formatArea(item.area, item.areaUnit))}` : "Земельный участок"}
                </h3>


                <div class="analog-address">
                    ${escapeHtml(itemAddress(item))}
                </div>


                <div class="analog-data-grid">

                    <div class="analog-data">
                        <span>Площадь</span>
                        <strong>${escapeHtml(formatArea(item.area, item.areaUnit))}</strong>
                    </div>

                    <div class="analog-data">
                        <span>Категория</span>
                        <strong title="${escapeHtml(item.category)}">${escapeHtml(item.category || "—")}</strong>
                    </div>

                    <div class="analog-data">
                        <span>ВРИ</span>
                        <strong title="${escapeHtml(item.vri)}">${escapeHtml(item.vri || "—")}</strong>
                    </div>

                </div>

                ${item.features.length ? `
                    <div class="analog-tags">
                        ${item.features.map(feature => `<span>${escapeHtml(feature)}</span>`).join("")}
                    </div>
                ` : ""}


                <div class="analog-price">

                    <div class="price-value">
                        <span>Стоимость</span>
                        <strong>${isNumber(item.price) ? formatPrice(item.price) : "Цена не указана"}</strong>
                    </div>

                    <div class="price-per-unit">
                        ${isNumber(item.pricePerUnit) ? `${formatPrice(item.pricePerUnit)} / ${escapeHtml(unitLabel)}` : "—"}
                        ${medianDeviation(item)}
                    </div>

                </div>


                <div class="analog-footer">

                    <span class="source">
                        Источник: <strong>${escapeHtml(sourceLabel(item.source))}</strong>
                    </span>

                    ${item.sourceUrl ? `
                        <a
                            class="details-button"
                            href="${escapeHtml(item.sourceUrl)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Открыть объявление
                            <span>→</span>
                        </a>
                    ` : ""}

                </div>

            </article>
        `;
    }

    function renderCards() {
        const total = state.items.length;

        if (!total) {
            renderListMessage(
                "⌕",
                "Аналоги не найдены",
                "Измените параметры поиска. Регион и район должны совпадать с названиями в базе, например «Томская область» и «Томский район»."
            );
            return;
        }

        const totalPages = Math.ceil(total / PER_PAGE);

        state.page = Math.min(Math.max(1, state.page), totalPages);

        const start = (state.page - 1) * PER_PAGE;

        $("analogsList").innerHTML = state.items
            .slice(start, start + PER_PAGE)
            .map((item, index) => renderCard(item, start + index + 1))
            .join("");

        updatePagination(total);
    }


    /* =========================================================
    ПАГИНАЦИЯ
    ========================================================= */

    // 1 … 4 5 6 … 10
    function pageList(current, total) {
        if (total <= 7) {
            return Array.from({ length: total }, (_, index) => index + 1);
        }

        let from = Math.max(2, Math.min(current - 1, total - 4));
        let to = Math.min(total - 1, Math.max(current + 1, 5));

        // Многоточие вместо одной пропущенной страницы не ставим
        if (from === 3) from = 2;
        if (to === total - 2) to = total - 1;

        const pages = [1];

        if (from > 2) pages.push(null);

        for (let page = from; page <= to; page++) {
            pages.push(page);
        }

        if (to < total - 1) pages.push(null);

        pages.push(total);

        return pages;
    }

    function pageButton(label, page, options = {}) {
        return `
            <button
                type="button"
                class="page-button${options.active ? " active" : ""}"
                data-page="${page}"
                ${options.disabled ? "disabled" : ""}
                ${options.title ? `aria-label="${options.title}"` : ""}
            >${label}</button>
        `;
    }

    function updatePagination(total) {
        const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
        const from = total ? (state.page - 1) * PER_PAGE + 1 : 0;
        const to = Math.min(state.page * PER_PAGE, total);

        $("paginationFrom").textContent = from;
        $("paginationTo").textContent = to;
        $("paginationTotal").textContent = total;

        const pagination = $("pagination");

        if (totalPages <= 1) {
            pagination.innerHTML = "";
            return;
        }

        pagination.innerHTML = [
            pageButton("‹", state.page - 1, { disabled: state.page === 1, title: "Предыдущая страница" }),
            ...pageList(state.page, totalPages).map(page =>
                page === null
                    ? `<span class="page-ellipsis">…</span>`
                    : pageButton(page, page, { active: page === state.page })
            ),
            pageButton("›", state.page + 1, { disabled: state.page === totalPages, title: "Следующая страница" })
        ].join("");
    }

    function goToPage(page) {
        if (page === state.page) return;

        // Без прокрутки к началу списка: держим пагинацию на том же месте
        // экрана, даже если новые карточки другой высоты
        const pagination = $("pagination");
        const before = pagination.getBoundingClientRect().top;

        state.page = page;
        renderCards();

        const shift = pagination.getBoundingClientRect().top - before;

        if (shift) {
            window.scrollBy({ top: shift, behavior: "instant" });
        }
    }


    /* =========================================================
    СОБЫТИЯ
    ========================================================= */

    function syncQuickFilters() {
        const from = $("areaFrom").value;
        const to = $("areaTo").value;

        document.querySelectorAll(".quick-filter").forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.areaFrom === from && button.dataset.areaTo === to
            );
        });
    }

    function initQuickFilters() {
        document.querySelectorAll(".quick-filter").forEach(button => {
            button.addEventListener("click", () => {
                $("areaFrom").value = button.dataset.areaFrom;
                $("areaTo").value = button.dataset.areaTo;

                syncQuickFilters();
                findAnalogs();
            });
        });

        ["areaFrom", "areaTo"].forEach(id => {
            $(id).addEventListener("input", syncQuickFilters);
        });
    }

    function resetFilters() {
        document.querySelectorAll(".search-builder input").forEach(input => {
            input.value = input.defaultValue;
        });

        document.querySelectorAll(".search-builder select").forEach(select => {
            const index = [...select.options].findIndex(option => option.defaultSelected);
            select.selectedIndex = Math.max(0, index);
        });

        syncQuickFilters();
        findAnalogs();
    }

    function init() {
        const findButton = $("findAnalogs");

        findButtonHtml = findButton.innerHTML;

        findButton.addEventListener("click", () => findAnalogs());
        $("resetFilters").addEventListener("click", resetFilters);

        // Enter в любом поле запускает поиск, смена списков — сразу
        document.querySelectorAll(".search-builder input").forEach(input => {
            input.addEventListener("keydown", event => {
                if (event.key === "Enter") findAnalogs();
            });
        });

        ["categoryFilter", "vriFilter"].forEach(id => {
            $(id).addEventListener("change", () => findAnalogs());
        });

        $("sortSelect").addEventListener("change", () => {
            if (!state.params) return;

            applySort();
            state.page = 1;
            renderCards();
        });

        $("pagination").addEventListener("click", event => {
            const button = event.target.closest(".page-button");

            if (!button || button.disabled) return;

            goToPage(Number(button.dataset.page));
        });

        initQuickFilters();
        syncQuickFilters();

        findAnalogs({ silent: true });
    }


    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
