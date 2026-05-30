(function () {
  "use strict";

  var COLORS = BCA_CONFIG.status_colors;

  var TAB_VIEW = {
    calendar:  "dayGridMonth",
    list:      "listMonth",
    resources: "resourceTimelineMonth",
  };

  var ec        = null;
  var resources = [];
  var palette   = {};
  var curDate   = new Date();
  var activeTab = "calendar";
  var clickTimer = null;

  function isoDate(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function fom(d)  { return new Date(d.getFullYear(), d.getMonth(), 1); }

  function contrast(hex) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.55 ? "#000" : "#fff";
  }

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // "Haus A" -> "A", "Raum B1" -> "B1"
  function short(title) {
    var p = String(title || "").trim().split(/\s+/);
    return p[p.length - 1] || title;
  }

  function updateTitle() {
    document.getElementById("bca-title").textContent =
      curDate.toLocaleString("de", { month: "long", year: "numeric" });
  }

  function nav(delta) {
    if (!ec) { return; }
    if      (delta < 0) { ec.prev(); }
    else if (delta > 0) { ec.next(); }
    else                { ec.setOption("date", new Date()); }
  }

  function switchTab(name) {
    activeTab = name;
    hidePreview();
    ["calendar", "list", "resources"].forEach(function (t) {
      var btn = document.getElementById("tab-" + t);
      btn.classList.toggle("bca-tab--active", t === name);
      btn.setAttribute("aria-selected", String(t === name));
    });
    document.getElementById("bca-legend").classList.toggle("bca-hidden", name !== "resources");
    if (ec) { ec.setOption("view", TAB_VIEW[name]); }
  }

  function showPreview(event) {
    var ep = event.extendedProps || {};
    var sc = COLORS[ep.status] || "#888";
    var badge = document.getElementById("preview-status");
    badge.textContent = ep.status || "";
    badge.style.background = sc;
    badge.style.color = contrast(sc);
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

  function renderLegend() {
    document.getElementById("bca-legend").innerHTML = resources.map(function (r) {
      return '<span class="bca-legend-item">' +
        '<span class="bca-legend-dot" style="background:' + r.color + '"></span>' +
        '<span class="bca-legend-name">' + esc(r.title) + '</span></span>';
    }).join("");
  }

  function initCalendar() {
    ec = EventCalendar.create(document.getElementById("ec"), {
      view:          TAB_VIEW[activeTab],
      date:          curDate,
      headerToolbar: false,
      firstDay:      1,
      locale:        "de",
      pointer:       true,
      selectable:            true,
      selectBackgroundColor: "rgba(78,121,167,0.25)",
      unselectCancel:        "#booking-preview",

      resources: resources.map(function (r) { return { id: r.id, title: r.title }; }),

      eventSources: [{
        events: function (info, success, fail) {
          frappe.call({
            method:   "bethanien.www.booking_cal.get_booking_cal_events",
            args:     { start: info.startStr.slice(0, 10), end: info.endStr.slice(0, 10) },
            callback: function (r) { success(r.message || []); },
            error:    fail,
          });
        },
      }],

      select: function (info) {
        var s = isoDate(info.start);
        var e = new Date(info.end);
        if (info.allDay) { e.setDate(e.getDate() - 1); }
        var es = isoDate(e);
        var p = new URLSearchParams({ starts_on: s, ends_on: es, with_nights: es !== s ? "1" : "0" });
        if (info.resource) { p.set("booking_unit", info.resource.id); }
        window.location.href = "/app/booking/new-booking-1?" + p;
      },

      dateClick: function (info) {
        if (info.view.type !== "dayGridMonth") { return; }
        var d = isoDate(info.date);
        window.location.href = "/app/booking/new-booking-1?" +
          new URLSearchParams({ starts_on: d, ends_on: d, with_nights: "0" });
      },

      eventClick: function (info) {
        info.jsEvent.stopPropagation();
        var booking = (info.event.extendedProps || {}).booking;
        if (clickTimer) {
          clearTimeout(clickTimer); clickTimer = null;
          openBooking(booking); return;
        }
        clickTimer = setTimeout(function () { clickTimer = null; showPreview(info.event); }, 280);
      },

      datesSet: function (info) {
        curDate = new Date(info.view.currentStart);
        updateTitle();
      },

      resourceLabelContent: function (info) {
        var c = palette[info.resource.id] || "#aaa";
        return { html: '<span class="bca-res-dot" style="background:' + c + '"></span>' +
                       '<span class="bca-res-name">' + esc(info.resource.title) + '</span>' };
      },

      eventDidMount: function (info) {
        var ep = info.event.extendedProps || {};
        info.el.title = "Status: " + (ep.status || "") +
          "\nGruppe: " + (ep.group_name || "") +
          "\nAnreise: " + (ep.start_label || "") +
          "\nAbreise: " + (ep.end_label || "");
      },

      eventContent: function (info) {
        var view = info.view.type;
        var ep   = info.event.extendedProps || {};
        var sc   = COLORS[ep.status] || "#aaa";

        if (view === "dayGridMonth") {
          var rooms = (info.event.resourceIds || []).map(function (id) {
            var res = resources.find(function (r) { return r.id === id; });
            var c   = palette[id] || "#aaa";
            return res ? '<span class="bca-ev-room" style="background:' + c + ';color:' + contrast(c) + '">' +
              esc(short(res.title)) + '</span>' : "";
          }).join("");
          return { html: '<div class="bca-ev-bar">' +
            '<span class="bca-ev-dot" style="background:' + sc + '"></span>' +
            '<span class="bca-ev-text">' + esc(info.event.title) + '</span>' +
            (rooms ? '<span class="bca-ev-rooms">' + rooms + '</span>' : "") + '</div>' };
        }

        if (view === "listMonth") {
          var units = (info.event.resourceIds || []).map(function (id) {
            var res = resources.find(function (r) { return r.id === id; });
            return res ? esc(res.title) : "";
          }).filter(Boolean).join(", ");
          return { html:
            '<span class="bca-lst-dot" style="background:' + sc + '"></span>' +
            '<span class="bca-lst-name">' + esc(info.event.title) + '</span>' +
            (units ? '<span class="bca-lst-units">' + units + '</span>' : "")
          };
        }

        return undefined;
      },
    });
  }

  frappe.ready(function () {
    curDate = fom(new Date());
    updateTitle();

    document.getElementById("btn-prev").addEventListener("click",  function () { nav(-1); });
    document.getElementById("btn-next").addEventListener("click",  function () { nav(1); });
    document.getElementById("btn-today").addEventListener("click", function () { nav(0); });
    document.getElementById("preview-close").addEventListener("click", hidePreview);
    document.addEventListener("click", function (e) {
      var p = document.getElementById("booking-preview");
      if (!p.classList.contains("bca-hidden") && !p.contains(e.target)) { hidePreview(); }
    });

    ["calendar", "list", "resources"].forEach(function (t) {
      document.getElementById("tab-" + t).addEventListener("click", function () { switchTab(t); });
    });

    frappe.call({
      method:   "bethanien.www.booking_cal.get_booking_cal_resources",
      error:    function (e) { console.error("resources error", e); },
      callback: function (r) {
        resources = (r.message || []).map(function (res) {
          palette[res.id] = res.color;
          return res;
        });
        renderLegend();
        initCalendar();
      },
    });
  });

}());
