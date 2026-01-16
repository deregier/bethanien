# Copyright (c) 2026, mesgem and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class BookingItemLink(Document):
	def before_save(self):
		self.total_cost = (self.base_cost or 0) * (self.quantity or 0)