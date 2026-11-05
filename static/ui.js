/* =========================================================
   CAMPUSVOICE · UI helpers
   Toasts, dialogs/sheets, icons and formatting shared by
   script.js and media.js. Loaded before both.
========================================================= */


/* ---------- Feedback areas ---------- */

const AREAS = {
    "Information Accessibility": {
        key: "info",
        short: "Info Access",
        chip: "Info",
        icon: "campaign"
    },
    "Quality & Condition": {
        key: "quality",
        short: "Quality & Condition",
        chip: "Quality",
        icon: "handyman"
    },
    "Responsiveness": {
        key: "resp",
        short: "Responsiveness",
        chip: "Responsiveness",
        icon: "forum"
    }
};


/* ---------- Small formatting helpers ---------- */

const AVATAR_COLORS = ["#ffc83d", "#d6eee8", "#ffd9c7", "#ffe8a6", "#dbefe0"];

// Same name, same colour, every time
function avatarColor(name) {

    let hash = 0;

    for (const ch of String(name || "")) {
        hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    }

    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// "ana.reyes" -> "AR", "marco" -> "MA"
function initialsOf(name) {

    const parts = String(name || "")
        .split(/[._\s-]+/)
        .filter(Boolean);

    const letters = parts.length > 1
        ? parts[0][0] + parts[1][0]
        : (parts[0] || "?").slice(0, 2);

    return letters.toUpperCase();
}

function icon(name, extra) {

    return '<span class="msr' + (extra ? " " + extra : "") +
        '" aria-hidden="true">' + name + "</span>";
}

// escapeHTML (script.js) leaves quotes alone; this is safe in attributes
function escapeAttr(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function truncate(text, max) {

    const value = String(text || "").trim();

    return value.length > max
        ? value.slice(0, max - 1).trimEnd() + "…"
        : value;
}

// "Just now", "12m ago", "2h ago", "Yesterday · 4:40 PM", "Nov 1"
function relTime(value) {

    const date = new Date(value);

    if (isNaN(date)) {
        return "";
    }

    const seconds = (Date.now() - date.getTime()) / 1000;

    if (seconds < 60) {
        return "Just now";
    }

    if (seconds < 3600) {
        return Math.floor(seconds / 60) + "m ago";
    }

    if (seconds < 86400) {
        return Math.floor(seconds / 3600) + "h ago";
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === yesterday.toDateString()) {
        return "Yesterday · " + date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit"
        });
    }

    return shortDate(value);
}

// "Nov 5", or "Nov 5, 2025" outside the current year
function shortDate(value) {

    const date = new Date(value);

    if (isNaN(date)) {
        return "";
    }

    const options = { month: "short", day: "numeric" };

    if (date.getFullYear() !== new Date().getFullYear()) {
        options.year = "numeric";
    }

    return date.toLocaleDateString("en-US", options);
}

// "Good afternoon, Ana"
function greetingFor(username) {

    const hour = new Date().getHours();

    const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

    const first = String(username || "").split(/[._\s-]+/)[0] || "";

    const name = first
        ? first.charAt(0).toUpperCase() + first.slice(1)
        : "there";

    return "Good " + part + ", " + name;
}


/* =========================================================
   TOASTS
   Replace browser alert() everywhere. Tone is guessed from
   the wording unless the caller passes one.
========================================================= */

const TOAST_SUCCESS_WORDS =
    /submitted|posted|thank|recorded|saved|marked|success|welcome/i;

function showToast(message, options = {}) {

    const region = document.getElementById("toasts");

    if (!region) {
        return function () {};
    }

    const text = String(message ?? "");

    const tone = options.tone ||
        (TOAST_SUCCESS_WORDS.test(text) ? "success" : "error");

    const toast = document.createElement("div");

    toast.className = "toast toast-" + tone;

    toast.setAttribute("role", tone === "error" ? "alert" : "status");

    toast.innerHTML =
        '<span class="toast-ico">' +
        icon(options.icon || (tone === "error" ? "error" : "check")) +
        '</span><span class="toast-msg"></span>';

    toast.querySelector(".toast-msg").textContent = text;

    let timer = null;

    function dismiss() {

        clearTimeout(timer);

        toast.classList.add("is-leaving");

        setTimeout(() => toast.remove(), 180);
    }

    if (options.action) {

        const action = document.createElement("button");

        action.type = "button";
        action.className = "toast-action";
        action.textContent = options.action.label;

        action.addEventListener("click", () => {
            dismiss();
            options.action.onClick();
        });

        toast.appendChild(action);
    }

    const close = document.createElement("button");

    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = icon("close");
    close.addEventListener("click", dismiss);

    toast.appendChild(close);

    region.appendChild(toast);

    // Keep at most three on screen
    while (region.children.length > 3) {
        region.firstElementChild.remove();
    }

    timer = setTimeout(
        dismiss,
        options.duration || (tone === "error" ? 6000 : 4500)
    );

    return dismiss;
}

window.alert = message => showToast(message);


/* =========================================================
   DIALOGS AND SHEETS
   Any element with class "modal" works with these.
========================================================= */

const modalReturnFocus = {};

function openModal(id) {

    const modal = document.getElementById(id);

    if (!modal) {
        return;
    }

    modalReturnFocus[id] = document.activeElement;

    modal.classList.remove("hidden");

    document.body.classList.add("has-modal");

    const target =
        modal.querySelector("[data-autofocus]") ||
        modal.querySelector("button, input, textarea, select");

    setTimeout(() => target && target.focus(), 30);
}

function closeModal(id) {

    const modal = document.getElementById(id);

    if (!modal || modal.classList.contains("hidden")) {
        return;
    }

    modal.classList.add("hidden");

    if (!document.querySelector(".modal:not(.hidden)")) {
        document.body.classList.remove("has-modal");
    }

    const back = modalReturnFocus[id];

    if (back && document.contains(back) && back.focus) {
        back.focus();
    }
}

function closeAllModals() {

    document
        .querySelectorAll(".modal")
        .forEach(modal => modal.classList.add("hidden"));

    document.body.classList.remove("has-modal");
}

const openSheet = openModal;
const closeSheet = closeModal;

// Clicking the dimmed backdrop closes it
document.addEventListener("click", event => {

    const modal = event.target;

    if (
        modal.classList &&
        modal.classList.contains("modal") &&
        !modal.classList.contains("is-posting")
    ) {
        closeModal(modal.id);
    }
});

document.addEventListener("keydown", event => {

    if (event.key !== "Escape") {
        return;
    }

    const open = [...document.querySelectorAll(".modal:not(.hidden)")].pop();

    if (open && !open.classList.contains("is-posting")) {
        closeModal(open.id);
    }
});


/* =========================================================
   PHOTO VIEWER
   Click a photo in a post to see the whole image.
========================================================= */

function openPhotoViewer(src, alt) {

    let viewer = document.getElementById("photoViewer");

    if (!viewer) {

        viewer = document.createElement("div");

        viewer.id = "photoViewer";
        viewer.className = "modal photo-viewer hidden";
        viewer.setAttribute("role", "dialog");
        viewer.setAttribute("aria-modal", "true");
        viewer.setAttribute("aria-label", "Photo");

        viewer.innerHTML =
            '<button type="button" class="icon-btn viewer-close" aria-label="Close photo" ' +
            'onclick="closeModal(\'photoViewer\')">' + icon("close") + "</button>" +
            '<img class="viewer-img" alt="">';

        document.body.appendChild(viewer);
    }

    const image = viewer.querySelector(".viewer-img");

    image.src = src;
    image.alt = alt || "Photo";

    openModal("photoViewer");
}


document.addEventListener("click", event => {

    const photo = event.target.closest && event.target.closest(".review-media .review-image");

    // Live Photos use press-and-hold to play, so leave those alone
    if (photo && !photo.closest(".live-photo")) {
        openPhotoViewer(photo.currentSrc || photo.src, photo.alt);
    }
});
