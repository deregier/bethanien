# Copyright (c) 2026, mesgem and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from bethanien.bethanien.doctype.booking_checkout.booking_checkout import create_guest_log_entries, create_checkout
from frappe import _


class BookingStatus:
	OFFEN       = "Offen"
	AUSGECHECKT = "Ausgecheckt"
	ABGELEHNT   = "Abgelehnt"
	STORNIERT   = "Storniert"
	BERECHNET   = "Berechnet"

	# Statuses that are ignored for conflict checks
	INACTIVE = (ABGELEHNT, STORNIERT)
	# Statuses that produce a soft (client-side) warning only
	SOFT     = (OFFEN,)
	# Statuses that are fully confirmed / active
	ACTIVE   = (AUSGECHECKT, BERECHNET)


_CONFLICT_SQL = """
	SELECT bul.parent, b.group_name, b.workflow_state
	FROM `tabBooking Unit Link` bul
	JOIN `tabBooking` b ON b.name = bul.parent
	WHERE bul.booking_unit = %(unit)s
	  AND bul.is_active = 1
	  AND bul.parent != %(booking)s
	  AND b.workflow_state {state_filter}
	  AND DATE(COALESCE(bul.starts_on_dt, b.starts_on_dt)) <= %(end_date)s
	  AND DATE(COALESCE(bul.ends_on_dt,   b.ends_on_dt))   >= %(start_date)s
	LIMIT 1
"""


def _find_conflict(booking_unit, booking_name, start_dt, end_dt, states, exclude=False):
	"""Return the first conflicting booking row, or None.

	states   – tuple of workflow_state values
	exclude  – if True, match rows NOT IN states; if False, match rows IN states
	"""
	if not start_dt:
		return None

	start_date = str(start_dt).split(" ")[0]
	end_date   = str(end_dt).split(" ")[0] if end_dt else start_date
	filter_clause = "NOT IN %(states)s" if exclude else "IN %(states)s"

	rows = frappe.db.sql(
		_CONFLICT_SQL.format(state_filter=filter_clause),
		{
			"unit":       booking_unit,
			"booking":    booking_name or "__new__",
			"states":     states,
			"start_date": start_date,
			"end_date":   end_date,
		},
		as_dict=True,
	)
	return rows[0] if rows else None


class Booking(Document):
	def validate(self):
		if self.with_nights == 0:
			self.ends_on    = self.starts_on
			self.ends_on_dt = self.starts_on_dt
			self.ends_on_daypart = self.starts_on_daypart
		self._validate_no_double_booking()

	def _validate_no_double_booking(self):
		"""
		Hard error when an active Booking Unit overlaps with an active booking.

		Active state (Ausgecheckt/Berechnet): block against all non-inactive bookings,
		including other Offen bookings (two confirmations at the same time is not allowed).

		Soft state (Offen): hard-block only against already-active bookings;
		Offen vs. Offen is handled by the client-side soft warning.
		"""
		is_active_state = self.workflow_state in BookingStatus.ACTIVE
		# When active: exclude only INACTIVE (= block Offen + other ACTIVE)
		# When Offen:  exclude INACTIVE + SOFT  (= block only ACTIVE)
		excluded = BookingStatus.INACTIVE if is_active_state else BookingStatus.INACTIVE + BookingStatus.SOFT

		active_rows = [r for r in (self.booking_units_table or []) if r.is_active and r.booking_unit]
		if not active_rows:
			return

		for row in active_rows:
			start_dt = row.starts_on_dt or self.starts_on_dt
			end_dt   = row.ends_on_dt   or self.ends_on_dt

			conflict = _find_conflict(row.booking_unit, self.name, start_dt, end_dt, excluded, exclude=True)

			if conflict:
				unit_name    = frappe.db.get_value("Booking Unit", row.booking_unit, "description") or row.booking_unit
				booking_link = f'<a href="/app/booking/{conflict.parent}">{conflict.parent}</a>'
				frappe.throw(
					_("Buchungseinheit <b>{0}</b> ist in der bestätigten Buchung {1} ({2}) bereits für diesen Zeitraum gebucht.").format(
						unit_name, booking_link, conflict.group_name or conflict.parent,
					)
				)

	def before_insert(self):
		"""Populate booking_units_table with all available booking units when creating a new booking"""
		if not self.booking_units_table:
			# Fetch all available booking units
			booking_units = frappe.get_all(
				"Booking Unit",
				filters={"is_available": 1},
				fields=["name"],
				order_by="description asc"
			)
			
			# Add each booking unit to the child table
			for unit in booking_units:
				self.append("booking_units_table", {
					"booking_unit": unit.name,
					"is_active": 0
				})
	def after_insert(self):
		"""Create checkout link fields after insert"""
		pass
	
	def on_update(self):
		"""Update guest log entries when booking dates change"""
		# Check if dates have changed
		if self.has_value_changed('starts_on') or self.has_value_changed('ends_on'):
			# Check if there's a checkout for this booking
			checkout_name = frappe.db.get_value(
				"Booking Checkout",
				{"booking": self.name},
				"name"
			)
			
			if checkout_name:
				# Update guest log entries for the checkout
				create_guest_log_entries(checkout_name)


@frappe.whitelist()
def check_open_conflicts(booking_name, unit_rows):
	"""
	Return conflicts with Offen/Eingereicht/Entwurf bookings only.
	Used client-side to show a soft warning before saving.
	"""
	import json
	frappe.has_permission("Booking", "write", throw=True)

	if isinstance(unit_rows, str):
		unit_rows = json.loads(unit_rows)

	soft_states = BookingStatus.SOFT
	result = []

	for row in unit_rows:
		booking_unit = row.get("booking_unit")
		conflict = _find_conflict(
			booking_unit, booking_name,
			row.get("starts_on_dt"), row.get("ends_on_dt"),
			soft_states, exclude=False,
		)
		if conflict:
			unit_name = frappe.db.get_value("Booking Unit", booking_unit, "description") or booking_unit
			result.append({
				"unit_name":      unit_name,
				"booking":        conflict.parent,
				"group_name":     conflict.group_name or conflict.parent,
				"workflow_state": conflict.workflow_state,
			})

	return result


@frappe.whitelist()
def apply_workflow(doc, action, comment):
    """
    Apply workflow with reason.
    This method is called from the client-side after capturing the rejection reason.
    """
    from frappe.model.workflow import apply_workflow
    
    # Parse the doc if it's JSON
    if isinstance(doc, str):
        doc = frappe.parse_json(doc)
    
    # Get the document
    booking = frappe.get_doc(doc)

	# Save comment (Only for rejection)
    if comment:
       booking.add_comment("Workflow", text=f"❌ Ablehnungsgrund:\n{comment}")

    # Apply the workflow action by frappe's standard method
    result = apply_workflow(booking, action)
    
    # Create checkout if workflow transitioned to "Bestätigt" status
    if result and hasattr(result, 'workflow_state') and result.workflow_state == "Bestätigt":
        existing_checkout = frappe.db.get_value(
            "Booking Checkout",
            {"booking": result.name},
            "name"
        )
        
        if not existing_checkout:
            # Create checkout
            try:
                checkout_name = create_checkout(result.name)
                frappe.msgprint(_("Checkout {0} wurde automatisch erstellt").format(checkout_name))
            except Exception as e:
                frappe.log_error(f"Error creating checkout: {str(e)}", "Booking Checkout Creation")

    return result