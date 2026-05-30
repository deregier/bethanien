import frappe
from datetime import datetime, timedelta
from urllib.parse import urlencode

no_cache = 1

PALETTE = [
	"#4e79a7",  # blau
	"#f28e2b",  # orange
	"#e15759",  # rot
	"#59a14f",  # grün
	"#b07aa1",  # lila
	"#76b7b2",  # türkis
]

STATUS_COLORS = {
	"Offen":       "#aaaaaa",
	"Ausgecheckt": "#6aa84f",
	"Abgelehnt":   "#cc0000",
	"Storniert":   "#e69138",
	"Berechnet":   "#3c78d8",
}


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.redirect(f"/login?{urlencode({'redirect-to': frappe.request.path})}")

	context.title = "Buchungskalender"
	context.bca_config = frappe.as_json({
		"status_colors": STATUS_COLORS,
		"palette":       PALETTE,
	})


# ── Helpers ────────────────────────────────────────────────────────────────

def _to_date_str(dt):
	"""Return YYYY-MM-DD string."""
	if not dt:
		return None
	return str(dt).split("T")[0].split(" ")[0]


def _fmt_label(dt):
	"""Return German date label dd.mm.yyyy."""
	if not dt:
		return ""
	d = _to_date_str(dt)
	if not d:
		return ""
	try:
		return datetime.strptime(d, "%Y-%m-%d").strftime("%d.%m.%Y")
	except Exception:
		return d


def _contrast(hex_color):
	h = hex_color.lstrip("#")
	r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
	return "#000000" if (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 else "#ffffff"


# ── API ────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_booking_cal_resources():
	"""Return Booking Units as EventCalendar resource objects."""
	frappe.has_permission("Booking Unit", "read", throw=True)

	units = frappe.get_all(
		"Booking Unit",
		filters={"is_available": 1},
		fields=["name", "description"],
		order_by="name asc",
	)

	return [
		{
			"id":    str(u.name),
			"title": u.description or u.name,
			"color": PALETTE[i % len(PALETTE)],
		}
		for i, u in enumerate(units)
	]


@frappe.whitelist()
def get_booking_cal_events(start, end):
	"""
	Return one EventCalendar event per active Booking Unit Link row.
	Each row carries its own starts_on_dt / ends_on_dt so individual
	units of the same booking can span different date ranges.
	Events use all-day spans (end is exclusive +1 day).
	"""
	frappe.has_permission("Booking", "read", throw=True)

	rows = frappe.db.sql(
		"""
		SELECT bul.name        AS bul_name,
		       bul.parent      AS booking,
		       bul.booking_unit,
		       bul.starts_on_dt,
		       bul.ends_on_dt,
		       b.group_name,
		       b.workflow_state,
		       b.starts_on_dt  AS b_starts_on_dt,
		       b.ends_on_dt    AS b_ends_on_dt
		FROM `tabBooking Unit Link` bul
		JOIN `tabBooking` b ON b.name = bul.parent
		WHERE bul.is_active = 1
		  AND COALESCE(bul.starts_on_dt, b.starts_on_dt) IS NOT NULL
		  AND COALESCE(bul.starts_on_dt, b.starts_on_dt) < %(end)s
		  AND (
		        COALESCE(bul.ends_on_dt, b.ends_on_dt) IS NULL
		        OR COALESCE(bul.ends_on_dt, b.ends_on_dt) >= %(start)s
		  )
		ORDER BY COALESCE(bul.starts_on_dt, b.starts_on_dt) ASC
		""",
		{"start": start, "end": end},
		as_dict=True,
	)

	if not rows:
		return []

	events = []
	for r in rows:
		booking_key = str(r.booking)
		status      = r.workflow_state or "Entwurf"
		bg          = STATUS_COLORS.get(status, "#aaaaaa")
		fg          = _contrast(bg)

		# Use the unit's own times; fall back to the booking's times
		eff_start = r.starts_on_dt or r.b_starts_on_dt
		eff_end   = r.ends_on_dt   or r.b_ends_on_dt

		start_d = _to_date_str(eff_start)
		end_d   = _to_date_str(eff_end) if eff_end else start_d

		# all-day end is exclusive → add 1 day so the last day is fully covered
		try:
			end_excl = (
				datetime.strptime(end_d, "%Y-%m-%d") + timedelta(days=1)
			).strftime("%Y-%m-%d")
		except Exception:
			end_excl = end_d

		events.append({
			"id":              f"{booking_key}_{r.booking_unit}",
			"title":           r.group_name or booking_key,
			"start":           start_d,
			"end":             end_excl,
			"allDay":          True,
			"resourceId":      str(r.booking_unit),
			"backgroundColor": bg,
			"textColor":       fg,
			"extendedProps": {
				"booking":     booking_key,
				"status":      status,
				"group_name":  r.group_name or booking_key,
				"start_label": _fmt_label(eff_start),
				"end_label":   _fmt_label(eff_end),
			},
		})

	return events


@frappe.whitelist()
def get_booking_list(start=None, end=None):
	"""Return bookings for the list view, optionally filtered to a month range."""
	frappe.has_permission("Booking", "read", throw=True)

	conds  = "b.starts_on_dt IS NOT NULL"
	params: dict = {}

	if start and end:
		conds += (
			" AND b.starts_on_dt < %(end)s"
			" AND (b.ends_on_dt IS NULL OR b.ends_on_dt >= %(start)s)"
		)
		params = {"start": start, "end": end}

	bookings = frappe.db.sql(
		f"""
		SELECT b.name, b.group_name, b.workflow_state,
		       b.starts_on_dt, b.ends_on_dt
		FROM `tabBooking` b
		WHERE {conds}
		ORDER BY b.starts_on_dt ASC
		""",
		params,
		as_dict=True,
	)

	if not bookings:
		return []

	booking_names = [str(b.name) for b in bookings]

	links = frappe.db.sql(
		"""
		SELECT parent, booking_unit, booking_unit_name
		FROM `tabBooking Unit Link`
		WHERE parent IN %(names)s AND is_active = 1
		""",
		{"names": booking_names},
		as_dict=True,
	)

	units_by_booking: dict = {}
	for lnk in links:
		key = str(lnk.parent)
		units_by_booking.setdefault(key, []).append({
			"id":   str(lnk.booking_unit),
			"name": lnk.booking_unit_name or lnk.booking_unit,
		})

	result = []
	for b in bookings:
		key = str(b.name)
		result.append({
			"name":           key,
			"group_name":     b.group_name or key,
			"workflow_state": b.workflow_state or "",
			"start_label":    _fmt_label(b.starts_on_dt),
			"end_label":      _fmt_label(b.ends_on_dt),
			"units":          units_by_booking.get(key, []),
		})

	return result
