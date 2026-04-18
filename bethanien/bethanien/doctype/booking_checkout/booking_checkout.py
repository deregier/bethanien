# Copyright (c) 2026, mesgem and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _


class BookingCheckout(Document):
	def validate(self):
		# Ensure only one checkout per booking
		if self.booking:
			existing = frappe.db.get_value(
				"Booking Checkout",
				{
					"booking": self.booking,
					"name": ["!=", self.name]
				},
				"name"
			)
			
			if existing:
				frappe.throw(_("Es existiert bereits ein Checkout für die Buchung {0}: {1}").format(
					self.booking, existing
				))


@frappe.whitelist()
def create_checkout(booking_name):
	"""Create a Booking Checkout for the given booking"""
	
	# Check if booking exists
	if not frappe.db.exists("Booking", booking_name):
		frappe.throw(_("Buchung {0} nicht gefunden").format(booking_name))
	
	# Check if checkout already exists
	existing_checkout = frappe.db.get_value(
		"Booking Checkout",
		{"booking": booking_name},
		"name"
	)
	
	if existing_checkout:
		frappe.throw(_("Es existiert bereits ein Checkout für diese Buchung: {0}").format(existing_checkout))
	
	# Get booking document
	booking = frappe.get_doc("Booking", booking_name)
	
	# Create new checkout
	checkout = frappe.get_doc({
		"doctype": "Booking Checkout",
		"booking": booking_name,
		#"checkout_date": frappe.utils.now(),
		# Pre-populate fields from booking if needed
	})
	
	checkout.insert()
	frappe.db.commit()
	
	# Add comment to booking after checkout is created
	booking.add_comment("Info", text=f"✅ Checkout {checkout.name} wurde erstellt.")
	
	comment = create_guest_log_entries(checkout.name)
	booking.add_comment("Info", text=f"{comment}")

	return checkout.name


@frappe.whitelist()
def create_guest_log_entries(checkout_name):    
	"""Create Guest Log entries for all dates between booking start and end for the given checkout"""
	from frappe.utils import add_days, getdate
	
	# Get the checkout document
	checkout = frappe.get_doc("Booking Checkout", checkout_name)
	
	# Get the associated booking
	booking = frappe.get_doc("Booking", checkout.booking)

	if booking.with_nights == 0:
		return f"Buchung {booking.name} hat keine Übernachtungen, Erstellung von Gäste-Aufenthalt Log-Einträgen wird übersprungen."
 
	# Get date range
	booking_start = getdate(booking.starts_on)
	booking_end = getdate(booking.ends_on)
	
	# Generate all dates in range (inclusive)
	date_range = []
	current_date = booking_start
	while current_date <= booking_end:
		date_range.append(current_date)
		current_date = add_days(current_date, 1)
	
	# Get existing guest log entries
	existing_entries = {getdate(entry.date): entry for entry in checkout.get("guests") or []}
	
	# 1. Delete entries outside the date range
	entries_to_remove = []
	for entry in checkout.get("guests") or []:
		entry_date = getdate(entry.date)
		if entry_date not in date_range:
			entries_to_remove.append(entry)
	
	for entry in entries_to_remove:
		checkout.remove(entry)
	
	# 2. Create missing entries for dates in range
	for date in date_range:
		if date not in existing_entries:
			checkout.append("guests", {
				"date": date,
				"overnight_count_adult": 0,
				"overnight_count_child": 0,
				"overnight_count_baby": 0,
				"day_count_adult": 0,
				"day_count_child": 0
			})
	
	# Save the checkout document
	checkout.save()
	frappe.db.commit()
	
	return f"Gäste-Aufenthalt Log für Checkout {checkout_name} aktualisiert."