(function () {
  "use strict";

  // Colors and status labels come from the server (BCA_CONFIG injected by booking_cal.py).
  var STATUS_COLORS = BCA_CONFIG.status_colors;

  var MONTH_NAMES = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];

  // All view buttons. bca-desktop-only / bca-mobile-only toggled via CSS.
  var VIEW_BUTTONS = [
    { view: "resourceTimelineMonth", label: "Monat",  cls: "bca-desktop-only" },
    { view: "resourceTimelineWeek",  label: "Woche",  cls: "bca-desktop-only" },
    { view: "resourceTimelineDay",   label: "Tag",    cls: "bca-desktop-only" },
    { view: "dayGridMonth",          label: "Raster"                           },
    { view: "listMonth",             label: "Tage",   cls: "bca-mobile-only"  },
  ];

  // Views that show resource rows + legend
  var RESOURCE_VIEWS = {
    resourceTimelineMonth: true,
    resourceTimelineWeek:  true,
    resourceTimelineDay:   true,
  };

  // ── State ─────────────────────────────────────────────────────────────────
  var ec          = null;
  var resources   = [];       // [{id, title, color}]
  var paletteMap  = {};       // resource_id → hex color
  var currentDate = new Date();
  var currentView = "resourceTimelineMonth";  // corrected in boot
  var activeTab   = "calendar";
  var clickTimer  = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function isoDate(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function firstOfMonth(d)     { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function firstOfNextMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 1); }

  // ── Utilities ─────────────────────────────────────────────────────────────
  function contrastColor(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#000000" : "#ffffff";
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function updateTitle() {
    document.getElementById("bca-title").textContent =
      MONTH_NAMES[currentDate.getMonth()] + " " + currentDate.getFullYear();
  }

  // ── Navigation (delta: -1 prev, 0 today, +1 next) ─────────────────────
  function nav(delta) {
    if (activeTab === "calendar" && ec) {
      if      (delta < 0) { ec.prev(); }
      else if (delta > 0) { ec.next(); }
      else                { ec.setOption("date", new Date()); }
    } else {
      currentDate = delta === 0
        ? firstOfMonth(new Date())
        : new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1);
      updateTitle();
      loadList();
    }
  }

  // ── View switching ────────────────────────────────────────────────────────
  function switchView(viewName) {
    if (!ec) { return; }
    currentView = viewName;

    // Update view buttons
    document.querySelectorAll(".bca-view-btn").forEach(function (btn) {
      btn.classList.toggle("bca-view-btn--active", btn.dataset.view === viewName);
    });

    ec.setOption("view", viewName);
    document.getElementById("bca-legend").style.display = RESOURCE_VIEWS[viewName] ? "" : "none";
  }

  // ── View buttons (built once; CSS hides desktop-only / mobile-only) ───────
  function buildViewButtons() {
    var container = document.getElementById("bca-view-btns");
    VIEW_BUTTONS.forEach(function (v) {
      var btn = document.createElement("button");
      btn.className   = ["bca-view-btn",
        v.view === currentView ? "bca-view-btn--active" : "",
        v.cls || ""].filter(Boolean).join(" ");
      btn.dataset.view = v.view;
      btn.textContent  = v.label;
      btn.addEventListener("click", function () {
        if (activeTab !== "calendar") { switchTab("calendar"); }
        switchView(v.view);
      });
      container.appendChild(btn);
    });
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  function renderLegend() {
    document.getElementById("bca-legend").innerHTML = resources.map(function (r) {
      return '<span class="bca-legend-item">' +
        '<span class="bca-legend-dot" style="background:' + r.color + '"></span>' +
        '<span class="bca-legend-name">' + escHtml(r.title) + '</span>' +
        '</span>';
    }).join("");
  }

  // ── Preview panel ─────────────────────────────────────────────────────────
  function showPreview(event) {
    var ep  = event.extendedProps || {};
    var sc  = STATUS_COLORS[ep.status] || "#888888";
    var fg  = contrastColor(sc);

    var badge = document.getElementById("preview-status");
    badge.textContent       = ep.status || "";
    badge.style.background  = sc;
    badge.style.color       = fg;

    document.getElementById("preview-group").textContent = ep.group_name || event.title;
    document.getElementById("preview-start").textContent = ep.start_label || "";
    document.getElementById("preview-end").textContent   = ep.end_label   || "";
    document.getElementById("preview-open-btn").href =
      "/app/booking/" + encodeURIComponent(ep.booking || "");

    document.getElementById("booking-preview").classList.remove("bca-hidden");
  }

  function hidePreview() {
    document.getElementById("booking-preview").classList.add("bca-hidden");
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  }

  function openBooking(name) {
    if (name) { window.location.href = "/app/booking/" + encodeURIComponent(name); }
  }

  // ── EventCalendar initialisation ──────────────────────────────────────────
  function initCalendar() {
    ec = EventCalendar.create(document.getElementById("ec"), {
      view:          currentView,
      date:          currentDate,
      headerToolbar: false,
      firstDay:      1,          // Monday
      locale:        "de",

      resources: resources.map(function (r) { return { id: r.id, title: r.title }; }),

      eventSources: [{
        events: function (info, success, fail) {
          frappe.call({
            method: "bethanien.www.booking_cal.get_booking_cal_events",
            args: { start: info.startStr.slice(0, 10), end: info.endStr.slice(0, 10) },
            callback: function (r) { success(r.message || []); },
            error: fail,
          });
        },
      }],

      // ── Selection → new booking ────────────────────────────────────────
      selectable:           true,
      selectBackgroundColor: "rgba(78, 121, 167, 0.25)",
      unselectCancel:       "#booking-preview",

      select: function (info) {
        var startStr = isoDate(info.start);

        // allDay end is exclusive → subtract 1 day for the form's ends_on field
        var endDate = new Date(info.end);
        if (info.allDay) { endDate.setDate(endDate.getDate() - 1); }
        var endStr = isoDate(endDate);

        // Multi-day selection → set with_nights = 1 (Mehrtägig)
        var multiDay = endStr !== startStr ? "1" : "0";

        var params = new URLSearchParams({
          starts_on:   startStr,
          ends_on:     endStr,
          with_nights: multiDay,
        });
        if (info.resource) { params.set("booking_unit", info.resource.id); }

        window.location.href = "/app/booking/new-booking-1?" + params.toString();
      },

      // ── Event click → preview (single) / open (double) ─────────────────
      eventClick: function (info) {
        info.jsEvent.stopPropagation();
        var ep = info.event.extendedProps || {};

        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
          openBooking(ep.booking);
          return;
        }
        clickTimer = setTimeout(function () {
          clickTimer = null;
          showPreview(info.event);
        }, 280);
      },

      // ── Keep shared currentDate in sync with EC navigation ──────────────
      datesSet: function (info) {
        currentDate = new Date(info.view.currentStart);
        updateTitle();
      },

      // ── Resource label: colored dot + room name ─────────────────────────
      resourceLabelContent: function (info) {
        var color = paletteMap[info.resource.id] || "#aaaaaa";
        return {
          html: '<span class="bca-res-dot" style="background:' + color + '"></span>' +
                '<span class="bca-res-name">' + escHtml(info.resource.title) + '</span>',
        };
      },

      // ── Event tooltip ────────────────────────────────────────────────────
      eventDidMount: function (info) {
        var ep = info.event.extendedProps || {};
        info.el.title = [
          "Status: "  + (ep.status || ""),
          "Gruppe: "  + (ep.group_name || ""),
          "Anreise: " + (ep.start_label || ""),
          "Abreise: " + (ep.end_label || ""),
        ].join("\n");
      },

      pointer: true,

      // ── Day click → new booking (dayGridMonth: single-day click) ─────────
      dateClick: function (info) {
        if (info.view.type !== "dayGridMonth") { return; }
        var dateStr = isoDate(info.date);
        window.location.href = "/app/booking/new-booking-1?" +
          new URLSearchParams({ starts_on: dateStr, ends_on: dateStr, with_nights: "0" }).toString();
      },

      // ── Compact event pill for dayGridMonth ────────────────────────────
      eventContent: function (info) {
        if (info.view.type !== "dayGridMonth") { return undefined; }
        var ep    = info.event.extendedProps || {};
        var sc    = STATUS_COLORS[ep.status] || "#aaaaaa";
        var rooms = (info.event.resourceIds || []).map(function (id) {
          var c   = paletteMap[id] || "#aaaaaa";
          var res = resources.find(function (r) { return r.id === id; });
          return res
            ? '<span class="bca-ev-room" style="background:' + c + ';color:' + contrastColor(c) + '">' + escHtml(res.title) + '</span>'
            : "";
        }).join("");
        return {
          html: '<div class="bca-ev-bar">' +
            '<span class="bca-ev-dot" style="background:' + sc + '"></span>' +
            '<span class="bca-ev-text">' + escHtml(info.event.title) + '</span>' +
            (rooms ? '<span class="bca-ev-rooms">' + rooms + '</span>' : "") +
            "</div>",
        };
      },
    });
  }

  // ── List view ─────────────────────────────────────────────────────────────
  function loadList() {
    document.getElementById("bca-booking-list").innerHTML =
      "<p class='bca-list-loading'>Wird geladen…</p>";
    frappe.call({
      method: "bethanien.www.booking_cal.get_booking_list",
      args: { start: isoDate(firstOfMonth(currentDate)), end: isoDate(firstOfNextMonth(currentDate)) },
      error:    function (e) { console.error("list error", e); },
      callback: function (r) { renderList(r.message || []); },
    });
  }

  function renderList(bookings) {
    var container = document.getElementById("bca-booking-list");
    document.getElementById("bca-list-count").textContent =
      bookings.length + " Buchung" + (bookings.length === 1 ? "" : "en");

    if (!bookings.length) {
      container.innerHTML = "<p class='bca-list-empty'>Keine Buchungen in diesem Monat.</p>";
      return;
    }

    container.innerHTML = bookings.map(function (b) {
      var sc    = STATUS_COLORS[b.workflow_state] || "#888888";
      var fg    = contrastColor(sc);
      var dates = b.end_label && b.end_label !== b.start_label
        ? escHtml(b.start_label) + ' <span class="bca-card__arrow">&rarr;</span> ' + escHtml(b.end_label)
        : escHtml(b.start_label);
      var rooms = (b.units || []).map(function (u) {
        var c = paletteMap[u.id] || "#aaaaaa";
        return '<span class="bca-room-tag" style="background:' + c + ';color:' + contrastColor(c) + '">' +
               escHtml(u.name) + '</span>';
      }).join("");
      return '<div class="bca-card" data-name="' + escHtml(b.name) + '">' +
        '<div class="bca-card__date-row">' + dates + '</div>' +
        '<div class="bca-card__title">' + escHtml(b.group_name) + '</div>' +
        '<div class="bca-card__meta">' +
          '<span class="bca-card__status" style="background:' + sc + ';color:' + fg + '">' +
          escHtml(b.workflow_state || "–") + '</span>' + rooms +
        '</div>' +
        '</div>';
    }).join("");

    container.querySelectorAll(".bca-card").forEach(function (card) {
      card.addEventListener("click", function () {
        window.location.href = "/app/booking/" + encodeURIComponent(card.dataset.name);
      });
    });
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function switchTab(name) {
    activeTab = name;
    hidePreview();

    ["calendar", "list"].forEach(function (t) {
      document.getElementById("tab-"  + t).classList.toggle("bca-tab--active", t === name);
      document.getElementById("tab-"  + t).setAttribute("aria-selected", t === name ? "true" : "false");
      document.getElementById("view-" + t).classList.toggle("bca-hidden",  t !== name);
    });
    if (name === "calendar" && ec) { ec.setOption("date", currentDate); }
    else if (name === "list")      { loadList(); }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  frappe.ready(function () {
    currentView = window.matchMedia("(max-width: 700px)").matches
      ? "dayGridMonth"
      : "resourceTimelineMonth";
    currentDate = firstOfMonth(new Date());
    updateTitle();

    document.getElementById("btn-prev").addEventListener("click",  function () { nav(-1); });
    document.getElementById("btn-next").addEventListener("click",  function () { nav(1); });
    document.getElementById("btn-today").addEventListener("click", function () { nav(0); });

    buildViewButtons();

    document.getElementById("preview-close").addEventListener("click", hidePreview);
    document.addEventListener("click", function (e) {
      var panel = document.getElementById("booking-preview");
      if (!panel.classList.contains("bca-hidden") && !panel.contains(e.target)) { hidePreview(); }
    });
    document.getElementById("tab-calendar").addEventListener("click", function () { switchTab("calendar"); });
    document.getElementById("tab-list").addEventListener("click",     function () { switchTab("list"); });

    frappe.call({
      method: "bethanien.www.booking_cal.get_booking_cal_resources",
      error: function (e) { console.error("resources error", e); },
      callback: function (r) {
        resources = (r.message || []).map(function (res) {
          paletteMap[res.id] = res.color;
          return res;
        });
        // Apply colors as CSS variables so themes can reference them
        var root = document.documentElement;
        resources.forEach(function (res, i) {
          root.style.setProperty("--bca-res-" + i, res.color);
        });
        Object.keys(STATUS_COLORS).forEach(function (k) {
          root.style.setProperty(
            "--bca-s-" + k.toLowerCase().replace(/\s/g, "-"),
            STATUS_COLORS[k]
          );
        });
        renderLegend();
        initCalendar();
        document.getElementById("bca-legend").style.display = RESOURCE_VIEWS[currentView] ? "" : "none";
      },
    });
  });

}());
