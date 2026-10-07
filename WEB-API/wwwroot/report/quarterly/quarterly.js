(function () {

    const API = {
        calculate: "/api/report/calculate",
        totalCount: "/api/report/total-count"
    };

    // Названия сегментов совпадают с теми, что отдаёт /api/report/calculate (AreaAnalytics)
    const SEGMENTS = [
        "До 30 соток",
        "От 30 до 50 соток",
        "Свыше 50 соток"
    ];

    const MONTHS = [
        "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
        "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ];

    const MONTHS_SHORT = [
        "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
        "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"
    ];

    const REPORT_SECTIONS = [
        "currentReport",
        "segmentsReport",
        "historyReport",
        "dynamicsReport"
    ];

    const state = {
        report: null,
        requestId: 0,
        chartMetric: "average",
        chartPoints: [],
        activePoint: -1
    };

    const $ = (id) => document.getElementById(id);

    const numberFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
    const percentFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
    const compactFormat = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });


    /* =========================================================
    ФОРМАТИРОВАНИЕ
    ========================================================= */

    function isNumber(value) {
        return typeof value === "number" && isFinite(value);
    }

    function formatNumber(value) {
        return isNumber(value) ? numberFormat.format(value) : "—";
    }

    function formatPrice(value) {
        return isNumber(value) ? numberFormat.format(Math.round(value)) + " ₽" : "—";
    }

    function formatAxisValue(value, useCompact) {
        return useCompact ? compactFormat.format(value) : numberFormat.format(value);
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

    function percentChange(current, previous) {
        if (!isNumber(current) || !isNumber(previous) || previous === 0) {
            return null;
        }

        return (current - previous) / previous * 100;
    }

    function deltaDirection(delta) {
        if (delta === null) return "none";

        const rounded = Math.round(delta * 10) / 10;

        if (rounded > 0) return "up";
        if (rounded < 0) return "down";
        return "flat";
    }

    function formatDelta(delta) {
        const direction = deltaDirection(delta);

        if (direction === "none") return "—";
        if (direction === "flat") return "0%";

        const arrow = direction === "up" ? "▲" : "▼";

        return `${arrow} ${percentFormat.format(Math.abs(Math.round(delta * 10) / 10))}%`;
    }

    function formatSignedPercent(delta) {
        const direction = deltaDirection(delta);

        if (direction === "none") return "—";
        if (direction === "flat") return "0%";

        const sign = direction === "up" ? "+" : "−";

        return `${sign}${percentFormat.format(Math.abs(Math.round(delta * 10) / 10))}%`;
    }

    function changeBadge(delta) {
        const direction = deltaDirection(delta);
        const className = direction === "none" ? "flat" : direction;

        return `<span class="change ${className}">${formatDelta(delta)}</span>`;
    }

    function setDeltaText(element, delta) {
        if (!element) return;

        const direction = deltaDirection(delta);

        element.textContent = formatDelta(delta);
        element.className =
            direction === "up" ? "positive" :
            direction === "down" ? "negative" :
            "neutral-value";
    }


    /* =========================================================
    ДАТЫ И ПЕРИОДЫ
    ========================================================= */

    function toIsoDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    // Аналог DateOnly.AddYears на сервере: 29 февраля превращается в 28 февраля
    function shiftYears(isoDate, years) {
        const [year, month, day] = isoDate.split("-").map(Number);
        const targetYear = year + years;
        const lastDay = new Date(targetYear, month, 0).getDate();

        return toIsoDate(new Date(targetYear, month - 1, Math.min(day, lastDay)));
    }

    function formatDate(isoDate) {
        return new Date(isoDate + "T00:00:00").toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric"
        });
    }

    function yearsLabel(start, end) {
        const startYear = start.slice(0, 4);
        const endYear = end.slice(0, 4);

        return startYear === endYear ? startYear : `${startYear}–${endYear}`;
    }

    // Ключи периодов приходят с сервера в виде "Q3 2026" или "2026-09"
    function parsePeriod(key) {
        let match = /^Q(\d) (\d{4})$/.exec(key);

        if (match) {
            return { year: Number(match[2]), index: Number(match[1]), quarter: true };
        }

        match = /^(\d{4})-(\d{2})$/.exec(key);

        if (match) {
            return { year: Number(match[1]), index: Number(match[2]), quarter: false };
        }

        return null;
    }

    // Сервер сортирует периоды как строки, поэтому "Q1 2026" оказывается раньше "Q2 2025"
    function periodSortValue(key) {
        const period = parsePeriod(key);

        return period ? period.year * 100 + period.index : 0;
    }

    function sortByPeriod(items) {
        return [...items].sort(
            (a, b) => periodSortValue(a.period) - periodSortValue(b.period)
        );
    }

    function previousPeriodKey(key) {
        const period = parsePeriod(key);

        if (!period) return null;

        return period.quarter
            ? `Q${period.index} ${period.year - 1}`
            : `${period.year - 1}-${String(period.index).padStart(2, "0")}`;
    }

    function periodLabel(key) {
        const period = parsePeriod(key);

        if (!period || period.quarter) return key;

        return `${MONTHS[period.index - 1]} ${period.year}`;
    }

    function shortPeriodLabel(key, withYear) {
        const period = parsePeriod(key);

        if (!period) return key;

        if (period.quarter) {
            return withYear ? key : `Q${period.index}`;
        }

        const month = MONTHS_SHORT[period.index - 1];

        return withYear ? `${month} ${String(period.year).slice(2)}` : month;
    }

    function periodRange(start, end, quarterly) {
        const keys = [];
        let [year, month] = start.split("-").map(Number);
        const [endYear, endMonth] = end.split("-").map(Number);

        if (quarterly) {
            month = Math.floor((month - 1) / 3) * 3 + 1;
        }

        while (year < endYear || (year === endYear && month <= endMonth)) {
            keys.push(
                quarterly
                    ? `Q${(month - 1) / 3 + 1} ${year}`
                    : `${year}-${String(month).padStart(2, "0")}`
            );

            month += quarterly ? 3 : 1;

            if (month > 12) {
                month -= 12;
                year += 1;
            }
        }

        return keys;
    }

    function quickPeriodRange(period) {
        const today = new Date();
        const todayIso = toIsoDate(today);
        const year = today.getFullYear();

        if (period === "current") {
            return [`${year}-01-01`, todayIso];
        }

        if (period === "12") {
            const from = new Date(today);
            from.setFullYear(year - 1);
            from.setDate(from.getDate() + 1);

            return [toIsoDate(from), todayIso];
        }

        if (period === "previous") {
            return [`${year - 1}-01-01`, `${year - 1}-12-31`];
        }

        const selectedYear = Number(period);

        if (!selectedYear) return null;

        return [
            `${selectedYear}-01-01`,
            selectedYear === year ? todayIso : `${selectedYear}-12-31`
        ];
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

    // POST /api/report/calculate → { summary, timeline, historyTimeline, areaAnalytics }
    // или { message: "Нет данных за выбранный период" }
    async function requestReport(start, end, params) {
        const response = await fetch(API.calculate, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                start: `${start}T00:00:00`,
                // Конец дня: сервер отклоняет End == Start, а DateOnly.FromDateTime всё равно берёт только дату
                end: `${end}T23:59:59`,
                interval: params.interval,
                region: params.region
            })
        });

        const data = await readJson(response);

        if (!response.ok) {
            throw new Error(
                data?.message || data?.title || `Сервер вернул ошибку ${response.status}`
            );
        }

        return data;
    }

    function normalizeReport(data) {
        if (!data || !data.summary) return null;

        return {
            summary: data.summary,
            timeline: sortByPeriod(data.timeline || []),
            historyTimeline: sortByPeriod(data.historyTimeline || []),
            areaAnalytics: data.areaAnalytics || []
        };
    }

    async function loadTotalCount() {
        try {
            const response = await fetch(API.totalCount, {
                headers: { "Accept": "application/json" }
            });

            const data = await readJson(response);

            if (!response.ok || !data) {
                throw new Error();
            }

            const total = Number(data.total ?? 0);
            const time = new Date().toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit"
            });

            $("databaseStatus").textContent = "ДАННЫЕ АКТУАЛЬНЫ";
            $("databaseTotal").textContent = formatNumber(total);
            $("databaseCaption").textContent =
                `${plural(total, "объявление", "объявления", "объявлений")} в базе`;
            $("databaseUpdated").textContent = `Получено из API · ${time}`;

        } catch {
            $("databaseStatus").textContent = "НЕТ СВЯЗИ С API";
            $("databaseTotal").textContent = "—";
            $("databaseUpdated").textContent = "Не удалось получить количество объявлений";
        }
    }


    /* =========================================================
    ФОРМИРОВАНИЕ ОТЧЁТА
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

    function readParams() {
        const start = $("startDate").value;
        const end = $("endDate").value;

        if (!start || !end) {
            notify("Укажите период", "Заполните даты начала и конца периода", true);
            return null;
        }

        if (start > end) {
            notify("Неверный период", "Дата окончания не может быть раньше начала", true);
            return null;
        }

        const interval = $("interval").value;
        const regionSelect = $("region");

        return {
            start,
            end,
            previousStart: shiftYears(start, -1),
            previousEnd: shiftYears(end, -1),
            interval,
            quarterly: interval === "По кварталам",
            region: regionSelect.value,
            regionLabel: regionSelect.options[regionSelect.selectedIndex].text.trim()
        };
    }

    let generateButtonHtml = "";

    function setLoading(loading) {
        const button = $("generateReport");

        if (button) {
            button.disabled = loading;
            button.innerHTML = loading
                ? "<span>Формирование…</span>"
                : generateButtonHtml;
        }

        REPORT_SECTIONS.forEach(id => {
            $(id)?.classList.toggle("is-loading", loading);
        });
    }

    async function generateReport(options = {}) {
        const params = readParams();

        if (!params) return;

        const requestId = ++state.requestId;

        setLoading(true);

        try {
            // Второй запрос — тот же период годом раньше: из него берём историю
            // с минимумом/максимумом и сегментацию прошлого года
            const [currentData, previousData] = await Promise.all([
                requestReport(params.start, params.end, params),
                requestReport(params.previousStart, params.previousEnd, params)
            ]);

            if (requestId !== state.requestId) return;

            state.report = {
                params,
                current: normalizeReport(currentData),
                previous: normalizeReport(previousData),
                message: currentData?.message || ""
            };

            renderReport();

            if (!options.silent) {
                if (state.report.current) {
                    const total = state.report.current.summary.totalAnnouncements;

                    notify(
                        "Отчёт сформирован",
                        `Найдено ${formatNumber(total)} ${plural(total, "объявление", "объявления", "объявлений")}`
                    );
                } else {
                    notify("Нет данных", state.report.message || "Нет данных за выбранный период", true);
                }
            }

        } catch (error) {
            if (requestId !== state.requestId) return;

            const message = error instanceof TypeError
                ? "API недоступен. Проверьте, что сервер запущен."
                : error.message;

            notify("Не удалось сформировать отчёт", message, true);

        } finally {
            if (requestId === state.requestId) {
                setLoading(false);
            }
        }
    }


    /* =========================================================
    ОТРИСОВКА
    ========================================================= */

    function getPreviousTimeline() {
        const { current, previous } = state.report;

        return previous?.timeline || current?.historyTimeline || [];
    }

    function renderReport() {
        renderSummary();
        renderCurrentTable();
        renderSegments();
        renderHistory();
        renderChart();
    }

    function renderSummary() {
        const { params, current, previous, message } = state.report;
        const summary = current?.summary;
        const previousYears = yearsLabel(params.previousStart, params.previousEnd);

        $("periodText").innerHTML =
            `${formatDate(params.start)} — ${formatDate(params.end)}
            <span>·</span>
            ${escapeHtml(params.regionLabel)}
            <span>·</span>
            ${summary ? `Найдено: ${formatNumber(summary.totalAnnouncements)}` : escapeHtml(message || "Нет данных")}`;

        // Сервер возвращает дельты 0, если за прошлый год данных нет — в этом случае показываем «—»
        const hasHistory = (current?.historyTimeline || []).length > 0;

        const average = $("kpiAverage");
        average.textContent = formatPrice(summary?.averagePrice);
        average.classList.toggle("compact-value", average.textContent.length > 10);

        const median = $("kpiMedian");
        median.textContent = formatPrice(summary?.medianPrice);
        median.classList.toggle("compact-value", median.textContent.length > 10);

        $("kpiCount").textContent = formatNumber(summary?.totalAnnouncements);

        setDeltaText(
            $("kpiAverageDelta"),
            percentChange(summary?.averagePrice, previous?.summary.averagePrice)
        );

        const priceDelta = summary && hasHistory ? summary.priceChangeDeltaPercentage : null;
        const countDelta = summary && hasHistory ? summary.countChangeDeltaPercentage : null;

        setDeltaText($("kpiMedianDelta"), priceDelta);
        setDeltaText($("kpiCountDelta"), countDelta);

        const change = $("kpiChange");
        const direction = deltaDirection(priceDelta);

        change.textContent = formatSignedPercent(priceDelta);
        change.classList.toggle("green-value", direction === "up");
        change.classList.toggle("red-value", direction === "down");

        $("kpiChangeCaption").textContent = `к периоду ${previousYears}`;
    }

    function emptyRow(text) {
        return `
            <tr class="table-empty">
                <td colspan="6">${escapeHtml(text)}</td>
            </tr>
        `;
    }

    function setTableMeta(titleId, countId, count) {
        $(titleId).textContent = state.report.params.quarterly
            ? "Показатели по кварталам"
            : "Показатели по месяцам";

        $(countId).textContent =
            `${count} ${plural(count, "период", "периода", "периодов")}`;
    }

    function renderCurrentTable() {
        const { current, message } = state.report;
        const timeline = current?.timeline || [];
        const previousByPeriod = new Map(
            getPreviousTimeline().map(item => [item.period, item])
        );

        setTableMeta("currentTableTitle", "currentPeriodsCount", timeline.length);

        if (!timeline.length) {
            $("currentTableBody").innerHTML =
                emptyRow(message || "Нет данных за выбранный период");
            return;
        }

        $("currentTableBody").innerHTML = timeline.map(item => {
            const previous = previousByPeriod.get(previousPeriodKey(item.period));

            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(periodLabel(item.period))}</strong>
                    </td>
                    <td>
                        ${formatNumber(item.announcementCount)}
                        ${changeBadge(percentChange(item.announcementCount, previous?.announcementCount))}
                    </td>
                    <td>
                        <strong>${formatPrice(item.average)}</strong>
                        ${changeBadge(percentChange(item.average, previous?.average))}
                    </td>
                    <td>
                        ${formatPrice(item.median)}
                        ${changeBadge(percentChange(item.median, previous?.median))}
                    </td>
                    <td>
                        ${formatPrice(item.maximumPerUnit)}
                        ${changeBadge(percentChange(item.maximumPerUnit, previous?.maximumPerUnit))}
                    </td>
                    <td>
                        ${formatPrice(item.minimumPerUnit)}
                        ${changeBadge(percentChange(item.minimumPerUnit, previous?.minimumPerUnit))}
                    </td>
                </tr>
            `;
        }).join("");
    }

    function findSegment(segments, name) {
        return (segments || []).find(segment => segment.segmentGroup === name) || null;
    }

    function renderSegments() {
        const { current, previous } = state.report;
        const segments = SEGMENTS.map(name => ({
            name,
            data: findSegment(current?.areaAnalytics, name),
            previous: findSegment(previous?.areaAnalytics, name)
        }));

        const averages = segments
            .map(segment => segment.data?.average)
            .filter(isNumber);

        const maxAverage = averages.length ? Math.max(...averages) : 0;

        $("segmentGrid").innerHTML = segments.map((segment, index) => {
            const data = segment.data;
            const count = data?.announcementCount || 0;
            const delta = percentChange(data?.average, segment.previous?.average);
            const direction = deltaDirection(delta);
            const featured = data && maxAverage > 0 && data.average === maxAverage;
            const width = data && maxAverage > 0
                ? Math.max(4, Math.round(data.average / maxAverage * 100))
                : 0;

            return `
                <article class="segment-card${featured ? " featured-segment" : ""}${data ? "" : " is-empty"}">
                    <div class="segment-number">
                        ${String(index + 1).padStart(2, "0")}
                    </div>
                    <div class="segment-top">
                        <span>${escapeHtml(segment.name)}</span>
                        <b>${formatNumber(count)} ${plural(count, "объект", "объекта", "объектов")}</b>
                    </div>
                    <strong>${formatPrice(data?.average)}</strong>
                    <span class="segment-caption">
                        средняя цена за сотку
                    </span>
                    <div class="segment-divider"></div>
                    <div class="segment-bottom">
                        <span>
                            Медиана
                            <b>${formatPrice(data?.median)}</b>
                        </span>
                        <strong
                            class="${direction === "up" ? "up" : direction === "down" ? "down" : "neutral"}"
                            title="Изменение средней цены к тому же периоду год назад">
                            ${formatDelta(delta)}
                        </strong>
                    </div>
                    <div class="segment-bar">
                        <i style="width: ${width}%"></i>
                    </div>
                </article>
            `;
        }).join("");
    }

    function renderHistory() {
        const { params, previous } = state.report;
        const previousYears = yearsLabel(params.previousStart, params.previousEnd);
        const timeline = previous?.timeline || [];
        const total = previous?.summary.totalAnnouncements || 0;

        $("historyPeriodText").innerHTML =
            `${formatDate(params.previousStart)} — ${formatDate(params.previousEnd)}
            <span>·</span>
            Найдено: ${formatNumber(total)}`;

        $("historyYearBadge").textContent = previousYears;
        $("historySectorLabel").textContent = `СЕГМЕНТАЦИЯ ${previousYears}`;

        setTableMeta("historyTableTitle", "historyPeriodsCount", timeline.length);

        $("historyTableBody").innerHTML = timeline.length
            ? timeline.map(item => `
                <tr>
                    <td>
                        <strong>${escapeHtml(periodLabel(item.period))}</strong>
                    </td>
                    <td>${formatNumber(item.announcementCount)}</td>
                    <td>
                        <strong>${formatPrice(item.average)}</strong>
                    </td>
                    <td>${formatPrice(item.median)}</td>
                    <td>${formatPrice(item.maximumPerUnit)}</td>
                    <td>${formatPrice(item.minimumPerUnit)}</td>
                </tr>
            `).join("")
            : emptyRow("Нет данных за аналогичный период прошлого года");

        if (!previous) {
            $("historySectorGrid").innerHTML = `
                <div class="history-sector-empty">
                    Нет данных за аналогичный период прошлого года
                </div>
            `;
            return;
        }

        $("historySectorGrid").innerHTML = SEGMENTS.map(name => {
            const data = findSegment(previous.areaAnalytics, name);
            const count = data?.announcementCount || 0;

            return `
                <div class="history-sector-card${data ? "" : " is-empty"}">
                    <span>${escapeHtml(name)}</span>
                    <strong>${formatPrice(data?.average)}</strong>
                    <small>${formatNumber(count)} ${plural(count, "объявление", "объявления", "объявлений")}</small>
                    <b>Медиана ${formatPrice(data?.median)}</b>
                </div>
            `;
        }).join("");
    }


    /* =========================================================
    ГРАФИК
    ========================================================= */

    const CHART_WIDTH = 1000;
    const CHART_HEIGHT = 360;

    function niceScale(min, max) {
        if (min === max) {
            const padding = Math.abs(min) * 0.2 || 1;
            min = Math.max(0, min - padding);
            max += padding;
        }

        const rawStep = (max - min) / 4;
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));

        for (const factor of [1, 2, 2.5, 5, 10, 20, 25, 50]) {
            const step = factor * magnitude;

            if (step < rawStep) continue;

            const lower = Math.floor(min / step) * step;

            if (lower + step * 4 >= max) {
                return { min: lower, max: lower + step * 4 };
            }
        }

        return { min, max };
    }

    function buildLine(points) {
        let path = "";
        let previous = null;

        points.forEach(point => {
            if (!point) {
                previous = null;
                return;
            }

            if (!previous) {
                path += `M${point.x} ${point.y} `;
            } else {
                const middle = (previous.x + point.x) / 2;
                path += `C${middle} ${previous.y} ${middle} ${point.y} ${point.x} ${point.y} `;
            }

            previous = point;
        });

        return path.trim();
    }

    function buildArea(points) {
        const runs = [];
        let run = [];

        points.forEach(point => {
            if (point) {
                run.push(point);
            } else if (run.length) {
                runs.push(run);
                run = [];
            }
        });

        if (run.length) runs.push(run);

        return runs
            .filter(items => items.length > 1)
            .map(items =>
                `${buildLine(items)} L${items[items.length - 1].x} ${CHART_HEIGHT} L${items[0].x} ${CHART_HEIGHT} Z`
            )
            .join(" ");
    }

    function renderChart() {
        const { params, current } = state.report;
        const metric = state.chartMetric;
        const area = $("chartArea");

        const currentByPeriod = new Map(
            (current?.timeline || []).map(item => [item.period, item])
        );
        const previousByPeriod = new Map(
            getPreviousTimeline().map(item => [item.period, item])
        );

        let keys = periodRange(params.start, params.end, params.quarterly);

        const hasData = key =>
            currentByPeriod.has(key) || previousByPeriod.has(previousPeriodKey(key));

        const first = keys.findIndex(hasData);
        const last = keys.length - 1 - [...keys].reverse().findIndex(hasData);

        keys = first === -1 ? [] : keys.slice(first, last + 1);

        const metricName = metric === "average" ? "Средняя цена" : "Медианная цена";
        const currentYears = yearsLabel(params.start, params.end);
        const previousYears = yearsLabel(params.previousStart, params.previousEnd);

        $("legendCurrent").textContent = currentYears;
        $("legendPrevious").textContent = previousYears;
        $("chartSubtitle").textContent = currentYears === previousYears
            ? `${metricName} за сотку`
            : `${metricName} за сотку в сравнении с аналогичным периодом ${previousYears} г.`;

        area.classList.toggle("is-empty", keys.length === 0);

        if (!keys.length) {
            state.chartPoints = [];
            $("chartValues").innerHTML = "";
            $("chartLabels").innerHTML = "";
            $("chartDots").innerHTML = "";
            $("chartAreaPath").setAttribute("d", "");
            $("chartCurrentLine").setAttribute("d", "");
            $("chartPreviousLine").setAttribute("d", "");
            $("chartTooltip").hidden = true;
            return;
        }

        const points = keys.map((key, index) => ({
            key,
            previousKey: previousPeriodKey(key),
            current: currentByPeriod.get(key)?.[metric] ?? null,
            previous: previousByPeriod.get(previousPeriodKey(key))?.[metric] ?? null,
            x: keys.length === 1
                ? CHART_WIDTH / 2
                : Math.round(index / (keys.length - 1) * CHART_WIDTH * 10) / 10
        }));

        const values = points
            .flatMap(point => [point.current, point.previous])
            .filter(isNumber);

        const scale = niceScale(Math.min(...values), Math.max(...values));
        const toY = value =>
            Math.round((CHART_HEIGHT - (value - scale.min) / (scale.max - scale.min) * CHART_HEIGHT) * 10) / 10;

        points.forEach(point => {
            point.currentY = isNumber(point.current) ? toY(point.current) : null;
            point.previousY = isNumber(point.previous) ? toY(point.previous) : null;
        });

        const currentPoints = points.map(point =>
            point.currentY === null ? null : { x: point.x, y: point.currentY }
        );
        const previousPoints = points.map(point =>
            point.previousY === null ? null : { x: point.x, y: point.previousY }
        );

        $("chartCurrentLine").setAttribute("d", buildLine(currentPoints));
        $("chartPreviousLine").setAttribute("d", buildLine(previousPoints));
        $("chartAreaPath").setAttribute("d", buildArea(currentPoints));

        // Ось Y: 5 подписей, выровненных по линиям сетки
        const useCompact = scale.max >= 1000000;

        $("chartValues").innerHTML = [0, 1, 2, 3, 4].map(step => {
            const value = scale.max - (scale.max - scale.min) * step / 4;

            return `<span style="top: calc(14px + (100% - 54px) * ${step / 4})">${formatAxisValue(value, useCompact)}</span>`;
        }).join("");

        // Ось X: не больше ~12 подписей
        const multiYear = params.start.slice(0, 4) !== params.end.slice(0, 4);
        const labelStep = Math.ceil(points.length / 12);

        $("chartLabels").innerHTML = points.map((point, index) => {
            const isLast = index === points.length - 1;

            if (index % labelStep !== 0 && !isLast) return "";

            const edge = points.length === 1 ? "" :
                index === 0 ? "first" :
                isLast ? "last" : "";

            return `<span class="${edge}" style="left: ${point.x / 10}%">${escapeHtml(shortPeriodLabel(point.key, multiYear))}</span>`;
        }).join("");

        $("chartDots").innerHTML = points.map((point, index) => {
            let html = "";

            if (point.previousY !== null) {
                html += `<i class="chart-dot previous" style="left: ${point.x / 10}%; top: ${point.previousY / CHART_HEIGHT * 100}%"></i>`;
            }

            if (point.currentY !== null) {
                html += `<i class="chart-dot" data-index="${index}" style="left: ${point.x / 10}%; top: ${point.currentY / CHART_HEIGHT * 100}%"></i>`;
            }

            return html;
        }).join("");

        state.chartPoints = points;
        setActivePoint(defaultPointIndex());
    }

    function defaultPointIndex() {
        const points = state.chartPoints;

        for (let index = points.length - 1; index >= 0; index--) {
            if (points[index].currentY !== null) return index;
        }

        return points.length - 1;
    }

    function setActivePoint(index) {
        const points = state.chartPoints;
        const tooltip = $("chartTooltip");
        const point = points[index];

        state.activePoint = index;

        $("chartDots").querySelectorAll(".chart-dot[data-index]").forEach(dot => {
            dot.classList.toggle("active", Number(dot.dataset.index) === index);
        });

        if (!point) {
            tooltip.hidden = true;
            return;
        }

        const [label, value, change] = tooltip.children;
        const delta = percentChange(point.current, point.previous);
        const direction = deltaDirection(delta);

        label.textContent = periodLabel(point.key);
        value.textContent = isNumber(point.current) ? formatPrice(point.current) : "Нет данных";

        if (direction === "none") {
            change.textContent = isNumber(point.previous)
                ? `${periodLabel(point.previousKey)}: ${formatPrice(point.previous)}`
                : "нет данных год назад";
            change.className = "neutral";
        } else {
            const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "";
            change.textContent =
                `${arrow} ${percentFormat.format(Math.abs(Math.round(delta * 10) / 10))}% год к году`.trim();
            change.className = direction === "down" ? "down" : "";
        }

        tooltip.hidden = false;

        // Позиционирование: над точкой, у краёв графика — со сдвигом внутрь
        const area = $("chartArea");
        const plotHeight = area.clientHeight - 54;
        const y = point.currentY ?? point.previousY ?? 0;
        const pointTop = 14 + plotHeight * y / CHART_HEIGHT;
        const tooltipHeight = tooltip.offsetHeight;
        const xPercent = point.x / 10;

        let top = pointTop - tooltipHeight - 16;

        if (top < 0) {
            top = pointTop + 16;
        }

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${xPercent}%`;
        tooltip.style.transform =
            xPercent < 15 ? "translateX(0)" :
            xPercent > 85 ? "translateX(-100%)" :
            "translateX(-50%)";
    }

    function handleChartHover(event) {
        const points = state.chartPoints;

        if (!points.length) return;

        const rect = $("chartArea").getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * CHART_WIDTH;

        let nearest = 0;

        points.forEach((point, index) => {
            if (Math.abs(point.x - x) < Math.abs(points[nearest].x - x)) {
                nearest = index;
            }
        });

        if (nearest !== state.activePoint) {
            setActivePoint(nearest);
        }
    }


    /* =========================================================
    ЭКСПОРТ
    ========================================================= */

    function csvCell(value) {
        if (value === null || value === undefined) return "";

        const text = typeof value === "number"
            ? String(Math.round(value * 10) / 10).replace(".", ",")
            : String(value);

        return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function timelineRows(timeline) {
        return timeline.map(item => [
            periodLabel(item.period),
            item.announcementCount,
            Math.round(item.average),
            Math.round(item.median),
            isNumber(item.maximumPerUnit) ? Math.round(item.maximumPerUnit) : null,
            isNumber(item.minimumPerUnit) ? Math.round(item.minimumPerUnit) : null
        ]);
    }

    function segmentRows(segments) {
        return SEGMENTS.map(name => {
            const data = findSegment(segments, name);

            return [
                name,
                data?.announcementCount || 0,
                data ? Math.round(data.average) : null,
                data ? Math.round(data.median) : null
            ];
        });
    }

    function exportReport() {
        if (!state.report) {
            notify("Нечего экспортировать", "Сначала сформируйте отчёт", true);
            return;
        }

        const { params, current, previous } = state.report;
        const summary = current?.summary;
        const hasHistory = (current?.historyTimeline || []).length > 0;
        const timelineHeader = ["Период", "Объявлений", "Средняя за сотку, ₽", "Медианная, ₽", "Максимум, ₽", "Минимум, ₽"];
        const segmentHeader = ["Сегмент", "Объявлений", "Средняя за сотку, ₽", "Медианная, ₽"];

        const rows = [
            ["Отчёт по рынку земельных участков"],
            ["Период", `${formatDate(params.start)} — ${formatDate(params.end)}`],
            ["Территория", params.regionLabel],
            ["Интервал", params.interval],
            [],
            ["СВОДКА"],
            ["Средняя цена за сотку, ₽", summary ? Math.round(summary.averagePrice) : null],
            ["Медианная цена за сотку, ₽", summary ? Math.round(summary.medianPrice) : null],
            ["Объявлений", summary?.totalAnnouncements ?? 0],
            ["Изменение медианы год к году, %", summary && hasHistory ? summary.priceChangeDeltaPercentage : null],
            ["Изменение количества год к году, %", summary && hasHistory ? summary.countChangeDeltaPercentage : null],
            [],
            ["ДЕТАЛИЗАЦИЯ"],
            timelineHeader,
            ...timelineRows(current?.timeline || []),
            [],
            ["СЕГМЕНТАЦИЯ ПО ПЛОЩАДИ"],
            segmentHeader,
            ...segmentRows(current?.areaAnalytics),
            [],
            ["ТОТ ЖЕ ПЕРИОД ГОД НАЗАД", `${formatDate(params.previousStart)} — ${formatDate(params.previousEnd)}`],
            ["Объявлений", previous?.summary.totalAnnouncements ?? 0],
            timelineHeader,
            ...timelineRows(previous?.timeline || []),
            [],
            segmentHeader,
            ...segmentRows(previous?.areaAnalytics)
        ];

        // BOM + «;» — чтобы Excel сразу открыл файл с кириллицей и разбивкой по колонкам
        const csv = "﻿" + rows.map(row => row.map(csvCell).join(";")).join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");

        link.href = url;
        link.download = `market-report_${params.start}_${params.end}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);

        notify("Экспорт готов", `Файл ${link.download} сформирован`);
    }


    /* =========================================================
    СОБЫТИЯ
    ========================================================= */

    function clearQuickPeriod() {
        document
            .querySelectorAll(".quick-periods button")
            .forEach(item => item.classList.remove("active"));
    }

    function initQuickPeriods() {
        document
            .querySelectorAll(".quick-periods button")
            .forEach(button => {

                button.addEventListener("click", () => {
                    const range = quickPeriodRange(button.dataset.period);

                    if (!range) return;

                    clearQuickPeriod();
                    button.classList.add("active");

                    $("startDate").value = range[0];
                    $("endDate").value = range[1];

                    generateReport();
                });

            });
    }

    function initDates() {
        const startDate = $("startDate");
        const endDate = $("endDate");

        function validateDates() {
            clearQuickPeriod();

            if (startDate.value && endDate.value && startDate.value > endDate.value) {
                endDate.value = startDate.value;

                notify(
                    "Период скорректирован",
                    "Дата окончания не может быть раньше начала"
                );
            }
        }

        startDate.addEventListener("change", validateDates);
        endDate.addEventListener("change", validateDates);
    }

    function initTables() {
        ["currentTableBody", "historyTableBody"].forEach(id => {
            $(id).addEventListener("click", event => {
                const row = event.target.closest("tr");

                if (!row || row.classList.contains("table-empty")) return;

                document
                    .querySelectorAll(".data-table tbody tr")
                    .forEach(item => item.classList.remove("selected-row"));

                row.classList.add("selected-row");
            });
        });
    }

    function initChart() {
        const buttons = document.querySelectorAll(".chart-switcher button");

        buttons.forEach(button => {
            button.addEventListener("click", () => {
                buttons.forEach(item => item.classList.remove("active"));
                button.classList.add("active");

                state.chartMetric = button.dataset.chart;

                if (state.report) {
                    renderChart();
                }
            });
        });

        const area = $("chartArea");

        area.addEventListener("mousemove", handleChartHover);
        area.addEventListener("mouseleave", () => {
            if (state.chartPoints.length) {
                setActivePoint(defaultPointIndex());
            }
        });

        window.addEventListener("resize", () => {
            if (state.chartPoints.length) {
                setActivePoint(state.activePoint);
            }
        });
    }

    function init() {
        const button = $("generateReport");

        generateButtonHtml = button.innerHTML;

        const [start, end] = quickPeriodRange("current");

        $("startDate").value = start;
        $("endDate").value = end;

        button.addEventListener("click", () => generateReport());
        $("interval").addEventListener("change", () => generateReport());
        $("region").addEventListener("change", () => generateReport());
        $("exportButton")?.addEventListener("click", exportReport);

        initQuickPeriods();
        initDates();
        initTables();
        initChart();

        loadTotalCount();
        generateReport({ silent: true });
    }


    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
