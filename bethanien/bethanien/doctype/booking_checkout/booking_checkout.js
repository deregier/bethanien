// Copyright (c) 2026, mesgem and contributors
// For license information, please see license.txt

frappe.ui.form.on("Booking Checkout", {
 	setup(frm) {
        setup_guest_log_grid(frm);
	},

	refresh(frm) {
		frm.add_custom_button(__("Übernachtung eintragen"), () => {
			window.open(`/checkout?name=${frm.doc.name}`, '_blank');
		}).addClass('btn-primary');
	},
 });

 function setup_guest_log_grid(frm) {
    // Configure guests grid to prevent adding/deleting rows
	frm.set_df_property('guests', 'cannot_add_rows', true);
	frm.set_df_property('guests', 'cannot_delete_rows', true);
 }
