(function () {
    "use strict";

    /* =========================================================
       API
    ========================================================= */

    const API = {
        listings: "/api/listings",
        totalCount: "/api/report/total-count",
        meta: "/api/meta/filters"
    };

    const PER_PAGE = 12;

    const SOURCES = {
        "cian": "ЦИАН",
        "avito": "Авито",
        "tomsk.ru09": "Tomsk.ru09"
    };

    const SOURCE_LINKS = {
        "cian": "Открыть на Циан",
        "avito": "Открыть на Авито",
        "tomsk.ru09": "Открыть на Tomsk.ru09"
    };

    const FEATURES = [
        { key: "hasGas", label: "газ" },
        { key: "hasElectricity", label: "свет" },
        { key: "hasWater", label: "вода" },
        { key: "hasHouse", label: "постройки" }
    ];

    const VISUALS = [
        "visual-one",
        "visual-two",
        "visual-three"
    ];

    const NEW_DAYS = 7;


    /* =========================================================
       STATE
    ========================================================= */

    const state = {
        page: 1,
        total: 0,
        pages: 0,
        loading: false,
        requestId: 0,
        sort: "newest"
    };


    /* =========================================================
       HELPERS
    ========================================================= */

    const $ = (id) => document.getElementById(id);

    const numberFormat = new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 0
    });

    const areaFormat = new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 2
    });


    function isNumber(value) {
        return typeof value === "number" && isFinite(value);
    }


    function toNumber(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        const number = Number(value);

        return isFinite(number)
            ? number
            : null;
    }


    function formatNumber(value) {
        return isNumber(value)
            ? numberFormat.format(value)
            : "—";
    }


    function formatPrice(value) {
        return isNumber(value)
            ? numberFormat.format(Math.round(value)) + " ₽"
            : null;
    }


    function plural(count, one, few, many) {
        const mod10 = Math.abs(count) % 10;
        const mod100 = Math.abs(count) % 100;

        if (
            mod10 === 1 &&
            mod100 !== 11
        ) {
            return one;
        }

        if (
            mod10 >= 2 &&
            mod10 <= 4 &&
            (mod100 < 12 || mod100 > 14)
        ) {
            return few;
        }

        return many;
    }


    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }


    function formatDate(isoDate) {
        if (!isoDate) {
            return "";
        }

        const date = new Date(
            String(isoDate).slice(0, 10) +
            "T00:00:00"
        );

        return isNaN(date)
            ? ""
            : date.toLocaleDateString("ru-RU");
    }


    function isSotka(unit) {
        return !unit || /сот/i.test(unit);
    }


    function formatArea(area, unit) {
        if (!isNumber(area)) {
            return null;
        }

        const value = areaFormat.format(area);

        if (!isSotka(unit)) {
            return `${value} ${unit}`;
        }

        return Number.isInteger(area)
            ? `${value} ${plural(
                area,
                "сотка",
                "сотки",
                "соток"
            )}`
            : `${value} сотки`;
    }


    function sourceLabel(source) {
        return (
            SOURCES[
                String(source || "").toLowerCase()
            ] ||
            source ||
            "Источник"
        );
    }


    function sourceClass(source) {
        const key = String(source || "").toLowerCase();

        if (key === "cian") {
            return "cian";
        }

        if (key === "avito") {
            return "avito";
        }

        return "ru09";
    }


    function sourceLinkLabel(source) {
        return (
            SOURCE_LINKS[
                String(source || "").toLowerCase()
            ] ||
            "Открыть источник"
        );
    }


    function safeUrl(url) {
        if (!url) {
            return null;
        }

        try {
            const parsed = new URL(String(url));

            return (
                parsed.protocol === "http:" ||
                parsed.protocol === "https:"
            )
                ? parsed.href
                : null;

        } catch {
            return null;
        }
    }


    function truncate(text, limit) {
        const s = String(text || "");

        return s.length > limit
            ? s.slice(0, limit).trimEnd() + "…"
            : s;
    }


    /* =========================================================
       TOAST
    ========================================================= */

    const body = document.body;

    const themeButton = $("themeButton");

    const toast = $("toast");
    const toastIcon = $("toastIcon");
    const toastTitle = $("toastTitle");
    const toastText = $("toastText");

    let toastTimer;


    function showToast(
        title,
        message,
        isError
    ) {
        if (!toast) {
            return;
        }

        if (toastTitle) {
            toastTitle.textContent = title;
        }

        if (toastText) {
            toastText.textContent = message;
        }

        if (toastIcon) {
            toastIcon.textContent = isError
                ? "!"
                : "✓";
        }

        toast.classList.toggle(
            "toast-error",
            Boolean(isError)
        );

        toast.classList.add("show");

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            toast.classList.remove("show");
        }, 2800);
    }

    // Страницы отчётов (analogs.js, quarterly.js) вызывают showToast глобально
    window.showToast = showToast;


    /* =========================================================
       THEME
    ========================================================= */

    function applyTheme(dark) {
        body.classList.toggle(
            "dark-theme",
            dark
        );

        body.classList.toggle(
            "dark",
            dark
        );

        if (themeButton) {
            themeButton.textContent = dark
                ? "☀"
                : "◐";
        }

        try {
            localStorage.setItem(
                "landscope-theme",
                dark
                    ? "dark"
                    : "light"
            );
        } catch {
        }
    }


    function savedTheme() {
        try {
            return localStorage.getItem(
                "landscope-theme"
            );
        } catch {
            return null;
        }
    }


    if (themeButton) {
        themeButton.addEventListener(
            "click",
            () => {
                const dark =
                    !body.classList.contains(
                        "dark-theme"
                    );

                applyTheme(dark);

                showToast(
                    "Тема изменена",
                    dark
                        ? "Тёмная тема включена"
                        : "Светлая тема включена"
                );
            }
        );
    }


    if (savedTheme() === "dark") {
        body.classList.add(
            "dark-theme",
            "dark"
        );

        if (themeButton) {
            themeButton.textContent = "☀";
        }
    }


    /* =========================================================
       DOM
    ========================================================= */

    const listStatus = $("listStatus");

    const objectsList = $("objectsList");

    const pagination = $("pagination");

    const totalCountEl = $("totalCount");


    /*
       НОВЫЙ TOOLBAR
    */

    const paginationFrom = $(
        "paginationFrom"
    );

    const paginationTo = $(
        "paginationTo"
    );

    const paginationTotal = $(
        "paginationTotal"
    );

    const sortSelect = $(
        "sortSelect"
    );


    /* =========================================================
       STATUS
    ========================================================= */

    function setStatus(text) {
        if (!listStatus) {
            return;
        }

        if (!text) {
            listStatus.hidden = true;
            listStatus.textContent = "";
            return;
        }

        listStatus.hidden = false;
        listStatus.textContent = text;
    }


    /* =========================================================
       NORMALIZE
    ========================================================= */

    function normalizeItem(raw, index) {
        return {
            id: raw.id ?? index,

            order: index,

            source: raw.source || "",

            sourceUrl: safeUrl(
                raw.sourceUrl
            ),

            datePublished:
                raw.datePublished || null,

            district:
                raw.district || "",

            locality:
                raw.locality || "",

            address:
                raw.address || "",

            price:
                toNumber(raw.price),

            pricePerUnit:
                toNumber(
                    raw.pricePerUnit
                ),

            area:
                toNumber(raw.area),

            areaUnit:
                raw.areaUnit || "",

            vri:
                raw.vri || "",

            cadastralNumber:
                raw.cadastralNumber || "",

            description:
                raw.description || "",

            features:
                FEATURES
                    .filter(
                        f =>
                            raw[f.key] === true
                    )
                    .map(
                        f => f.label
                    )
        };
    }


    /* =========================================================
       ITEM DATA
    ========================================================= */

    function itemTitle(item) {
        const addr = item.address;

        if (
            addr &&
            addr !== "Томская область"
        ) {
            return addr;
        }

        if (item.locality) {
            return item.locality;
        }

        return "Земельный участок";
    }


    function itemTags(item) {
        const tags = [];

        const area = formatArea(
            item.area,
            item.areaUnit
        );

        if (area) {
            tags.push(area);
        }

        if (item.vri) {
            const parts =
                item.vri
                    .split(",")
                    .map(
                        s => s.trim()
                    )
                    .filter(Boolean);

            if (parts.length) {
                tags.push(
                    parts
                        .slice(0, 2)
                        .join(", ") +
                    (
                        parts.length > 2
                            ? " …"
                            : ""
                    )
                );
            }
        }

        return tags.concat(
            item.features
        );
    }


    function itemStatus(item) {
        if (!item.datePublished) {
            return "Проверен";
        }

        const published =
            new Date(
                String(
                    item.datePublished
                ).slice(0, 10) +
                "T00:00:00"
            );

        if (isNaN(published)) {
            return "Проверен";
        }

        const days =
            (
                Date.now() -
                published.getTime()
            ) / 86400000;

        return days <= NEW_DAYS
            ? "Новый"
            : "Проверен";
    }


    /* =========================================================
       CARD
    ========================================================= */

    function cardHtml(
        item,
        index
    ) {
        const visual =
            VISUALS[
                index %
                VISUALS.length
            ];

        const tags =
            itemTags(item)
                .map(
                    tag =>
                        `<span>${escapeHtml(tag)}</span>`
                )
                .join("");

        const price =
            formatPrice(
                item.price
            );

        const perUnit =
            isNumber(
                item.pricePerUnit
            )
                ? `${numberFormat.format(
                    Math.round(
                        item.pricePerUnit
                    )
                )} ₽/сотка`
                : "цена за сотку не указана";


        const link =
            item.sourceUrl
                ? `
                    <a
                        href="${escapeHtml(item.sourceUrl)}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="object-link">
                        ${escapeHtml(
                            sourceLinkLabel(
                                item.source
                            )
                        )}
                    </a>
                `
                : `
                    <span class="object-link object-link-muted">
                        Нет ссылки
                    </span>
                `;


        const description =
            item.description
                ? `
                    <p>
                        ${escapeHtml(
                            truncate(
                                item.description,
                                240
                            )
                        )}
                    </p>
                `
                : "";


        return `
            <article class="object-card">

                <div class="object-visual ${visual}">
                    <span>ЗЕМЛЯ</span>
                </div>

                <div class="object-main">

                    <div class="object-title-row">

                        <div>

                            <h3>
                                ${escapeHtml(
                                    itemTitle(item)
                                )}
                            </h3>

                            <div class="object-meta">

                                <span class="source ${sourceClass(item.source)}">
                                    ${escapeHtml(
                                        sourceLabel(
                                            item.source
                                        )
                                    )}
                                </span>

                                <span>
                                    ${escapeHtml(
                                        formatDate(
                                            item.datePublished
                                        )
                                    )}
                                </span>

                            </div>

                        </div>

                        <span class="object-status">
                            ${itemStatus(item)}
                        </span>

                    </div>

                    <div class="object-tags">
                        ${tags}
                    </div>

                    ${description}

                    <div class="object-footer">

                        <div>

                            <strong>
                                ${escapeHtml(
                                    price ||
                                    "Цена не указана"
                                )}
                            </strong>

                            <span>
                                ${escapeHtml(
                                    perUnit
                                )}
                            </span>

                        </div>

                        ${link}

                    </div>

                </div>

            </article>
        `;
    }


    /* =========================================================
       RENDER ITEMS
    ========================================================= */

    // Сортировка выполняется на сервере (параметр sort в запросе),
    // поэтому карточки выводятся в порядке ответа API.
    // Пустой результат описывается строкой статуса (listStatus).
    function renderItems(items) {

        if (!objectsList) {
            return;
        }

        objectsList.innerHTML =
            items
                .map(
                    cardHtml
                )
                .join("");
    }


    /* =========================================================
       TOOLBAR COUNTER
    ========================================================= */

    function renderToolbar() {

        if (!paginationFrom ||
            !paginationTo ||
            !paginationTotal) {
            return;
        }


        if (state.total <= 0) {

            paginationFrom.textContent = "0";
            paginationTo.textContent = "0";
            paginationTotal.textContent = "0";

            return;
        }


        const from =
            (state.page - 1) *
            PER_PAGE +
            1;


        const to =
            Math.min(
                state.page *
                PER_PAGE,
                state.total
            );


        paginationFrom.textContent =
            numberFormat.format(from);

        paginationTo.textContent =
            numberFormat.format(to);

        paginationTotal.textContent =
            numberFormat.format(
                state.total
            );
    }


    /* =========================================================
       PAGE LIST
    ========================================================= */

    function pageList(
        current,
        total
    ) {

        if (total <= 7) {

            return Array.from(
                {
                    length: total
                },
                (_, i) => i + 1
            );
        }


        const pages =
            new Set([
                1,
                total,
                current
            ]);


        for (
            const p of [
                current - 1,
                current + 1
            ]
        ) {

            if (
                p > 1 &&
                p < total
            ) {
                pages.add(p);
            }
        }


        if (current <= 3) {

            [
                2,
                3,
                4
            ].forEach(
                p => {
                    if (p < total) {
                        pages.add(p);
                    }
                }
            );
        }


        if (
            current >=
            total - 2
        ) {

            [
                total - 3,
                total - 2,
                total - 1
            ].forEach(
                p => {
                    if (
                        p > 1 &&
                        p < total
                    ) {
                        pages.add(p);
                    }
                }
            );
        }


        const sorted =
            [...pages].sort(
                (a, b) => a - b
            );


        const result = [];

        let previous = 0;


        for (
            const page
            of sorted
        ) {

            if (
                previous &&
                page - previous > 1
            ) {
                result.push("…");
            }

            result.push(page);

            previous = page;
        }


        return result;
    }


    /* =========================================================
       PAGINATION RENDER
    ========================================================= */

    function renderPagination() {

        if (!pagination) {
            return;
        }


        renderToolbar();


        const {
            page,
            pages,
            total
        } = state;


        if (
            total === 0 ||
            pages <= 1
        ) {

            pagination.innerHTML = "";

            return;
        }


        const buttons =
            pageList(
                page,
                pages
            )
                .map(
                    entry => {

                        if (
                            entry === "…"
                        ) {

                            return `
                                <span class="page-dots">
                                    …
                                </span>
                            `;
                        }


                        const active =
                            entry === page
                                ? " active"
                                : "";


                        return `
                            <button
                                type="button"
                                class="page-button${active}"
                                data-page="${entry}">
                                ${entry}
                            </button>
                        `;
                    }
                )
                .join("");


        pagination.innerHTML = `

            <button
                type="button"
                class="page-button"
                data-page="${page - 1}"
                ${page <= 1 ? "disabled" : ""}>
                ←
            </button>

            ${buttons}

            <button
                type="button"
                class="page-button"
                data-page="${page + 1}"
                ${page >= pages ? "disabled" : ""}>
                →
            </button>

        `;
    }


    /* =========================================================
       JSON
    ========================================================= */

    async function readJson(
        response
    ) {

        try {

            return await response.json();

        } catch {

            return null;
        }
    }


    /* =========================================================
       FILTERS
    ========================================================= */

    function selectedValue(id) {

        const el = $(id);

        if (!el) {
            return null;
        }

        return el.value === "all"
            ? null
            : el.value;
    }


    function readFilters() {

        return {

            district:
                selectedValue(
                    "districtFilter"
                ),

            categoryLand:
                selectedValue(
                    "categoryFilter"
                ),

            vri:
                selectedValue(
                    "vriFilter"
                ),

            areaFrom:
                toNumber(
                    $("areaFrom")?.value
                ),

            areaTo:
                toNumber(
                    $("areaTo")?.value
                ),

            priceFrom:
                toNumber(
                    $("priceFrom")?.value
                ),

            priceTo:
                toNumber(
                    $("priceTo")?.value
                ),

            search:
                (
                    $("searchInput")?.value ||
                    ""
                ).trim()
        };
    }


    function checkRange(
        from,
        to,
        title
    ) {

        if (
            isNumber(from) &&
            isNumber(to) &&
            from > to
        ) {

            showToast(
                "Проверьте фильтр",
                `${title}: значение «От» больше «До»`,
                true
            );

            return false;
        }

        return true;
    }


    /* =========================================================
       LOAD LISTINGS
    ========================================================= */

    async function loadListings(
        options = {}
    ) {

        const filters =
            readFilters();


        if (
            !checkRange(
                filters.areaFrom,
                filters.areaTo,
                "Площадь"
            )
        ) {
            return false;
        }


        if (
            !checkRange(
                filters.priceFrom,
                filters.priceTo,
                "Цена"
            )
        ) {
            return false;
        }


        const requestId =
            ++state.requestId;


        state.loading = true;


        setStatus(
            "Загружаем объявления…"
        );


        try {

            const response =
                await fetch(
                    API.listings,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json",

                            "Accept":
                                "application/json"
                        },

                        body:
                            JSON.stringify({

                                ...filters,

                                page:
                                    state.page,

                                pageSize:
                                    PER_PAGE,

                                sort:
                                    state.sort
                            })
                    }
                );


            const data =
                await readJson(
                    response
                );


            if (
                requestId !==
                state.requestId
            ) {
                return false;
            }


            if (!response.ok) {

                throw new Error(
                    data?.message ||
                    data?.title ||
                    `Сервер вернул ошибку ${response.status}`
                );
            }


            const rawItems =
                Array.isArray(
                    data?.items
                )
                    ? data.items
                    : [];


            const items =
                rawItems.map(
                    normalizeItem
                );


            state.total =
                isNumber(
                    data?.total
                )
                    ? data.total
                    : items.length;


            state.pages =
                isNumber(
                    data?.pages
                )
                    ? data.pages
                    : Math.max(
                        1,
                        Math.ceil(
                            state.total /
                            PER_PAGE
                        )
                    );


            if (
                state.total === 0
            ) {

                state.page = 1;
                state.pages = 0;

            } else if (
                state.page >
                state.pages
            ) {

                // Страница вышла за пределы (данные изменились) —
                // перезапрашиваем последнюю существующую страницу,
                // иначе показался бы пустой список при total > 0.
                state.page =
                    state.pages;

                return loadListings(
                    options
                );
            }


            renderItems(
                items
            );


            renderPagination();


            if (items.length) {

                setStatus("");

            } else {

                setStatus(
                    "По выбранным фильтрам ничего не найдено. Попробуйте изменить параметры поиска."
                );
            }


            if (
                options.notify
            ) {

                showToast(
                    "Готово",
                    `Найдено ${state.total} ${plural(
                        state.total,
                        "объявление",
                        "объявления",
                        "объявлений"
                    )}`
                );
            }

            return true;


        } catch (error) {

            if (
                requestId !==
                state.requestId
            ) {
                return false;
            }


            renderItems([]);

            state.total = 0;
            state.pages = 0;

            renderPagination();


            setStatus(
                "Не удалось загрузить данные с сервера. Попробуйте обновить страницу."
            );


            showToast(
                "Ошибка",
                error.message ||
                "Нет связи с API",
                true
            );

            return false;

        } finally {

            if (
                requestId ===
                state.requestId
            ) {

                state.loading = false;
            }
        }
    }


    /* =========================================================
       TOTAL COUNT
    ========================================================= */

    async function loadTotalCount() {

        if (!totalCountEl) {
            return;
        }


        try {

            const response =
                await fetch(
                    API.totalCount,
                    {
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );


            const data =
                await readJson(
                    response
                );


            if (
                response.ok &&
                isNumber(data?.total)
            ) {

                totalCountEl.textContent =
                    numberFormat.format(
                        data.total
                    );

                return;
            }

        } catch {
        }


        totalCountEl.textContent =
            "—";
    }


    /* =========================================================
       FILTER OPTIONS
    ========================================================= */

    async function loadFilterOptions() {

        const select =
            $("districtFilter");


        if (!select) {
            return;
        }


        const fallback =
            select.innerHTML;


        try {

            const response =
                await fetch(
                    API.meta,
                    {
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );


            const data =
                await readJson(
                    response
                );


            if (
                !response.ok ||
                !Array.isArray(
                    data?.districts
                )
            ) {

                throw new Error(
                    "bad response"
                );
            }


            const current =
                select.value;


            const values =
                [
                    ...new Set(
                        (data.districts || [])
                            .map(
                                value =>
                                    String(
                                        value
                                    ).trim()
                            )
                            .filter(
                                Boolean
                            )
                    )
                ];


            if (!values.length) {
                throw new Error(
                    "empty"
                );
            }


            select.innerHTML =
                `
                    <option value="all">
                        Все районы
                    </option>
                ` +
                values
                    .map(
                        value =>
                            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
                    )
                    .join("");


            if (
                [
                    ...select.options
                ].some(
                    option =>
                        option.value ===
                        current
                )
            ) {

                select.value =
                    current;
            }


        } catch {

            select.innerHTML =
                fallback;
        }
    }


    /* =========================================================
       GO TO PAGE
    ========================================================= */

    function goToPage(page) {

        if (
            page < 1 ||
            page > state.pages ||
            state.loading
        ) {
            return;
        }


        state.page = page;


        loadListings();


        document
            .querySelector(
                ".list-section"
            )
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
    }


    /* =========================================================
       INIT
    ========================================================= */

    function init() {

        // Список объявлений есть только на главной. Страницы отчётов
        // подключают этот файл ради темы и тостов, а id вроде
        // resetFilters / sortSelect / pagination у них свои —
        // не вешаем на них обработчики главной.
        if (!objectsList) {
            return;
        }

        const applyButton =
            $("applyFilters");


        const resetButton =
            $("resetFilters");


        const refreshButton =
            $("refreshButton");


        const addButton =
            $("addSelectionButton");


        const searchInput =
            $("searchInput");


        /* =========================================
           SORT
        ========================================= */

        if (sortSelect) {

            sortSelect.value =
                state.sort;


            sortSelect.addEventListener(
                "change",
                () => {

                    state.sort =
                        sortSelect.value ||
                        "newest";

                    state.page = 1;

                    loadListings();
                }
            );
        }


        /* =========================================
           APPLY FILTERS
        ========================================= */

        if (applyButton) {

            applyButton.addEventListener(
                "click",
                () => {

                    state.page = 1;

                    loadListings({
                        notify: true
                    });
                }
            );
        }


        /* =========================================
           RESET
        ========================================= */

        if (resetButton) {

            resetButton.addEventListener(
                "click",
                () => {

                    for (
                        const id of [
                            "districtFilter",
                            "categoryFilter",
                            "vriFilter"
                        ]
                    ) {

                        const el = $(id);

                        if (el) {
                            el.value = "all";
                        }
                    }


                    for (
                        const id of [
                            "areaFrom",
                            "areaTo",
                            "priceFrom",
                            "priceTo"
                        ]
                    ) {

                        const el = $(id);

                        if (el) {
                            el.value = "";
                        }
                    }


                    if (searchInput) {
                        searchInput.value = "";
                    }


                    if (sortSelect) {

                        state.sort =
                            "newest";

                        sortSelect.value =
                            "newest";
                    }


                    state.page = 1;


                    loadListings();


                    showToast(
                        "Фильтры сброшены",
                        "Показаны все объявления"
                    );
                }
            );
        }


        /* =========================================
           REFRESH
        ========================================= */

        if (refreshButton) {

            refreshButton.addEventListener(
                "click",
                async () => {

                    refreshButton.disabled =
                        true;

                    refreshButton.textContent =
                        "Обновляем…";


                    try {

                        const [, , ok] =
                            await Promise.all([
                                loadTotalCount(),
                                loadFilterOptions(),
                                loadListings()
                            ]);


                        // При ошибке loadListings уже показал тост
                        // с ошибкой — не перетираем его «успехом».
                        if (ok) {
                            showToast(
                                "Данные обновлены",
                                "Список загружен заново"
                            );
                        }


                    } finally {

                        refreshButton.disabled =
                            false;

                        refreshButton.textContent =
                            "Обновить данные";
                    }
                }
            );
        }


        /* =========================================
           ADD SELECTION
        ========================================= */

        if (addButton) {

            addButton.addEventListener(
                "click",
                () => {

                    showToast(
                        "Скоро",
                        "Функция «Добавить выборку» появится позже"
                    );
                }
            );
        }


        /* =========================================
           SEARCH
        ========================================= */

        if (searchInput) {

            let timer;


            searchInput.addEventListener(
                "input",
                () => {

                    clearTimeout(timer);


                    timer =
                        setTimeout(
                            () => {

                                state.page = 1;

                                loadListings();

                            },
                            350
                        );
                }
            );


            searchInput.addEventListener(
                "keydown",
                event => {

                    if (
                        event.key ===
                        "Enter"
                    ) {

                        clearTimeout(
                            timer
                        );

                        state.page = 1;

                        loadListings();
                    }
                }
            );
        }


        /* =========================================
           PAGINATION
        ========================================= */

        if (pagination) {

            pagination.addEventListener(
                "click",
                event => {

                    const button =
                        event.target.closest(
                            "[data-page]"
                        );


                    if (
                        !button ||
                        button.disabled
                    ) {
                        return;
                    }


                    goToPage(
                        Number(
                            button.dataset.page
                        )
                    );
                }
            );
        }


        /* =========================================
           ENTER IN FILTERS
        ========================================= */

        for (
            const id of [
                "areaFrom",
                "areaTo",
                "priceFrom",
                "priceTo"
            ]
        ) {

            $(id)?.addEventListener(
                "keydown",
                event => {

                    if (
                        event.key ===
                            "Enter" &&
                        applyButton
                    ) {

                        applyButton.click();
                    }
                }
            );
        }


        /* =========================================
           INITIAL LOAD
        ========================================= */

        loadTotalCount();

        loadFilterOptions();

        loadListings();
    }


    /* =========================================================
       START
    ========================================================= */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init
        );

    } else {

        init();
    }

})();
