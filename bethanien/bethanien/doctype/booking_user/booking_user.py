# Copyright (c) 2026, mesgem and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class BookingUser(Document):
    def before_save(self):
        self.title = f"{self.first_name or ''} {self.last_name or ''}".strip()
