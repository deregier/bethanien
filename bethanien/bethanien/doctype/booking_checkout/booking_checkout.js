// Copyright (c) 2026, mesgem and contributors
// For license information, please see license.txt

frappe.ui.form.on("Booking Checkout", {
 	setup(frm) {
        setup_guest_log_grid(frm);
	},
 });

 function setup_guest_log_grid(frm) {
    // Configure guests grid to prevent adding/deleting rows
	frm.set_df_property('guests', 'cannot_add_rows', true);
	frm.set_df_property('guests', 'cannot_delete_rows', true);
 }
