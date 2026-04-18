# Copyright (c) 2026, mesgem and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from bethanien.bethanien.doctype.booking_checkout.booking_checkout import create_guest_log_entries, create_checkout
from frappe import _


class Booking(Document):
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
		"""Populate fields in the Booking Checkout doctype after creating a new booking"""
		if self.with_nights == 0:
			self.ends_on = self.starts_on
	
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