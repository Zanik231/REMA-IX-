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
