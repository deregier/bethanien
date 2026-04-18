// Copyright (c) 2026, mesgem and contributors
// For license information, please see license.txt

frappe.ui.form.on('Booking', {
	setup: function(frm) {
		setup_booking_unit_grid(frm);
	},
	
	refresh: function(frm) {
		if (!frm.is_new()) {
			setup_workflow_buttons(frm);
			setup_checkout_button(frm);
		}
	},
	
	onload: function(frm) {
	 	// Populate booking_units_table when creating a new booking (fallback)
	 	if (frm.is_new() && (!frm.doc.booking_units_table || frm.doc.booking_units_table.length === 0)) {
	 		populate_booking_units(frm);
	 	}
	 },

	// Override standard workflow actions
     before_workflow_action: function(frm) {
		return new Promise((resolve, reject) => {
			const action = frm.selected_workflow_action;
			
			if (action && (action === 'Ablehnen' || action === 'Stornieren')) {

				frappe.dom.unfreeze();

				// Pass callbacks to handle dialog result
				show_rejection_dialog_and_apply_state(frm, action, {
					onSuccess: () => resolve(),
					onCancel: () => reject()
				});
			}
			else {
				resolve();
			}
		});
     },

	 // after changing value do action
	 customer(frm) {
		console.log('Customer changed:', frm.doc.customer, frm.customer.email);
		frm.set_value('customer_email', frm.customer.email);
	 },

	starts_on(frm) { update_datetime_fields(frm); },
	starts_on_daypart(frm) { update_datetime_fields(frm); },
	ends_on(frm) { update_datetime_fields(frm); },
	ends_on_daypart(frm) { update_datetime_fields(frm); }
});

function update_datetime_fields(frm) {
	const daypart_time_field = {
		'Vormittag': 'morning_time',
		'Nachmittag': 'afternoon_time',
		'Abend': 'evening_time'
	};

	frappe.db.get_doc('Booking Settings').then(settings => {
		if (frm.doc.starts_on && frm.doc.starts_on_daypart) {
			const time = settings[daypart_time_field[frm.doc.starts_on_daypart]] || '00:00:00';
			frm.set_value('starts_on_dt', frm.doc.starts_on + ' ' + time);
		}

		const ends_on_date = frm.doc.ends_on || frm.doc.starts_on;
		if (!frm.doc.ends_on && frm.doc.starts_on) {
			frm.set_value('ends_on', frm.doc.starts_on);
		}
		if (ends_on_date && frm.doc.ends_on_daypart) {
			const time = settings[daypart_time_field[frm.doc.ends_on_daypart]] || '00:00:00';
			frm.set_value('ends_on_dt', ends_on_date + ' ' + time);
		}
	});
}

function setup_workflow_buttons(frm) {

	// Get available workflow transitions to check which actions are available
	if (frappe.workflow && frappe.workflow.get_transitions) {
		frappe.workflow.get_transitions(frm.doc).then(transitions => {
			const available_actions = transitions.map(t => t.action);
			
			// Add "Bestätigen" button if it's part of the workflow actions
			if (available_actions.includes('Bestätigen')) {
				frm.add_custom_button(__('Bestätigen'), function() {
					apply_workflow(frm, 'Bestätigen', false, null, {
						onSuccess: () => {},
						onCancel: () => {}
					});
				}).addClass('btn-primary');
			}

			// Add "Ablehnen" button if it's part of the workflow actions
			if (available_actions.includes('Ablehnen')) {
				frm.add_custom_button(__('Ablehnen'), function() {
					show_rejection_dialog_and_apply_state(frm, 'Ablehnen', {
						onSuccess: () => {},
						onCancel: () => {}
					});
				}).addClass('btn-danger');
			}

			// Add "Stornieren" button if it's part of the workflow actions
			if (available_actions.includes('Stornieren')) {
				frm.add_custom_button(__('Stornieren'), function() {
					show_rejection_dialog_and_apply_state(frm, 'Stornieren', {
						onSuccess: () => {},
						onCancel: () => {}
					});
				}).addClass('btn-danger');
			}
		});
	}
}

function setup_checkout_button(frm) {
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
				frm.page.add_action_item(__('Checkout erstellen'), function() {
					create_checkout(frm);
				});
			} else {
				// Checkout exists - show "Checkout anzeigen" button
				frm.page.add_action_item(__('Checkout anzeigen'), function() {
					frappe.set_route('Form', 'Booking Checkout', records[0].name);
				});
			}
		});
	}
}

function setup_booking_unit_grid(frm) {
	// Configure booking_units_table grid to prevent adding/deleting rows
	frm.set_df_property('booking_units_table', 'cannot_add_rows', true);
	frm.set_df_property('booking_units_table', 'cannot_delete_rows', true);
}

function populate_booking_units(frm) {
	// Fetch all available booking units
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Booking Unit',
			filters: {
				is_available: 1
			},
			fields: ['name', 'description'],
			order_by: 'description asc',
			limit_page_length: 0
		},
		callback: function(r) {
			if (r.message && r.message.length > 0) {
				// Clear existing entries
				 frm.clear_table('booking_units_table');
				
				 // Add each booking unit to the table
				r.message.forEach(function(unit) {
				let row = frm.add_child('booking_units_table');
				 	row.booking_unit = unit.name;
					row.booking_unit_name = unit.description;
				 	row.is_active = 0; // Default to not active
				 });
				
				 // Refresh the field to show the new rows
				 frm.refresh_field('booking_units_table');
			}
		}
	});
}

function create_checkout(frm) {
	frappe.call({
		method: 'bethanien.bethanien.doctype.booking_checkout.booking_checkout.create_checkout',
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

function show_rejection_dialog_and_apply_state(frm, action, callbacks) {
    let dialog = new frappe.ui.Dialog({
        title: __('Buchung ablehnen'),
        fields: [
            {
                fieldname: 'rejection_reason',
                fieldtype: 'Text',
                label: __('Ablehngrund'),
                reqd: 1,
                description: __('Bitte geben Sie den Grund für die Ablehnung ein')
            }
        ],
        primary_action_label: __('Ablehnen'),
        primary_action: function(values) {
            // Set the rejection reason in the document
            frm.set_value('rejection_reason', values.rejection_reason);
            
            // Close dialog
            dialog.hide();
            
            // Apply workflow with callback
            apply_workflow(frm, action, true, values.rejection_reason, {
                onSuccess: callbacks.onSuccess
            });
        },
        secondary_action_label: __('Abbrechen'),
        secondary_action: function() {
            dialog.hide();
            callbacks.onCancel();
        }
    });
    
    dialog.show();
}

function apply_workflow(frm, action, isRejection, comment, callbacks) {
    frappe.call({
        method: 'bethanien.bethanien.doctype.booking.booking.apply_workflow',
        args: {
            doc: frm.doc,
            action: action,
            comment: comment
        },
        callback: function(r) {
            if (r.message) {
                frm.reload_doc();

				if (isRejection) {
                    frappe.show_alert({
                        message: __('Buchung wurde abgelehnt'),
                        indicator: 'orange'
                    });
                } else {
					frappe.show_alert({
						message: __('Buchung wurde bestätigt'),
						indicator: 'green'
					});
				}
                // Call success callback
                if (callbacks && callbacks.onSuccess) {
                    callbacks.onSuccess();
                }
            }
        },
        error: function() {
            frappe.show_alert({
                message: __('Fehler beim Änderung des Buchungsstatus'),
                indicator: 'red'
            });
            // Call cancel callback
            if (callbacks && callbacks.onCancel) {
                callbacks.onCancel();
            }
        }
    });
}
