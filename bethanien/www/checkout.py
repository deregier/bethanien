import frappe
import json

no_cache = 1


def get_context(context):
	"""
    Kontext für die Checkout-Seite
    URL: /checkout?name=<booking_name>
    """
    
	booking_name = frappe.form_dict.get("name")

    # Prüfen, ob booking_name übergeben wurde
	if not booking_name:
    	# Kein Name → 404
		frappe.local.response["http_status_code"] = 404
		frappe.local.response["message"] = "Keine Buchungs-ID angegeben"
		return context

    # Prüfen, ob der Datensatz existiert
	if not frappe.db.exists("Booking Checkout", booking_name):
    	# Datensatz existiert nicht → 404
		frappe.local.response["http_status_code"] = 404
		frappe.local.response["message"] = f"Buchung '{booking_name}' nicht gefunden"
		return context
	
	doc = frappe.get_doc("Booking Checkout", booking_name)
	context.doc = doc

	# Rollen-Prüfung
	user_roles = frappe.get_roles()
	context.is_manager = "Hotel Manager" in user_roles or "System Manager" in user_roles
	
	# Adressdaten nur für Manager laden
	if context.is_manager and doc.get("customer"):
		context.customer_address = frappe.db.get_value(
			"Address", 
			{"link_doctype": "Customer", "link_name": doc.customer}, 
			["address_line1", "city"], 
			as_dict=True
		)

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
