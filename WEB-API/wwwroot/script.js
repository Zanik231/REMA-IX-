const body = document.body;
const themeButton = document.getElementById("themeButton");
const toast = document.getElementById("toast");
const toastTitle = document.getElementById("toastTitle");
const toastText = document.getElementById("toastText");

let toastTimer;

function showToast(title, message) {
    if (!toast) return;
    if (toastTitle) {
        toastTitle.textContent = title;
    }
    if (toastText) {
        toastText.textContent = message;
    }
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

if (themeButton) {
    themeButton.addEventListener("click", () => {
        body.classList.toggle("dark-theme");
        const dark =
            body.classList.contains("dark-theme");
        themeButton.textContent =
            dark ? "☀" : "◐";
        localStorage.setItem(
            "landscope-theme",
            dark ? "dark" : "light"
        );
        showToast(
            "Тема изменена",
            dark
                ? "Тёмная тема включена"
                : "Светлая тема включена"
        );
    });
}


if (
    localStorage.getItem("landscope-theme") === "dark"
) {
    body.classList.add("dark-theme");

    if (themeButton) {
        themeButton.textContent = "☀";
    }
}

const generateButton =
    document.getElementById("generateReport");
const startDate =
    document.getElementById("startDate");
const endDate =
    document.getElementById("endDate");
const interval =
    document.getElementById("interval");
const region =
    document.getElementById("region");


if (generateButton) {
    generateButton.addEventListener("click", () => {
        const originalHTML =
            generateButton.innerHTML;
        generateButton.disabled = true;
        generateButton.innerHTML =
            "<span>Формирование...</span>";
        setTimeout(() => {
            generateButton.disabled = false;
            generateButton.innerHTML =
                originalHTML;
            updatePeriodText();
            showToast(
                "Отчёт сформирован",
                "Данные обновлены по выбранным параметрам"
            );
        }, 900);
    });

}
function formatDate(dateString) {

    if (!dateString) {
        return "";
    }

    const date =
        new Date(dateString + "T00:00:00");

    return date.toLocaleDateString(
        "ru-RU",
        {
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    );

}


function updatePeriodText() {

    const periodText =
        document.getElementById("periodText");

    if (!periodText) return;

    const start =
        formatDate(startDate?.value);

    const end =
        formatDate(endDate?.value);

    if (!start || !end) return;

    periodText.innerHTML =
        `${start} — ${end}
        <span>·</span>
        Найдено: 415`;

}

const quickButtons =
    document.querySelectorAll(
        ".quick-periods button"
    );


quickButtons.forEach(button => {

    button.addEventListener("click", () => {

        quickButtons.forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        const period =
            button.dataset.period;

        if (
            period === "2026" ||
            period === "current"
        ) {

            if (startDate) {
                startDate.value = "2026-01-01";
            }

            if (endDate) {
                endDate.value = "2026-09-18";
            }

        }

        if (period === "2025") {

            if (startDate) {
                startDate.value = "2025-01-01";
            }

            if (endDate) {
                endDate.value = "2025-12-31";
            }

        }

        if (period === "2024") {

            if (startDate) {
                startDate.value = "2024-01-01";
            }

            if (endDate) {
                endDate.value = "2024-12-31";
            }

        }

        if (period === "2023") {

            if (startDate) {
                startDate.value = "2023-01-01";
            }

            if (endDate) {
                endDate.value = "2023-12-31";
            }

        }

        if (period === "previous") {

            if (startDate) {
                startDate.value = "2025-01-01";
            }

            if (endDate) {
                endDate.value = "2025-09-18";
            }

        }

        if (period === "12") {

            if (startDate) {
                startDate.value = "2025-09-18";
            }

            if (endDate) {
                endDate.value = "2026-09-18";
            }

        }

        updatePeriodText();

        showToast(
            "Период выбран",
            button.textContent.trim()
        );

    });

});
if (interval) {

    interval.addEventListener("change", () => {

        const value =
            interval.value === "months"
                ? "по месяцам"
                : "по кварталам";

        showToast(
            "Интервал изменён",
            `Отчёт будет разбит ${value}`
        );

    });

}

if (region) {

    region.addEventListener("change", () => {

        showToast(
            "Регион изменён",
            region.value
        );

    });

}


const chartButtons =
    document.querySelectorAll(
        ".chart-switcher button"
    );

const chartTooltip =
    document.querySelector(".chart-tooltip");

const currentLine =
    document.querySelector(".current-line");

const areaPath =
    document.querySelector(".area-path");

const chartPoint =
    document.querySelector(".chart-point");


chartButtons.forEach(button => {

    button.addEventListener("click", () => {

        chartButtons.forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        const chartType =
            button.dataset.chart;

        if (chartType === "median") {

            if (currentLine) {

                currentLine.setAttribute(
                    "d",
                    `
                    M0 300
                    C90 294 135 280 205 270
                    C275 258 320 265 390 242
                    C455 219 510 226 570 202
                    C640 178 680 185 745 159
                    C820 139 860 145 1000 119
                    `
                );

            }

            if (areaPath) {

                areaPath.setAttribute(
                    "d",
                    `
                    M0 300
                    C90 294 135 280 205 270
                    C275 258 320 265 390 242
                    C455 219 510 226 570 202
                    C640 178 680 185 745 159
                    C820 139 860 145 1000 119
                    L1000 360
                    L0 360 Z
                    `
                );

            }

            if (chartPoint) {
                chartPoint.setAttribute(
                    "cy",
                    "119"
                );
            }

            if (chartTooltip) {

                chartTooltip.innerHTML = `
                    <span>Сентябрь 2026</span>
                    <strong>49 760 ₽</strong>
                    <b>↑ 16%</b>
                `;

            }

            showToast(
                "Показатель изменён",
                "Сейчас отображается медианная цена"
            );

        } else {

            if (currentLine) {

                currentLine.setAttribute(
                    "d",
                    `
                    M0 275
                    C90 266 135 248 205 237
                    C275 226 320 235 390 195
                    C455 160 510 180 570 140
                    C640 96 680 112 745 82
                    C820 48 860 67 1000 38
                    `
                );

            }

            if (areaPath) {

                areaPath.setAttribute(
                    "d",
                    `
                    M0 275
                    C90 266 135 248 205 237
                    C275 226 320 235 390 195
                    C455 160 510 180 570 140
                    C640 96 680 112 745 82
                    C820 48 860 67 1000 38
                    L1000 360
                    L0 360 Z
                    `
                );

            }

            if (chartPoint) {
                chartPoint.setAttribute(
                    "cy",
                    "38"
                );
            }

            if (chartTooltip) {

                chartTooltip.innerHTML = `
                    <span>Сентябрь 2026</span>
                    <strong>73 843 ₽</strong>
                    <b>↑ 12%</b>
                `;

            }

            showToast(
                "Показатель изменён",
                "Сейчас отображается средняя цена"
            );

        }

    });

});

const exportButton =
    document.getElementById("exportButton");


if (exportButton) {

    exportButton.addEventListener("click", () => {

        const original =
            exportButton.innerHTML;

        exportButton.disabled = true;

        exportButton.innerHTML =
            "Подготовка...";

        setTimeout(() => {

            exportButton.disabled = false;

            exportButton.innerHTML =
                original;

            showToast(
                "Экспорт готов",
                "Отчёт подготовлен для скачивания"
            );

        }, 800);

    });

}

if (startDate && endDate) {

    function validateDates() {

        if (
            startDate.value &&
            endDate.value &&
            startDate.value > endDate.value
        ) {

            endDate.value =
                startDate.value;

            showToast(
                "Период скорректирован",
                "Дата окончания не может быть раньше начала"
            );

        }

    }

    startDate.addEventListener(
        "change",
        validateDates
    );

    endDate.addEventListener(
        "change",
        validateDates
    );

}

document
    .querySelectorAll(".data-table tbody tr")
    .forEach(row => {

        row.addEventListener("click", () => {

            document
                .querySelectorAll(".data-table tbody tr")
                .forEach(item => {
                    item.classList.remove("selected-row");
                });

            row.classList.add("selected-row");

        });

    });

