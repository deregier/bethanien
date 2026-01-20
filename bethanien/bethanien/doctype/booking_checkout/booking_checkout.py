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
