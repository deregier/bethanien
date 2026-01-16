# Copyright (c) 2026, mesgem and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _


class Booking(Document):
	pass


@frappe.whitelist()
def create_checkout(booking_name):
	"""Create a Booking Checkout for the given booking"""
	
	# Check if booking exists
	if not frappe.db.exists("Booking", booking_name):
		frappe.throw(_("Buchung {0} nicht gefunden").format(booking_name))
	
	# Check if checkout already exists
	existing_checkout = frappe.db.get_value(
		"Booking Checkout",
		{"buchung": booking_name},
		"name"
	)
	
	if existing_checkout:
		frappe.throw(_("Es existiert bereits ein Checkout für diese Buchung: {0}").format(existing_checkout))
	
	# Get booking document
	booking = frappe.get_doc("Booking", booking_name)
	
	# Create new checkout
	checkout = frappe.get_doc({
		"doctype": "Booking Checkout",
		"buchung": booking_name,
		#"checkout_date": frappe.utils.now(),
		# Pre-populate fields from booking if needed
	})
	
	checkout.insert()
	frappe.db.commit()
	
	return checkout.name
