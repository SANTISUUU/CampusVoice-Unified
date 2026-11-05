/* =========================================================
   CAMPUSVOICE JAVASCRIPT
========================================================= */


/* =========================================================
   GLOBAL VARIABLES
========================================================= */

let currentUser = null;

let selectedRating = 0;

let allReviews = [];


/* =========================================================
   ELEMENTS
========================================================= */

const landingPage =
    document.getElementById("landingPage");

const authPage =
    document.getElementById("authPage");

const mainPage =
    document.getElementById("mainPage");


/* =========================================================
   AUTH NAVIGATION
========================================================= */

function showLogin() {

    hideGuestPage();

    landingPage.style.display = "none";

    authPage.style.display = "flex";

    mainPage.style.display = "none";


    document
        .getElementById("loginForm")
        .classList.remove("hidden");


    document
        .getElementById("signupForm")
        .classList.add("hidden");

    document.getElementById("forgotForm").classList.add("hidden");
}


function showSignup() {

    hideGuestPage();

    landingPage.style.display = "none";

    authPage.style.display = "flex";

    mainPage.style.display = "none";


    document
        .getElementById("loginForm")
        .classList.add("hidden");


    document
        .getElementById("signupForm")
        .classList.remove("hidden");

    document.getElementById("forgotForm").classList.add("hidden");
}


function backHome() {

    hideGuestPage();

    landingPage.style.display = "flex";

    authPage.style.display = "none";

    mainPage.style.display = "none";
}


/* =========================================================
   API HELPER
========================================================= */

/*
   All data lives on the Flask server (campusvoice.db).
   api(path) reads; api(path, body) sends JSON.
*/

async function api(path, body) {

    const options = {

        method:
            body === undefined
                ? "GET"
                : "POST",

        headers: {},

        credentials: "same-origin"

    };


    if (body !== undefined) {

        options.headers["Content-Type"] =
            "application/json";

        options.body =
            JSON.stringify(body);
    }


    let response;

    try {

        response =
            await fetch(path, options);

    } catch (networkError) {

        throw new Error(
            "Can't reach the server. Is it running?"
        );
    }


    const data =
        await response.json().catch(() => ({}));


    if (!response.ok) {

        throw new Error(
            data.error || "Something went wrong."
        );
    }


    return data;
}


/* =========================================================
   SIGN UP
========================================================= */

async function signupUser() {

    const username =
        document
            .getElementById("signupUsername")
            .value
            .trim();


    const studentNumber =
        document
            .getElementById("signupStudentNumber")
            .value
            .trim();


    const password =
        document
            .getElementById("signupPassword")
            .value;


    const confirm =
        document
            .getElementById("signupConfirm")
            .value;


    if (
        username === "" ||
        studentNumber === "" ||
        password === "" ||
        confirm === ""
    ) {

        alert(
            "Please complete all fields."
        );

        return;
    }


    if (!/^[0-9]{2}-[0-9]{4}-[0-9]{3}$/.test(studentNumber)) {

        alert(
            "Student number must look like 21-0123-456."
        );

        return;
    }


    if (username.length < 3) {

        alert(
            "Username must contain at least 3 characters."
        );

        return;
    }


    if (password.length < 6) {

        alert(
            "Password must contain at least 6 characters."
        );

        return;
    }


    if (password !== confirm) {

        alert(
            "Passwords do not match."
        );

        return;
    }


    try {

        await api(
            "/api/signup",
            {
                username: username,
                student_number: studentNumber,
                password: password
            }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    alert(
        "Account created successfully!"
    );


    document.getElementById(
        "signupUsername"
    ).value = "";


    document.getElementById(
        "signupStudentNumber"
    ).value = "";


    document.getElementById(
        "signupPassword"
    ).value = "";


    document.getElementById(
        "signupConfirm"
    ).value = "";


    showLogin();


    document.getElementById(
        "loginUsername"
    ).value = username;
}


/* =========================================================
   LOGIN
========================================================= */

async function loginUser() {

    const username =
        document
            .getElementById("loginUsername")
            .value
            .trim();


    const password =
        document
            .getElementById("loginPassword")
            .value;


    if (
        username === "" ||
        password === ""
    ) {

        alert(
            "Please enter your username and password."
        );

        return;
    }


    try {

        const data = await api(
            "/api/login",
            {
                username: username,
                password: password
            }
        );

        currentUser = data.user;

    } catch (failure) {

        alert(failure.message);

        return;
    }


    openMainPage();
}


/* =========================================================
   OPEN MAIN PAGE
========================================================= */

function openMainPage() {

    hideGuestPage();

    landingPage.style.display = "none";

    authPage.style.display = "none";

    mainPage.style.display = "block";

    document.getElementById("adminPage").style.display = "none";


    const isAdmin = !!currentUser.is_admin;

    document
        .querySelectorAll(".admin-only")
        .forEach(el => el.classList.toggle("hidden", !isAdmin));

    document
        .querySelectorAll(".student-only")
        .forEach(el => el.classList.toggle("hidden", isAdmin));


    // Name, student number and avatar everywhere they appear
    const name = currentUser.username;

    document.getElementById("currentUser").textContent = name;

    document
        .querySelectorAll("[data-user-name]")
        .forEach(el => { el.textContent = name; });

    document
        .querySelectorAll("[data-user-number]")
        .forEach(el => { el.textContent = currentUser.student_number || ""; });

    document
        .querySelectorAll("[data-user-avatar]")
        .forEach(el => {
            el.textContent = initialsOf(name);
            el.style.background = avatarColor(name);
        });

    document.getElementById("greeting").textContent = greetingFor(name);


    // Admins get the pending count on their Admin link
    if (isAdmin) {

        api("/api/admin/workload")
            .then(data => {
                adminData = data;
                updateStatistics();
            })
            .catch(() => {});
    }

    loadReviews();
}


/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

    try {

        await api("/api/logout", {});

    } catch (failure) {

        // Already logged out on the server; carry on
    }


    currentUser = null;

    allReviews = [];

    reviewsLoaded = false;

    adminData = null;

    resetMediaPicker();

    closeAllModals();

    hideGuestPage();

    mainPage.style.display = "none";

    document.getElementById("adminPage").style.display = "none";

    landingPage.style.display = "flex";


    document.getElementById("loginUsername").value = "";

    document.getElementById("loginPassword").value = "";
}


/* =========================================================
   STAR RATING
========================================================= */

const RATING_WORDS = ["", "Poor", "Fair", "Okay", "Good", "Great"];

function selectStar(number) {

    selectedRating = number;


    document
        .querySelectorAll(".star")
        .forEach((star, index) => {

            star.classList.toggle("active", index < number);

            star.setAttribute("aria-checked", String(index === number - 1));
        });


    const word = document.getElementById("ratingWord");

    if (word) {

        word.textContent = number
            ? number + " · " + RATING_WORDS[number]
            : "";

        word.dataset.level = number;

        word.classList.toggle("hidden", !number);
    }
}


/* =========================================================
   COMPOSE DIALOG
========================================================= */

function openCompose(area) {

    if (!currentUser) {
        return;
    }

    if (area && AREAS[area]) {
        chooseArea(area);
    } else if (AREAS[currentArea]) {
        chooseArea(currentArea);
    } else {
        chooseArea(document.getElementById("reviewCategory").value);
    }

    updateReviewCounter();

    openModal("composeModal");
}


function closeCompose() {

    const modal = document.getElementById("composeModal");

    // Fields stay locked while a post is uploading
    if (modal.classList.contains("is-posting")) {
        return;
    }

    closeModal("composeModal");
}


function chooseArea(value) {

    document.getElementById("reviewCategory").value = value;

    document
        .querySelectorAll(".area-tile")
        .forEach(tile => {
            tile.setAttribute(
                "aria-checked",
                String(tile.dataset.value === value)
            );
        });
}


function updateReviewCounter() {

    document.getElementById("reviewCount").textContent =
        document.getElementById("reviewInput").value.length;
}


/* =========================================================
   PHOTO / VIDEO / LIVE PHOTO
   Picking, compressing, validating and uploading live in
   media.js. handleMediaSelect() runs when a file is chosen.
========================================================= */


/* =========================================================
   POST REVIEW
========================================================= */

async function postReview() {

    if (!currentUser) {

        showToast("Please log in first.");

        return;
    }


    const category =
        document.getElementById("reviewCategory").value;

    const input =
        document.getElementById("reviewInput");

    const text =
        input.value.trim();


    if (selectedRating === 0) {

        showToast("Please select a rating from 1 to 5 stars.");

        return;
    }


    if (text === "") {

        showToast("Please write your feedback.");

        input.focus();

        return;
    }


    // A picked photo/video is still being checked or compressed
    if (mediaBusy) {

        showToast(
            "Your photo or video is still being prepared. " +
            "Please wait a moment."
        );

        return;
    }


    const submitButton =
        document.querySelector(".post-review-btn");

    const submitLabel =
        submitButton.innerHTML;

    const progressBar =
        document.getElementById("mediaProgress");

    const modal =
        document.getElementById("composeModal");


    // Lock the form while the files upload
    submitButton.disabled = true;

    submitButton.classList.add("is-busy");

    modal.classList.add("is-posting");

    input.readOnly = true;

    document.getElementById("photoInput").disabled = true;

    document.getElementById("mediaRemove").disabled = true;


    try {

        // Photo / video / Live Photo go up first; the post then
        // only stores their addresses
        let media = { image: "", video: "", live: false };


        if (currentMedia) {

            progressBar.value = 0;

            progressBar.classList.remove("hidden");


            media = await uploadCurrentMedia(
                fraction => {

                    progressBar.value = fraction;

                    submitButton.textContent =
                        "Uploading… " +
                        Math.round(fraction * 100) + "%";
                }
            );
        }


        submitButton.textContent = "Posting…";


        await api(
            "/api/reviews",
            {
                category: category,
                rating: selectedRating,
                text: text,
                image: media.image,
                video: media.video,
                live: media.live
            }
        );

    } catch (failure) {

        // The dialog stays open with the text so nothing is lost
        showToast(failure.message, { tone: "error" });

        return;

    } finally {

        submitButton.disabled = false;

        submitButton.classList.remove("is-busy");

        submitButton.innerHTML = submitLabel;

        modal.classList.remove("is-posting");

        input.readOnly = false;

        document.getElementById("photoInput").disabled = false;

        document.getElementById("mediaRemove").disabled = false;

        progressBar.classList.add("hidden");
    }


    // Reset form
    input.value = "";

    updateReviewCounter();

    resetMediaPicker();

    selectStar(0);

    closeCompose();


    document.getElementById("searchInput").value = "";

    setArea("all");

    await loadReviews();

    showToast("Feedback posted. Thanks!", { tone: "success" });


    document
        .getElementById("reviewsContainer")
        .scrollIntoView({ behavior: "smooth", block: "start" });
}


/* =========================================================
   LOAD REVIEWS
========================================================= */

let reviewsLoaded = false;

let reviewsError = "";

async function loadReviews() {

    // Skeletons only on the first load; refreshes keep the feed
    if (!reviewsLoaded) {
        renderFeedSkeleton();
    }


    try {

        const data =
            await api("/api/reviews");

        allReviews = data.reviews;

        reviewsLoaded = true;

        reviewsError = "";

    } catch (failure) {

        reviewsError = failure.message;

        if (!reviewsLoaded) {
            renderFeedError();
        } else {
            showToast(failure.message, { tone: "error" });
        }

        return;
    }


    renderReviews();
}


// "all", one of the AREAS names, or "fixed" (completed posts)
let currentArea = "all";


function setArea(area) {

    currentArea = area;


    document
        .querySelectorAll("[data-area-chip]")
        .forEach(chip => {

            const on = chip.dataset.areaChip === area;

            chip.classList.toggle("is-active", on);

            chip.setAttribute("aria-selected", String(on));
        });


    document
        .querySelectorAll("[data-nav]")
        .forEach(link => {

            const on = link.dataset.nav === area;

            link.classList.toggle("is-active", on);

            if (on) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });


    document
        .querySelectorAll("#mainPage .tabbar [data-tab]")
        .forEach(tab => {
            tab.classList.toggle(
                "is-active",
                tab.dataset.tab === (area === "fixed" ? "fixed" : "feed")
            );
        });


    closeSheet("areasSheet");


    if (document.getElementById("adminPage").style.display === "block") {
        hideAdmin();
    }

    renderReviews();
}


function clearSearch() {

    const input = document.getElementById("searchInput");

    input.value = "";

    renderReviews();

    input.focus();
}


function focusSearch() {

    const input = document.getElementById("searchInput");

    input.scrollIntoView({ behavior: "smooth", block: "center" });

    input.focus({ preventScroll: true });
}


function jumpToPost(id) {

    let post = document.getElementById("post-" + id);

    if (!post) {

        document.getElementById("searchInput").value = "";

        setArea("all");

        post = document.getElementById("post-" + id);
    }

    if (!post) {
        return;
    }

    post.scrollIntoView({ behavior: "smooth", block: "center" });

    post.classList.remove("is-highlighted");

    void post.offsetWidth;

    post.classList.add("is-highlighted");
}


function renderReviews() {

    const container =
        document.getElementById("reviewsContainer");

    if (!container || !reviewsLoaded) {
        return;
    }


    const search =
        (document.getElementById("searchInput")?.value || "")
            .toLowerCase()
            .trim();

    document
        .querySelector("#mainPage .search-field")
        ?.classList.toggle("has-value", search !== "");


    let reviews = allReviews.slice();


    if (currentArea === "fixed") {

        reviews = reviews.filter(review => review.status === "completed");

    } else if (currentArea !== "all") {

        reviews = reviews.filter(review => review.category === currentArea);
    }


    if (search !== "") {

        reviews = reviews.filter(
            review =>
                review.text.toLowerCase().includes(search) ||
                review.username.toLowerCase().includes(search) ||
                review.category.toLowerCase().includes(search)
        );
    }


    const byDate = (a, b) => new Date(b.date) - new Date(a.date);

    const sort = document.getElementById("sortSelect")?.value || "newest";

    if (sort === "top") {
        reviews.sort((a, b) => b.rating - a.rating || byDate(a, b));
    } else if (sort === "liked") {
        reviews.sort((a, b) => b.likes - a.likes || byDate(a, b));
    }


    const scope =
        currentArea === "fixed" ? " marked completed"
        : currentArea !== "all" ? " in " + currentArea
        : "";

    document.getElementById("feedCount").textContent =
        reviews.length + (reviews.length === 1 ? " post" : " posts") + scope;


    container.innerHTML = "";


    if (reviews.length === 0) {

        container.appendChild(
            search !== "" ? noResultsState(search) : emptyState()
        );

    } else {

        reviews.forEach(review => renderReview(review, container));
    }


    updateStatistics();
}


/* ---------- Feed states ---------- */

function feedState(html) {

    const state = document.createElement("div");

    state.className = "feed-state";

    state.innerHTML = html;

    return state;
}


function emptyState() {

    if (currentArea === "fixed") {

        return feedState(
            '<div class="state-art state-art-empty">' +
            '<span class="art-sun"></span>' +
            '<span class="art-card">' + icon("task_alt") + "</span></div>" +
            "<h2>Nothing marked fixed yet</h2>" +
            "<p>When the department completes an issue, it shows up here.</p>"
        );
    }

    const body = AREAS[currentArea]
        ? "Be the first to rate " + escapeHTML(currentArea) +
          ". Even small things help the department improve."
        : "Be the first to share feedback. Even small things help the department improve.";

    return feedState(
        '<div class="state-art state-art-empty">' +
        '<span class="art-sun"></span>' +
        '<span class="art-card">' + icon("chat_add_on") + "</span></div>" +
        "<h2>No feedback here yet</h2>" +
        "<p>" + body + "</p>" +
        '<button type="button" class="btn btn-accent btn-lg" onclick="openCompose()">' +
        icon("edit") + "Share feedback</button>"
    );
}


function noResultsState(search) {

    const scoped = currentArea !== "all";

    const scopeName = currentArea === "fixed" ? "Recently fixed" : currentArea;

    const hint = scoped
        ? "Searching in <b>" + escapeHTML(scopeName) + "</b>. Try fewer words or all areas."
        : "Try fewer or different words.";

    return feedState(
        '<div class="state-art state-art-search">' +
        '<span class="art-tile"></span>' +
        '<span class="art-circle">' + icon("search_off") + "</span></div>" +
        "<h2>No posts match “" + escapeHTML(search) + "”</h2>" +
        "<p>" + hint + "</p>" +
        '<div class="state-actions">' +
        (scoped
            ? '<button type="button" class="btn btn-secondary" onclick="setArea(\'all\')">Search all areas</button>'
            : "") +
        '<button type="button" class="btn btn-link" onclick="clearSearch()">Clear</button>' +
        "</div>"
    );
}


function renderFeedSkeleton() {

    const container = document.getElementById("reviewsContainer");

    const card = lines =>
        '<div class="skeleton-card">' +
        '<div class="sk-row"><span class="sk sk-avatar"></span>' +
        '<span class="sk-col"><span class="sk sk-line" style="width:40%"></span>' +
        '<span class="sk sk-line sk-soft" style="width:25%"></span></span></div>' +
        '<span class="sk sk-pill"></span>' +
        lines +
        "</div>";

    container.innerHTML =
        '<div class="feed-loading" aria-busy="true" aria-label="Loading feedback">' +
        card(
            '<span class="sk sk-line"></span>' +
            '<span class="sk sk-line" style="width:85%"></span>' +
            '<span class="sk sk-media"></span>'
        ) +
        card('<span class="sk sk-line"></span>') +
        "</div>";

    document.getElementById("feedCount").textContent = "";
}


function renderFeedError() {

    const container = document.getElementById("reviewsContainer");

    container.innerHTML = "";

    container.appendChild(
        feedState(
            '<div class="state-art state-art-error">' +
            '<span class="art-blob"></span>' +
            '<span class="art-card">' + icon("cloud_off") + "</span></div>" +
            "<h2>Couldn’t load the feed</h2>" +
            "<p>" + escapeHTML(reviewsError || "Check your connection and try again.") + "</p>" +
            '<button type="button" class="btn btn-primary btn-lg" onclick="loadReviews()">' +
            icon("refresh") + "Try again</button>"
        )
    );

    document.getElementById("feedCount").textContent = "";
}


/* =========================================================
   RENDER REVIEW
========================================================= */

function formatDate(value) {

    return new Date(value).toLocaleDateString(
        "en-US",
        {
            year: "numeric",
            month: "long",
            day: "numeric"
        }
    );
}


function renderReview(
    review,
    container
) {

    const element =
        document.createElement("article");

    element.className = "post-card";

    element.id = "post-" + review.id;


    const area = AREAS[review.category] ||
        { key: "info", icon: "label", chip: review.category };

    const rating = Number(review.rating) || 0;

    const stars = [1, 2, 3, 4, 5]
        .map(i => icon("star", i <= rating ? "star-on" : "star-off"))
        .join("");


    let status = "";

    if (review.status === "completed") {
        status = '<span class="status-pill is-done">' + icon("check_circle", "fill") + "Completed</span>";
    } else if (review.status === "pending") {
        status = '<span class="status-pill is-pending">' + icon("schedule") + "Pending</span>";
    }


    /*
       review.likes is the real number of likes (from the database).
       review.liked_by contains usernames returned by Flask. Escape each
       username before inserting it into the rendered post.
    */
    const likedBy = Array.isArray(review.liked_by)
        ? review.liked_by.map(String)
        : [];

    let likedByHTML = "";

    if (likedBy.length) {

        const me = currentUser ? currentUser.username : "";

        const names = likedBy
            .map(name => (name === me ? "you" : name))
            .sort((a, b) => (b === "you") - (a === "you"));

        let label;

        if (names.length <= 3) {
            label = names.length === 1
                ? names[0]
                : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
        } else {
            label = names.slice(0, 2).join(", ") + " and " + (names.length - 2) + " others";
        }

        const faces = likedBy
            .slice(0, 3)
            .map(name => '<span class="face" style="background:' + avatarColor(name) + '"></span>')
            .join("");

        likedByHTML =
            '<div class="liked-by" title="' + escapeAttr(likedBy.join(", ")) + '">' +
            '<span class="faces" aria-hidden="true">' + faces + "</span>" +
            "<span>Liked by <b>" + escapeHTML(label) + "</b></span></div>";
    }


    const repliesHTML = review.replies
        .map(reply =>
            '<div class="reply">' +
            '<span class="avatar avatar-sm" style="background:' + avatarColor(reply.username) + '" aria-hidden="true">' +
            escapeHTML(initialsOf(reply.username)) + "</span>" +
            '<div class="reply-bubble">' +
            '<span class="reply-meta"><b>' + escapeHTML(reply.username) + "</b>" +
            (reply.date ? " <span>· " + escapeHTML(relTime(reply.date)) + "</span>" : "") +
            "</span>" +
            '<span class="reply-text">' + escapeHTML(reply.text) + "</span>" +
            "</div></div>"
        )
        .join("");


    const liked = review.my_reaction === "like";

    const disliked = review.my_reaction === "dislike";

    const me = currentUser ? currentUser.username : "";

    const replyCount = review.replies.length;


    element.innerHTML = `
        <div class="post-head">
            <span class="avatar" style="background:${avatarColor(review.username)}" aria-hidden="true">${escapeHTML(initialsOf(review.username))}</span>
            <div class="post-who">
                <b>${escapeHTML(review.username)}</b>
                <time datetime="${escapeAttr(review.date)}" title="${escapeAttr(formatDate(review.date))}">${escapeHTML(relTime(review.date))}</time>
            </div>
            ${status}
        </div>
        <div class="post-meta">
            <span class="area-chip" data-area="${area.key}">${icon(area.icon)}${escapeHTML(review.category)}</span>
            <span class="stars" role="img" aria-label="${rating} out of 5 stars">${stars}<b>${rating.toFixed(1)}</b></span>
        </div>
        <p class="post-text">${escapeHTML(review.text)}</p>
        <div class="review-media"></div>
        ${likedByHTML}
        <div class="post-actions">
            <button type="button" class="act${liked ? " is-liked" : ""}" aria-pressed="${liked}" aria-label="${liked ? "Unlike" : "Like"}, ${review.likes} likes" onclick="likeReview(${review.id})">${icon("thumb_up", liked ? "fill" : "")}${review.likes}</button>
            <button type="button" class="act${disliked ? " is-disliked" : ""}" aria-pressed="${disliked}" aria-label="Dislike, ${review.dislikes} dislikes" onclick="dislikeReview(${review.id})">${icon("thumb_down", disliked ? "fill" : "")}${review.dislikes}</button>
            <button type="button" class="act" aria-label="Reply, ${replyCount} replies" aria-expanded="false" aria-controls="reply-${review.id}" onclick="toggleReply(${review.id})">${icon("chat_bubble")}${replyCount}</button>
            <button type="button" class="act act-report" aria-label="Report post" title="Report post" onclick="reportReview(${review.id})">${icon("flag")}</button>
        </div>
        <div class="thread${replyCount ? "" : " is-empty"}">
            ${repliesHTML}
            <form class="reply-box" id="reply-${review.id}" onsubmit="event.preventDefault(); sendReply(${review.id})">
                <span class="avatar avatar-sm" style="background:${avatarColor(me)}" aria-hidden="true">${escapeHTML(initialsOf(me))}</span>
                <div class="reply-field">
                    <input id="replyText-${review.id}" type="text" maxlength="1000" placeholder="Write a reply…" aria-label="Write a reply" autocomplete="off">
                    <button type="submit" class="reply-send" aria-label="Send reply">${icon("send")}</button>
                </div>
            </form>
        </div>
    `;


    // Photo, video or Live Photo (built in media.js, not as HTML text)
    const mediaElement =
        buildMediaElement({
            image: review.image,
            video: review.video,
            live: review.live
        });


    if (mediaElement) {

        element
            .querySelector(".review-media")
            .appendChild(mediaElement);
    }


    container.appendChild(element);
}


/* =========================================================
   LIKE
========================================================= */

function likeReview(id) {

    reactToReview(
        id,
        "like"
    );
}


/* =========================================================
   DISLIKE
========================================================= */

function dislikeReview(id) {

    reactToReview(
        id,
        "dislike"
    );
}


/* =========================================================
   REACTION HELPER
========================================================= */

/*
   The server adds, switches or removes the reaction and
   guarantees one reaction per user per post.
*/

async function reactToReview(
    id,
    kind
) {

    try {

        await api(
            "/api/reviews/" + id + "/react",
            { kind: kind }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    loadReviews();
}


/* =========================================================
   REPLY TOGGLE
========================================================= */

function toggleReply(id) {

    const box =
        document.getElementById("reply-" + id);

    if (!box) {
        return;
    }

    const open = box.classList.toggle("is-open");

    box.closest(".thread").classList.toggle("is-replying", open);

    const button = document.querySelector('[aria-controls="reply-' + id + '"]');

    if (button) {
        button.setAttribute("aria-expanded", String(open));
    }

    if (open) {
        document.getElementById("replyText-" + id).focus();
    }
}


/* =========================================================
   SEND REPLY
========================================================= */

async function sendReply(id) {

    if (!currentUser) {

        alert(
            "Please log in first."
        );

        return;
    }


    const input =
        document.getElementById(
            "replyText-" + id
        );


    const text =
        input.value.trim();


    if (text === "") {

        alert(
            "Please write a reply."
        );

        return;
    }


    try {

        await api(
            "/api/reviews/" + id + "/reply",
            { text: text }
        );

    } catch (failure) {

        alert(failure.message);

        return;
    }


    await loadReviews();


    alert(
        "Your reply has been posted."
    );
}


/* =========================================================
   REPORT
========================================================= */

let reportingId = null;

function reportReview(id) {

    if (!currentUser) {

        showToast("Please log in first.");

        return;
    }

    reportingId = id;

    document.getElementById("reportReason").value = "";

    document.getElementById("reportError").textContent = "";

    openModal("reportModal");
}


async function submitReport() {

    const field = document.getElementById("reportReason");

    const error = document.getElementById("reportError");

    const reason = field.value.trim();


    if (reason === "") {

        error.textContent = "Please tell us why you’re reporting this post.";

        field.focus();

        return;
    }


    const button = document.getElementById("reportSubmit");

    button.disabled = true;


    try {

        await api(
            "/api/reviews/" + reportingId + "/report",
            { reason: reason }
        );

    } catch (failure) {

        error.textContent = failure.message;

        return;

    } finally {

        button.disabled = false;
    }


    closeModal("reportModal");

    showToast("Thank you. Your report has been recorded.", { tone: "success", icon: "flag" });
}


/* =========================================================
   STATISTICS
========================================================= */

function updateStatistics() {

    const total =
        allReviews.length;

    let ratingTotal = 0;

    let replyTotal = 0;

    let fixed = 0;

    let pendingPosts = 0;

    const byArea = {};

    Object.keys(AREAS).forEach(name => {
        byArea[name] = { count: 0, sum: 0 };
    });


    allReviews.forEach(review => {

        ratingTotal += review.rating;

        replyTotal += review.replies.length;

        if (byArea[review.category]) {
            byArea[review.category].count += 1;
            byArea[review.category].sum += review.rating;
        }

        if (review.status === "completed") {
            fixed += 1;
        } else {
            pendingPosts += 1;
        }
    });


    const average =
        total === 0
            ? 0
            : ratingTotal / total;


    document.getElementById("overallRating").innerHTML =
        average.toFixed(1) + "<small> / 5</small>";

    document.getElementById("totalReviews").textContent =
        total.toLocaleString("en-US");

    document.getElementById("totalReplies").textContent =
        replyTotal.toLocaleString("en-US");


    document
        .querySelectorAll("[data-count]")
        .forEach(el => {

            const key = el.dataset.count;

            el.textContent = key === "fixed"
                ? fixed
                : (byArea[key] ? byArea[key].count : 0);
        });


    // Admin badge: pending posts, plus pending guest items once loaded
    const pending = adminData
        ? adminData.counts.pending
        : pendingPosts;

    document
        .querySelectorAll("[data-pending-badge]")
        .forEach(el => {
            el.textContent = pending;
            el.classList.toggle("hidden", !pending);
        });


    const ratingsHTML = Object.entries(AREAS)
        .map(([name, area]) => {

            const stats = byArea[name];

            const avg = stats.count ? stats.sum / stats.count : 0;

            const label = stats.count ? avg.toFixed(1) : "–";

            return (
                '<div class="area-rating">' +
                '<div class="area-rating-row"><span>' + icon(area.icon) + escapeHTML(area.short) + "</span>" +
                "<b>" + label + "</b></div>" +
                '<div class="meter" role="img" aria-label="' + escapeAttr(name) + ": " +
                (stats.count ? label + " out of 5" : "no ratings yet") + '">' +
                '<span style="width:' + (avg / 5) * 100 + '%"></span></div></div>'
            );
        })
        .join("");

    document
        .querySelectorAll("[data-area-ratings]")
        .forEach(el => { el.innerHTML = ratingsHTML; });


    const recent = allReviews
        .filter(review => review.status === "completed")
        .slice(0, 3);

    document.getElementById("recentFixed").innerHTML = recent.length
        ? recent
            .map(review =>
                '<button type="button" class="fixed-item" onclick="jumpToPost(' + review.id + ')">' +
                icon("check_circle", "fill") +
                "<span><b>" + escapeHTML(truncate(review.text, 64)) + "</b>" +
                "<span>" + escapeHTML((AREAS[review.category] || {}).short || review.category) +
                " · " + escapeHTML(relTime(review.date)) + "</span></span></button>"
            )
            .join("")
        : '<p class="rail-empty">Nothing marked fixed yet. Completed issues show up here.</p>';
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(value) {

    const div =
        document.createElement("div");


    div.textContent =
        value;


    return div.innerHTML;
}


/* =========================================================
   GUEST FEEDBACK
   Guests are not department members. This flow only saves
   a complaint/feedback. It never touches currentUser or
   "campusVoiceCurrentUser", so it can't open the platform.
========================================================= */

const guestPage =
    document.getElementById("guestPage");

const GUEST_STORAGE_KEY =
    "campusVoiceGuestFeedback";

const GUEST_LAST_SUBMIT_KEY =
    "campusVoiceGuestLastSubmit";

const GUEST_MESSAGE_MAX = 2000;

// Only these roles are accepted (the server checks again)
const GUEST_ROLES = ["Student", "Faculty", "Staff", "Guest"];


// "Guest" alone stays "Guest"; the others read "Guest (Student)", etc.
function guestRoleLabel(role) {

    return role === "Guest"
        ? "Guest"
        : "Guest (" + role + ")";
}


// The role the guest picked in step 1
let guestSelectedRole = "";


// Step 1 -> Step 2: role chosen, show the feedback form
function chooseGuestRole(role) {

    if (!GUEST_ROLES.includes(role)) {

        return;
    }

    guestSelectedRole = role;

    document.getElementById("guestRoleBadge").textContent =
        guestRoleLabel(role);

    setGuestError("guestRole", "");

    document
        .getElementById("guestRoleStep")
        .classList.add("hidden");

    document
        .getElementById("guestForm")
        .classList.remove("hidden");

    window.scrollTo(0, 0);
}


// Back to step 1 so the guest can change their role
function showGuestRoleStep() {

    document
        .getElementById("guestForm")
        .classList.add("hidden");

    document
        .getElementById("guestRoleStep")
        .classList.remove("hidden");
}


// Make sure only the guest page is visible
function hideGuestPage() {

    const page =
        document.getElementById("guestPage");

    if (page) {

        page.style.display = "none";
    }
}

const GUEST_COOLDOWN_MS = 30 * 1000;


const GUEST_CONTACT_TYPES = {

    email: {
        inputType: "email",
        inputMode: "email",
        maxLength: 254,
        placeholder: "e.g. juan@example.com"
    },

    mobile: {
        inputType: "tel",
        inputMode: "tel",
        maxLength: 16,
        placeholder: "e.g. 09171234567 or +639171234567"
    },

    facebook: {
        inputType: "text",
        inputMode: "text",
        maxLength: 200,
        placeholder: "Facebook profile link or name"
    }

};


function showGuest() {

    landingPage.style.display = "none";

    authPage.style.display = "none";

    mainPage.style.display = "none";

    guestPage.style.display = "flex";


    resetGuestForm();


    window.scrollTo(0, 0);
}


function guestBackToLogin() {

    guestPage.style.display = "none";


    resetGuestForm();


    showLogin();
}


function resetGuestForm() {

    document
        .getElementById("guestForm")
        .reset();


    // Always start at step 1 (choose a role)
    guestSelectedRole = "";

    document
        .getElementById("guestForm")
        .classList.add("hidden");


    document
        .getElementById("guestRoleStep")
        .classList.remove("hidden");


    document
        .getElementById("guestThanks")
        .classList.add("hidden");


    clearGuestErrors();

    updateGuestContactInput();

    updateGuestCounter();
}


function getGuestContactType() {

    const checked =
        document.querySelector(
            'input[name="guestContactType"]:checked'
        );


    return checked
        ? checked.value
        : "";
}


function updateGuestContactInput() {

    const type =
        getGuestContactType();


    const config =
        GUEST_CONTACT_TYPES[type];


    if (!config) {

        return;
    }


    const input =
        document.getElementById("guestContact");


    input.type = config.inputType;

    input.inputMode = config.inputMode;

    input.maxLength = config.maxLength;

    input.placeholder = config.placeholder;

    input.value = "";


    setGuestError(
        "guestContact",
        ""
    );
}


function updateGuestCounter() {

    const length =
        document
            .getElementById("guestMessage")
            .value
            .length;


    document.getElementById(
        "guestCounter"
    ).textContent =
        length + " / " + GUEST_MESSAGE_MAX;
}


function setGuestError(
    fieldId,
    message
) {

    const error =
        document.getElementById(
            fieldId + "Error"
        );


    const field =
        document.getElementById(fieldId);


    // textContent keeps any user text from being parsed as HTML
    error.textContent = message;


    if (
        field &&
        fieldId !== "guestForm"
    ) {

        field.classList.toggle(
            "guest-invalid",
            message !== ""
        );


        field.setAttribute(
            "aria-invalid",
            message !== ""
        );
    }
}


function clearGuestErrors() {

    setGuestError("guestRole", "");

    setGuestError("guestMessage", "");

    setGuestError("guestContact", "");

    setGuestError("guestForm", "");
}


/*
   Returns { value, error }. value is the cleaned
   contact detail that gets saved.
*/

function validateGuestContact(
    type,
    raw
) {

    const value =
        raw.trim();


    if (value === "") {

        return {
            value: "",
            error: "Please enter how we can contact you."
        };
    }


    if (type === "email") {

        const emailPattern =
            /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


        if (
            value.length > 254 ||
            !emailPattern.test(value)
        ) {

            return {
                value: "",
                error: "Please enter a valid email address."
            };
        }


        return {
            value: value.toLowerCase(),
            error: ""
        };
    }


    if (type === "mobile") {

        // Allow spaces and dashes while typing, then strip them
        const mobile =
            value.replace(/[\s-]/g, "");


        if (
            !/^(09\d{9}|\+639\d{9})$/.test(mobile)
        ) {

            return {
                value: "",
                error: "Please enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX)."
            };
        }


        return {
            value: mobile,
            error: ""
        };
    }


    if (type === "facebook") {

        const linkPattern =
            /^(https?:\/\/)?(www\.|m\.|web\.)?(facebook\.com|fb\.com)\/[A-Za-z0-9.\-_/?=&%]+$/i;


        const namePattern =
            /^[\p{L}][\p{L} .'-]{1,99}$/u;


        if (
            value.length > 200 ||
            (
                !linkPattern.test(value) &&
                !namePattern.test(value)
            )
        ) {

            return {
                value: "",
                error: "Please enter a Facebook profile link (facebook.com/...) or your Facebook name."
            };
        }


        return {
            value: value,
            error: ""
        };
    }


    return {
        value: "",
        error: "Please choose a contact type."
    };
}


async function submitGuestFeedback(event) {

    event.preventDefault();

    clearGuestErrors();

    const selectedRole =
        guestSelectedRole;


    /*
       Honeypot: people never see this field.
       If it's filled, act like it worked but save nothing.
    */

    const honeypot =
        document
            .getElementById("guestWebsite")
            .value;


    if (honeypot !== "") {

        showGuestThanks();

        return;
    }


    const message =
        document
            .getElementById("guestMessage")
            .value
            .trim();


    const contactType =
        getGuestContactType();


    const contact =
        validateGuestContact(
            contactType,
            document
                .getElementById("guestContact")
                .value
        );


    let valid = true;


    if (!GUEST_ROLES.includes(selectedRole)) {

        setGuestError(
            "guestRole",
            "Please choose your role first (Student, Faculty, Staff, or Guest)."
        );

        valid = false;
    }


    if (message === "") {

        setGuestError(
            "guestMessage",
            "Please write your complaint or feedback."
        );

        valid = false;

    } else if (message.length < 10) {

        setGuestError(
            "guestMessage",
            "Please add a bit more detail (at least 10 characters)."
        );

        valid = false;

    } else if (message.length > GUEST_MESSAGE_MAX) {

        setGuestError(
            "guestMessage",
            "Please keep it under " + GUEST_MESSAGE_MAX + " characters."
        );

        valid = false;
    }


    if (contact.error !== "") {

        setGuestError(
            "guestContact",
            contact.error
        );

        valid = false;
    }


    if (!valid) {

        const firstInvalid =
            document.querySelector(
                "#guestForm .guest-invalid"
            );


        if (firstInvalid) {

            firstInvalid.focus();
        }

        return;
    }


    /*
       Simple spam protection: one submission
       every 30 seconds from this browser.
    */

    const lastSubmit =
        Number(
            localStorage.getItem(
                GUEST_LAST_SUBMIT_KEY
            )
        ) || 0;


    if (
        Date.now() - lastSubmit
        < GUEST_COOLDOWN_MS
    ) {

        setGuestError(
            "guestForm",
            "You just sent a concern. Please wait a moment before sending another."
        );

        return;
    }


     // Send to the server instead of saving in the browser
    try {

        await api(
    "/api/guest-feedback",
    {
        role: selectedRole,
        message: message,
        contact_type: contactType,
        contact_value: contact.value
    }
);

    } catch (failure) {

        setGuestError("guestForm", failure.message);

        return;
    }


    localStorage.setItem(
        GUEST_LAST_SUBMIT_KEY,
        String(Date.now())
    );


    showGuestThanks(selectedRole);
}


function showGuestThanks(role) {

    const thanksRole =
        document.getElementById("guestThanksRole");

    thanksRole.textContent =
        GUEST_ROLES.includes(role)
            ? "Submitted as: " + guestRoleLabel(role)
            : "";


    document
        .getElementById("guestForm")
        .classList.add("hidden");


    document
        .getElementById("guestThanks")
        .classList.remove("hidden");
}


/* =========================================================
   INITIALIZE
========================================================= */

window.addEventListener(
    "load",
    async function() {

        // The guest page only opens from the Guest button
        hideGuestPage();

        // Ask the server whether this browser is logged in
        try {

            const data =
                await api("/api/me");


            currentUser =
                data.user;


            openMainPage();

        } catch (failure) {

            landingPage.style.display =
                "flex";

            authPage.style.display =
                "none";

            mainPage.style.display =
                "none";
        }

    }
);

/* =========================================================
   ADMIN WORKLOAD TRACKING
========================================================= */

const adminPage =
    document.getElementById("adminPage");

let adminData = null;


async function showAdmin() {

    closeAllModals();

    mainPage.style.display = "none";

    adminPage.style.display = "block";

    window.scrollTo(0, 0);

    loadSystemStatus();

    // loadResetRequests();  // password reset is hidden for now

    await loadAdmin();
}


function hideAdmin() {

    adminPage.style.display = "none";

    mainPage.style.display = "block";
}


// Admin view state: which status and which list (mobile tabs)
let adminStatusFilter = "all";

let adminTab = "posts";


async function loadAdmin() {

    if (!adminData) {

        const loading = '<div class="tri-empty">' + icon("hourglass_top") + "<span>Loading…</span></div>";

        document.getElementById("adminPosts").innerHTML = loading;

        document.getElementById("adminGuests").innerHTML = loading;
    }

    try {

        adminData = await api("/api/admin/workload");

    } catch (failure) {

        showToast(failure.message, { tone: "error" });

        return;
    }

    renderAdmin();

    updateStatistics();
}


function setAdminFilter(filter) {

    adminStatusFilter = filter;

    renderAdmin();
}


function setAdminTab(tab) {

    adminTab = tab;

    adminPage.dataset.tab = tab;

    document
        .querySelectorAll(".tri-tabs [data-tab]")
        .forEach(button => {

            const on = button.dataset.tab === tab;

            button.classList.toggle("is-active", on);

            button.setAttribute("aria-selected", String(on));
        });
}


function renderAdmin() {

    if (!adminData) {
        return;
    }


    const counts = adminData.counts;

    const isDone = item => item.status === "completed";


    document.getElementById("adminPending").textContent = counts.pending;

    document.getElementById("adminCompleted").textContent = counts.completed;

    document.getElementById("adminTotal").textContent = counts.total;


    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const stale = [...adminData.posts, ...adminData.guests]
        .filter(item => !isDone(item) && new Date(item.date).getTime() < weekAgo)
        .length;

    document.getElementById("adminPendingNote").textContent = stale
        ? stale + " older than 7 days"
        : "None older than 7 days";

    document.getElementById("adminCompletedNote").textContent =
        adminData.posts.filter(isDone).length + " posts · " +
        adminData.guests.filter(isDone).length + " guest";

    document.getElementById("adminTotalNote").textContent =
        adminData.posts.length + " posts · " + adminData.guests.length + " guest";


    const percent = counts.total
        ? Math.round((counts.completed / counts.total) * 100)
        : 0;

    document.getElementById("adminResolved").textContent = percent + "%";

    document.getElementById("adminResolvedBar").style.width = percent + "%";


    document
        .querySelectorAll("#adminPage [data-filter]")
        .forEach(el => {

            const on = el.dataset.filter === adminStatusFilter;

            el.classList.toggle("is-active", on);

            if (el.classList.contains("tri-stat")) {
                el.setAttribute("aria-pressed", String(on));
            } else {
                el.setAttribute("aria-selected", String(on));
            }
        });

    document.querySelector('[data-c="all"]').textContent = counts.total;

    document.querySelector('[data-c="pending"]').textContent = counts.pending;

    document.querySelector('[data-c="completed"]').textContent = counts.completed;


    const search =
        (document.getElementById("adminSearch").value || "")
            .toLowerCase()
            .trim();

    const keep = item =>
        (adminStatusFilter === "all" || item.status === adminStatusFilter) &&
        (search === "" ||
            [
                item.username, item.category, item.text, item.message,
                item.role, item.contact_type, item.contact_value
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(search));


    const posts = adminData.posts.filter(keep);

    const guests = adminData.guests.filter(keep);

    document
        .querySelectorAll('[data-tc="posts"]')
        .forEach(el => { el.textContent = posts.length; });

    document
        .querySelectorAll('[data-tc="guests"]')
        .forEach(el => { el.textContent = guests.length; });


    renderAdminList("adminPosts", posts, "posts");

    renderAdminList("adminGuests", guests, "guests");

    setAdminTab(adminTab);
}


const GUEST_ROLE_ICONS = {
    Student: "school",
    Faculty: "co_present",
    Staff: "badge",
    Guest: "person"
};

const GUEST_CONTACT_META = {
    email: ["Email", "mail"],
    mobile: ["Mobile no.", "call"],
    facebook: ["Facebook", "alternate_email"]
};


function renderAdminList(containerId, items, kind) {

    const container =
        document.getElementById(containerId);


    if (items.length === 0) {

        container.innerHTML =
            '<div class="tri-empty">' +
            icon(adminStatusFilter === "pending" ? "celebration" : "inbox") +
            "<span>" +
            (adminStatusFilter === "pending" ? "Nothing pending here. Nice work!" : "Nothing here.") +
            "</span></div>";

        return;
    }


    container.innerHTML = items.map(item => {

        const done = item.status === "completed";

        const statusPill = done
            ? '<span class="status-pill is-done">' + icon("check_circle", "fill") + "Completed</span>"
            : '<span class="status-pill is-pending">' + icon("schedule") + "Pending</span>";

        const action = done
            ? `<button type="button" class="btn btn-secondary btn-sm" onclick="setAdminStatus('${kind}', ${item.id}, 'pending')">${icon("undo")}Mark as Pending</button>`
            : `<button type="button" class="btn btn-primary btn-sm" onclick="setAdminStatus('${kind}', ${item.id}, 'completed')">${icon("check")}Mark as Completed</button>`;

        const date =
            '<span class="tri-date" title="' + escapeAttr(formatDate(item.date)) + '">' +
            escapeHTML(shortDate(item.date)) + "</span>";

        // Long messages clamp to two lines; click to read all
        const body = kind === "posts" ? item.text : item.message;

        const text =
            '<p class="tri-text" tabindex="0" title="Click to expand" ' +
            'onclick="this.classList.toggle(\'is-open\')" ' +
            'onkeydown="if(event.key===\'Enter\')this.classList.toggle(\'is-open\')">' +
            escapeHTML(body) + "</p>";


        if (kind === "posts") {

            const area = AREAS[item.category] ||
                { key: "info", icon: "label", chip: item.category };

            return `
                <article class="tri-row tri-row-post${done ? " is-done" : ""}">
                    <span class="tri-status">${statusPill}</span>
                    <span class="tri-who"><span class="avatar avatar-xs" style="background:${avatarColor(item.username)}" aria-hidden="true">${escapeHTML(initialsOf(item.username))}</span><b>${escapeHTML(item.username)}</b></span>
                    <span class="tri-area"><span class="area-chip area-chip-sm" data-area="${area.key}">${icon(area.icon)}${escapeHTML(area.chip)}</span></span>
                    <span class="tri-rating" aria-label="${item.rating} out of 5 stars">${icon("star", "star-on")}${Number(item.rating).toFixed(1)}</span>
                    ${date}
                    ${text}
                    <span class="tri-action">${action}</span>
                </article>
            `;
        }


        const role = item.role || "Not specified";

        const contact = GUEST_CONTACT_META[item.contact_type] ||
            [item.contact_type || "Contact", "contact_mail"];

        return `
            <article class="tri-row tri-row-guest${done ? " is-done" : ""}">
                <span class="tri-status">${statusPill}</span>
                <span class="tri-role"><span class="role-chip">${icon(GUEST_ROLE_ICONS[item.role] || "person")}${escapeHTML(role)}</span></span>
                <span class="tri-contact"><span class="contact-ico">${icon(contact[1])}</span><span class="contact-text"><span class="contact-type">${escapeHTML(contact[0])}</span><span class="contact-value">${escapeHTML(item.contact_value)}</span></span></span>
                ${date}
                ${text}
                <span class="tri-action">${action}</span>
            </article>
        `;

    }).join("");
}


async function setAdminStatus(kind, id, status, options = {}) {

    try {

        await api(
            "/api/admin/" + kind + "/" + id + "/status",
            { status: status }
        );

    } catch (failure) {

        showToast(failure.message, { tone: "error" });

        return;
    }


    await loadAdmin();


    // Students see the new status on their posts
    if (kind === "posts" && reviewsLoaded) {
        loadReviews();
    }


    if (!options.silent) {

        const previous = status === "completed" ? "pending" : "completed";

        showToast(
            status === "completed" ? "Marked as Completed" : "Marked as Pending",
            {
                tone: "success",
                icon: "task_alt",
                action: {
                    label: "Undo",
                    onClick: () => setAdminStatus(kind, id, previous, { silent: true })
                }
            }
        );
    }
}


/* =========================================================
   ADMIN · SYSTEM STATUS
   Asks the server what's configured (database, Supabase
   Storage, hosting) so hosting problems can be diagnosed
   without access to the Vercel or Supabase dashboards.
========================================================= */

const SYSTEM_STATE_META = {
    ok: ["check_circle", "All good", "is-done"],
    warn: ["warning", "Check warnings", "is-pending"],
    fail: ["error", "Problems found", "is-fail"]
};


async function loadSystemStatus() {

    const list = document.getElementById("sysList");

    const overall = document.getElementById("sysOverall");

    const button = document.getElementById("sysRun");

    button.disabled = true;

    overall.className = "status-pill sys-overall";

    overall.textContent = "Checking…";

    let data;

    try {

        data = await api("/api/admin/status");

    } catch (failure) {

        overall.className = "status-pill sys-overall is-fail";

        overall.innerHTML = icon("error", "fill") + "Check failed";

        list.innerHTML =
            '<li class="sys-item is-fail"><span class="sys-ico">' + icon("error", "fill") +
            '</span><span class="sys-text"><b>Status check</b><span>' +
            escapeHTML(failure.message) + "</span></span></li>";

        return;

    } finally {

        button.disabled = false;
    }

    const meta = SYSTEM_STATE_META[data.overall] || SYSTEM_STATE_META.warn;

    overall.className = "status-pill sys-overall " + meta[2];

    overall.innerHTML = icon(meta[0], "fill") + meta[1];

    list.innerHTML = data.checks
        .map(item => {

            const itemMeta = SYSTEM_STATE_META[item.state] || SYSTEM_STATE_META.warn;

            return (
                '<li class="sys-item is-' + item.state + '">' +
                '<span class="sys-ico">' + icon(itemMeta[0], "fill") + "</span>" +
                '<span class="sys-text"><b>' + escapeHTML(item.label) + "</b>" +
                "<span>" + escapeHTML(item.detail) + "</span>" +
                (item.hint ? '<span class="sys-hint">' + escapeHTML(item.hint) + "</span>" : "") +
                "</span></li>"
            );
        })
        .join("");
}



/* =========================================================
   FORGOT PASSWORD
   No email service: an admin creates a one-time code from the
   dashboard and gives it to the student.
========================================================= */

function showForgot() {

    const name = document.getElementById("loginUsername").value.trim();

    document.getElementById("loginForm").classList.add("hidden");

    document.getElementById("signupForm").classList.add("hidden");

    document.getElementById("forgotForm").classList.remove("hidden");

    document.getElementById("forgotUsername").value = name;

    document.getElementById("resetUsername").value = name;

    showForgotStep("request");
}


function showForgotStep(step) {

    document.getElementById("forgotRequest").classList.toggle("hidden", step !== "request");

    document.getElementById("forgotCode").classList.toggle("hidden", step !== "code");

    const focus = step === "request" ? "forgotUsername" : "resetCode";

    const field = document.getElementById(focus);

    if (step === "code" && !document.getElementById("resetUsername").value) {
        document.getElementById("resetUsername").focus();
    } else {
        field.focus();
    }
}


async function requestPasswordReset() {

    const username = document.getElementById("forgotUsername").value.trim();

    const studentNumber = document.getElementById("forgotStudentNumber").value.trim();

    if (!username || !studentNumber) {

        showToast("Please enter your username and student number.");

        return;
    }

    try {

        await api("/api/password-reset/request", {
            username: username,
            student_number: studentNumber
        });

    } catch (failure) {

        showToast(failure.message);

        return;
    }

    document.getElementById("resetUsername").value = username;

    document.getElementById("forgotCodeNote").textContent =
        "Request sent. If the details matched, an admin will see it and give " +
        "you a reset code. Enter it here (codes work for 24 hours).";

    showToast("Reset request sent to the admins.", { tone: "success", icon: "key" });

    showForgotStep("code");
}


async function completePasswordReset() {

    const username = document.getElementById("resetUsername").value.trim();

    const code = document.getElementById("resetCode").value.trim();

    const password = document.getElementById("resetPassword").value;

    const confirm = document.getElementById("resetConfirm").value;

    if (!username || !code || !password) {

        showToast("Please fill in your username, reset code and new password.");

        return;
    }

    if (password !== confirm) {

        showToast("The two passwords don't match.");

        return;
    }

    try {

        await api("/api/password-reset/complete", {
            username: username,
            code: code,
            password: password
        });

    } catch (failure) {

        showToast(failure.message);

        return;
    }

    ["resetCode", "resetPassword", "resetConfirm"].forEach(id => {
        document.getElementById(id).value = "";
    });

    showLogin();

    document.getElementById("loginUsername").value = username;

    document.getElementById("loginPassword").value = "";

    document.getElementById("loginPassword").focus();

    showToast("Password saved. Log in with your new password.", { tone: "success" });
}


/* ---------- Admin: reset requests ---------- */

async function loadResetRequests() {

    const list = document.getElementById("resetList");

    let data;

    try {

        data = await api("/api/admin/reset-requests");

    } catch (failure) {

        list.innerHTML = '<li class="sys-item is-fail"><span class="sys-text">' +
            escapeHTML(failure.message) + "</span></li>";

        return;
    }

    document.getElementById("resetCount").textContent = data.requests.length || "";

    if (data.requests.length === 0) {

        list.innerHTML =
            '<li class="sys-item is-ok"><span class="sys-ico">' + icon("check_circle", "fill") +
            '</span><span class="sys-text"><b>No requests</b><span>Nobody is waiting for a password reset.</span></span></li>';

        return;
    }

    list.innerHTML = data.requests
        .map(request =>
            '<li class="sys-item reset-item" id="reset-' + request.id + '">' +
            '<span class="avatar avatar-xs" style="background:' + avatarColor(request.username) + '" aria-hidden="true">' +
            escapeHTML(initialsOf(request.username)) + "</span>" +
            '<span class="sys-text"><b>' + escapeHTML(request.username) + "</b>" +
            "<span>" + escapeHTML(request.student_number) + " · requested " + escapeHTML(relTime(request.requested)) +
            (request.has_code ? " · code already given" : "") + "</span>" +
            '<span class="reset-code-out" id="resetOut-' + request.id + '"></span></span>' +
            '<span class="reset-actions">' +
            '<button type="button" class="btn btn-primary btn-sm" onclick="createResetCode(' + request.id + ')">' +
            icon("key") + (request.has_code ? "New code" : "Create code") + "</button>" +
            '<button type="button" class="btn btn-ghost btn-sm" onclick="dismissReset(' + request.id + ')">Dismiss</button>' +
            "</span></li>"
        )
        .join("");
}


async function createResetCode(id) {

    let data;

    try {

        data = await api("/api/admin/users/" + id + "/reset-code", {});

    } catch (failure) {

        showToast(failure.message);

        return;
    }

    // Shown once; the server only keeps a hash of it
    document.getElementById("resetOut-" + id).innerHTML =
        'Give this code to the student: <code class="reset-code">' + escapeHTML(data.code) + "</code>" +
        " (works for " + data.hours + " hours, shown only once)";
}


async function dismissReset(id) {

    try {

        await api("/api/admin/users/" + id + "/reset-dismiss", {});

    } catch (failure) {

        showToast(failure.message);

        return;
    }

    loadResetRequests();
}
