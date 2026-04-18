frappe.ready(function() {
	// Lade bestehende Werte aus daily_entries
	const dailyEntriesEl = document.getElementById('daily-entries-data');
	const daily_entries = dailyEntriesEl ? JSON.parse(dailyEntriesEl.textContent) : [];
	
	if (daily_entries.length > 0) {
		const today = new Date().toISOString().split('T')[0];
		const todayEntry = daily_entries.find(entry => entry.date === today);
		
		if (todayEntry) {
			document.getElementById('val-adults_ue').innerText = todayEntry.adults_ue || 0;
			document.getElementById('val-children_ue').innerText = todayEntry.children_ue || 0;
			document.getElementById('val-u5_ue').innerText = todayEntry.u5_ue || 0;
			document.getElementById('val-adults_day').innerText = todayEntry.adults_day || 0;
			document.getElementById('val-children_day').innerText = todayEntry.children_day || 0;
		}
	}
});

function changeVal(id, delta) {
	let el = document.getElementById('val-' + id);
	let val = parseInt(el.innerText) + delta;
	el.innerText = val < 0 ? 0 : val;
}

function saveDailyLog() {
	const booking_name = new URLSearchParams(window.location.search).get('name');
	if (!booking_name) {
		frappe.msgprint('Fehler: Keine Buchungs-ID gefunden');
		return;
	}
	
	const data = {
		booking: booking_name,
		adults_ue: document.getElementById('val-adults_ue').innerText,
		children_ue: document.getElementById('val-children_ue').innerText,
		u5_ue: document.getElementById('val-u5_ue').innerText,
		adults_day: document.getElementById('val-adults_day').innerText,
		children_day: document.getElementById('val-children_day').innerText
	};

	frappe.call({
		method: "bethanien.www.checkout.add_daily_entry",
		args: data,
		callback: function(r) {
			if (r.message && r.message.success) {
				frappe.show_alert({message: 'Gespeichert', indicator: 'green'});
			} else {
				frappe.msgprint('Fehler beim Speichern');
			}
		},
		error: function(err) {
			console.error('Fehler:', err);
			frappe.msgprint('Fehler beim Speichern');
		}
	});
}

function updateEmail() {
	const new_email = document.getElementById('guest-email').value;
	const booking_name = new URLSearchParams(window.location.search).get('name');
	
	if (!booking_name) {
		frappe.msgprint('Fehler: Keine Buchungs-ID gefunden');
		return;
	}
	
	frappe.call({
		method: "frappe.client.set_value",
		args: {
			doctype: "Booking Checkout",
			name: booking_name,
			fieldname: "contact_email",
			value: new_email
		},
		callback: function() {
			frappe.msgprint("Email aktualisiert");
		}
	});
}
