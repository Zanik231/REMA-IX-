(function () {

    const analogs = [
        {
            id: 1,
            title: "Земельный участок 12 соток",
            address: "г. Комсомольск-на-Амуре, ул. Лесная, 14",
            area: 12,
            price: 1850000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 96,
            source: "ЦИАН"
        },
        {
            id: 2,
            title: "Земельный участок 10 соток",
            address: "г. Комсомольск-на-Амуре, ул. Садовая, 8",
            area: 10,
            price: 1620000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 94,
            source: "Авито"
        },
        {
            id: 3,
            title: "Участок 15 соток",
            address: "г. Комсомольск-на-Амуре, ул. Центральная, 27",
            area: 15,
            price: 2190000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 92,
            source: "Домклик"
        },
        {
            id: 4,
            title: "Земельный участок 8 соток",
            address: "г. Комсомольск-на-Амуре, ул. Берёзовая, 5",
            area: 8,
            price: 1340000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 89,
            source: "ЦИАН"
        },
        {
            id: 5,
            title: "Участок под строительство",
            address: "г. Комсомольск-на-Амуре, ул. Молодёжная, 31",
            area: 11,
            price: 1740000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 87,
            source: "Авито"
        },
        {
            id: 6,
            title: "Земельный участок 20 соток",
            address: "г. Комсомольск-на-Амуре, ул. Южная, 19",
            area: 20,
            price: 2750000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 84,
            source: "Домклик"
        },
        {
            id: 7,
            title: "Земельный участок 9 соток",
            address: "г. Комсомольск-на-Амуре, ул. Новая, 7",
            area: 9,
            price: 1480000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 82,
            source: "ЦИАН"
        },
        {
            id: 8,
            title: "Участок 13 соток",
            address: "г. Комсомольск-на-Амуре, ул. Полевая, 22",
            area: 13,
            price: 1970000,
            category: "Земли населённых пунктов",
            vri: "Для индивидуального жилищного строительства",
            similarity: 79,
            source: "Авито"
        }
    ];

    const state = {
        items: [...analogs],
        page: 1,
        perPage: 4
    };


    const $ = (id) => document.getElementById(id);


    function formatPrice(value) {
        return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
    }


    function formatPricePerMeter(price, area) {
        if (!area) return "—";

        const value = Math.round(price / area);

        return new Intl.NumberFormat("ru-RU").format(value) + " ₽ / сотка";
    }


    function median(values) {

        if (!values.length) return 0;

        const sorted = [...values].sort((a, b) => a - b);

        const middle = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return Math.round(
                (sorted[middle - 1] + sorted[middle]) / 2
            );
        }

        return sorted[middle];
    }


    function getSimilarityClass(value) {

        if (value >= 90) return "high";

        if (value >= 75) return "medium";

        return "low";
    }


    function renderCards() {

        const container = $("analogsList");

        if (!container) return;

        const total = state.items.length;

        const start = (state.page - 1) * state.perPage;

        const end = start + state.perPage;

        const pageItems = state.items.slice(start, end);


        if (!pageItems.length) {

            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⌕</div>
                    <h3>Аналоги не найдены</h3>
                    <p>
                        Измените параметры поиска и попробуйте ещё раз.
                    </p>
                </div>
            `;

            updatePagination(0);

            return;
        }


        container.innerHTML = pageItems.map((item, index) => {

            const number = start + index + 1;

            const pricePerUnit = Math.round(item.price / item.area);

            return `
                <article class="analog-card">

                    <div class="analog-card-top">

                        <div class="analog-number">
                            ${String(number).padStart(2, "0")}
                        </div>

                        <span class="similarity-badge ${getSimilarityClass(item.similarity)}">
                            ${item.similarity}% совпадение
                        </span>

                    </div>


                    <h3>
                        ${item.title}
                    </h3>


                    <div class="analog-address">
                        ${item.address}
                    </div>


                    <div class="analog-data-grid">

                        <div class="analog-data">
                            <span>Площадь</span>
                            <strong>${item.area} соток</strong>
                        </div>

                        <div class="analog-data">
                            <span>Категория</span>
                            <strong>${item.category}</strong>
                        </div>

                        <div class="analog-data">
                            <span>ВРИ</span>
                            <strong>${item.vri}</strong>
                        </div>

                    </div>


                    <div class="analog-price">

                        <span class="price-value">
                            ${formatPrice(item.price)}
                        </span>

                        <span class="price-per-unit">
                            ${formatPricePerMeter(item.price, item.area)}
                        </span>

                    </div>


                    <div class="analog-footer">

                        <span class="source">
                            Источник: <strong>${item.source}</strong>
                        </span>

                        <button
                            class="details-button"
                            type="button"
                            data-id="${item.id}"
                        >
                            Подробнее
                            <span>→</span>
                        </button>

                    </div>

                </article>
            `;

        }).join("");


        container.querySelectorAll(".details-button").forEach(button => {

            button.addEventListener("click", function () {

                const id = Number(this.dataset.id);

                const item = analogs.find(analog => analog.id === id);

                if (!item) return;

                showToast(
                    "Карточка объекта",
                    `${item.address} · ${formatPrice(item.price)}`
                );

            });

        });


        updatePagination(total);
    }


    function updateMetrics() {

        const items = state.items;

        const prices = items.map(item => item.price);

        const pricesPerUnit = items.map(
            item => item.price / item.area
        );


        if ($("resultCount")) {
            $("resultCount").textContent = items.length;
        }


        if ($("averagePrice")) {

            const average = prices.length
                ? Math.round(
                    prices.reduce((sum, value) => sum + value, 0)
                    / prices.length
                )
                : 0;

            $("averagePrice").textContent = formatPrice(average);
        }


        if ($("medianPrice")) {

            $("medianPrice").textContent =
                formatPrice(median(prices));
        }


        if ($("priceRange")) {

            if (pricesPerUnit.length) {

                const min = Math.min(...pricesPerUnit);

                const max = Math.max(...pricesPerUnit);

                $("priceRange").textContent =
                    `${formatPrice(Math.round(min))} — ${formatPrice(Math.round(max))}`;

            } else {

                $("priceRange").textContent = "—";
            }
        }


        if ($("similarity")) {

            const averageSimilarity = items.length
                ? Math.round(
                    items.reduce(
                        (sum, item) => sum + item.similarity,
                        0
                    ) / items.length
                )
                : 0;

            $("similarity").textContent =
                averageSimilarity + "%";
        }


        if ($("summaryDescription")) {

            $("summaryDescription").textContent =
                items.length
                    ? `Найдено ${items.length} объектов, наиболее близких к заданным параметрам локации.`
                    : "По заданным параметрам подходящие аналоги не найдены.";
        }
    }


    function updatePagination(total) {

        const totalPages =
            Math.max(1, Math.ceil(total / state.perPage));


        if (state.page > totalPages) {
            state.page = totalPages;
        }


        if ($("paginationFrom")) {

            const from = total
                ? (state.page - 1) * state.perPage + 1
                : 0;

            $("paginationFrom").textContent = from;
        }


        if ($("paginationTo")) {

            const to = Math.min(
                state.page * state.perPage,
                total
            );

            $("paginationTo").textContent = to;
        }


        if ($("paginationTotal")) {
            $("paginationTotal").textContent = total;
        }


        if ($("currentPageLabel")) {
            $("currentPageLabel").textContent = state.page;
        }


        if ($("totalPagesLabel")) {
            $("totalPagesLabel").textContent = totalPages;
        }


        const pagination = $("pagination");

        if (!pagination) return;


        pagination.innerHTML = "";


        if (totalPages <= 1) return;


        for (let page = 1; page <= totalPages; page++) {

            const button = document.createElement("button");

            button.type = "button";

            button.className =
                "page-button" +
                (page === state.page ? " active" : "");

            button.textContent = page;


            button.addEventListener("click", function () {

                state.page = page;

                renderCards();

                document
                    .querySelector(".results-section")
                    ?.scrollIntoView({
                        behavior: "smooth",
                        block: "start"
                    });

            });


            pagination.appendChild(button);
        }
    }


    function applyFilters() {

        const location =
            ($("locationInput")?.value || "").trim().toLowerCase();

        const areaFrom =
            parseFloat($("areaFrom")?.value) || null;

        const areaTo =
            parseFloat($("areaTo")?.value) || null;

        const priceFrom =
            parseFloat($("priceFrom")?.value) || null;

        const priceTo =
            parseFloat($("priceTo")?.value) || null;

        const category =
            $("categoryFilter")?.value || "";

        const vri =
            $("vriFilter")?.value || "";


        state.items = analogs.filter(item => {

            if (
                location &&
                !item.address.toLowerCase().includes(location)
            ) {
                return false;
            }


            if (areaFrom !== null && item.area < areaFrom) {
                return false;
            }


            if (areaTo !== null && item.area > areaTo) {
                return false;
            }


            if (priceFrom !== null && item.price < priceFrom) {
                return false;
            }


            if (priceTo !== null && item.price > priceTo) {
                return false;
            }


            if (category && item.category !== category) {
                return false;
            }


            if (vri && item.vri !== vri) {
                return false;
            }


            return true;
        });


        state.page = 1;

        applySort();

        updateMetrics();

        renderCards();
    }


    function applySort() {

        const sort =
            $("sortSelect")?.value || "similarity";


        state.items.sort((a, b) => {

            switch (sort) {

                case "price-asc":
                    return a.price - b.price;

                case "price-desc":
                    return b.price - a.price;

                case "area-asc":
                    return a.area - b.area;

                case "area-desc":
                    return b.area - a.area;

                case "similarity":
                default:
                    return b.similarity - a.similarity;
            }

        });
    }


    function resetFilters() {

        [
            "locationInput",
            "areaFrom",
            "areaTo",
            "priceFrom",
            "priceTo"
        ].forEach(id => {

            const element = $(id);

            if (element) {
                element.value = "";
            }

        });


        [
            "categoryFilter",
            "vriFilter"
        ].forEach(id => {

            const element = $(id);

            if (element) {
                element.value = "";
            }

        });


        state.items = [...analogs];

        state.page = 1;

        applySort();

        updateMetrics();

        renderCards();
    }


    function showToast(title, text) {

        const toast = $("toast");

        if (!toast) return;

        const toastText = $("toastText");

        if (toastText) {
            toastText.textContent = text;
        }

        toast.classList.add("show");

        setTimeout(() => {
            toast.classList.remove("show");
        }, 3000);
    }


    function initQuickFilters() {

        document
            .querySelectorAll(".quick-filter")
            .forEach(button => {

                button.addEventListener("click", function () {

                    const type = this.dataset.type;

                    const value = this.dataset.value;


                    if (type === "area") {

                        const from = $("areaFrom");

                        const to = $("areaTo");

                        if (from) from.value = value;

                        if (to) to.value = "";

                    }


                    if (type === "price") {

                        const from = $("priceFrom");

                        const to = $("priceTo");

                        if (from) from.value = value;

                        if (to) to.value = "";

                    }


                    applyFilters();

                });

            });
    }


    function init() {

        const findButton = $("findAnalogs");

        if (findButton) {
            findButton.addEventListener(
                "click",
                applyFilters
            );
        }


        const resetButton = $("resetFilters");

        if (resetButton) {
            resetButton.addEventListener(
                "click",
                resetFilters
            );
        }


        const sortSelect = $("sortSelect");

        if (sortSelect) {

            sortSelect.addEventListener(
                "change",
                function () {

                    applySort();

                    state.page = 1;

                    renderCards();
                }
            );
        }


        initQuickFilters();

        updateMetrics();

        renderCards();
    }


    if (document.readyState === "loading") {

        document.addEventListener(
            "DOMContentLoaded",
            init
        );

    } else {

        init();

    }

})();

