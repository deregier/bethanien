// Copyright (c) 2026, mesgem and contributors
// For license information, please see license.txt

frappe.ui.form.on('Booking', {
	refresh: function(frm) {
		// Only show button if booking is saved (not new)
		if (!frm.is_new()) {
			// Check if checkout already exists
			frappe.db.get_list('Booking Checkout', {
				filters: {
					'booking': frm.doc.name
				},
				limit: 1
			}).then(records => {
				if (records.length === 0) {
					// No checkout exists - show "Checkout erstellen" button
					frm.add_custom_button(__('Checkout erstellen'), function() {
						create_checkout(frm);
					}, __('Actions'));
				} else {
					// Checkout exists - show "Checkout anzeigen" button
					frm.add_custom_button(__('Checkout anzeigen'), function() {
						frappe.set_route('Form', 'Booking Checkout', records[0].name);
					}, __('Actions'));
				}
			});
		}
	}
});

function create_checkout(frm) {
	frappe.call({
		method: 'bethanien.bethanien.doctype.booking.booking.create_checkout',
		args: {
			booking_name: frm.doc.name
		},
		callback: function(r) {
			if (r.message) {
				frappe.msgprint(__('Checkout created successfully'));
				frappe.set_route('Form', 'Booking Checkout', r.message);
			}
		}
	});
}
