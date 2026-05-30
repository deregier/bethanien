import frappe
import json

no_cache = 1


def get_context(context):
	"""
    Kontext für die Checkout-Seite
    URL: /checkout?name=<checkout_name>
    """
    
	checkout_name = frappe.form_dict.get("name")

    # Prüfen, ob checkout_name übergeben wurde
	if not checkout_name:
    	# Kein Name → 404
		frappe.local.response["http_status_code"] = 404
		frappe.local.response["message"] = "Keine Buchungs-ID angegeben"
		return context

    # Prüfen, ob der Datensatz existiert
	if not frappe.db.exists("Booking Checkout", checkout_name):
    	# Datensatz existiert nicht → 404
		frappe.local.response["http_status_code"] = 404
		frappe.local.response["message"] = f"Buchung '{checkout_name}' nicht gefunden"
		return context
	
	doc = frappe.get_doc("Booking Checkout", checkout_name)
	context.doc = doc

	# Rollen-Prüfung
	user_roles = frappe.get_roles()
	context.is_manager = "Hotel Manager" in user_roles or "System Manager" in user_roles
	
	# Buchungsdaten laden
	context.booking_group_name = doc.booking_groupname or ""
	context.booking_user = ""
	context.booking_user_email = ""

	if doc.booking:
		booking_doc = frappe.get_doc("Booking", doc.booking)
		context.booking_user_email = booking_doc.customer_email or ""
		if booking_doc.customer:
			customer_doc = frappe.get_doc("Booking User", booking_doc.customer)
			context.booking_user = f"{customer_doc.first_name or ''} {customer_doc.last_name or ''}".strip()

	return context


@frappe.whitelist()
def get_guests_data(booking):
	"""Gibt alle Gast-Eintraege eines Booking Checkout zurueck"""
	if not frappe.has_permission("Booking Checkout", "read", doc=booking):
		frappe.throw("Keine Berechtigung.")

	doc = frappe.get_doc("Booking Checkout", booking)
	if not doc.guests:
		return []
	return [
		{
			"date": str(row.date),
			"adults_ue":    row.overnight_count_adult or 0,
			"children_ue":  row.overnight_count_child or 0,
			"u5_ue":        row.overnight_count_baby  or 0,
			"adults_day":   row.day_count_adult        or 0,
			"children_day": row.day_count_child        or 0,
		}
		for row in doc.guests
	]


@frappe.whitelist()
def add_daily_entry(booking, adults_ue, children_ue, u5_ue, adults_day, children_day, date):
	"""Fügt einen täglichen Eintrag für Besucherzahlen hinzu oder aktualisiert diesen."""

	# Gastzugriff ist erlaubt
	# if not frappe.has_permission("Booking Checkout", "write", doc=booking):
	#	frappe.throw("Keine Berechtigung zum Speichern.")

	doc = frappe.get_doc("Booking Checkout", booking)

	if not date:
		frappe.throw("Kein Datum angegeben.")
	entry_date = date


	# Prüfen, ob für dieses Datum schon ein Eintrag existiert
	existing_entry = None
	for entry in doc.guests:
		if frappe.utils.getdate(entry.get("date")) == frappe.utils.getdate(entry_date):
			existing_entry = entry
			break

	if existing_entry:
		existing_entry.overnight_count_adult = int(adults_ue)
		existing_entry.overnight_count_child = int(children_ue)
		existing_entry.overnight_count_baby = int(u5_ue)
		existing_entry.day_count_adult = int(adults_day)
		existing_entry.day_count_child = int(children_day)
	else:
		doc.append("guests", {
			"date": frappe.utils.getdate(entry_date),
			"overnight_count_adult": int(adults_ue),
			"overnight_count_child": int(children_ue),
			"overnight_count_baby": int(u5_ue),
			"day_count_adult": int(adults_day),
			"day_count_child": int(children_day)
		})

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	
	return {"success": True, "message": "Daten gespeichert"}
