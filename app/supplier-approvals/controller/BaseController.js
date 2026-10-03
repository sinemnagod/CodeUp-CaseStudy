sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/ui/core/format/DateFormat",
	"sap/ui/core/date/UI5Date"
], function (Controller, MessageBox, MessageToast, DateFormat, UI5Date) {
	"use strict";

	// Our backend error codes are all UPPER_SNAKE_CASE. When UI5 wraps an
	// OData error we fish the code back out of the wrapped text with this.
	const CODE_PATTERN = /\b[A-Z][A-Z_]{4,}\b/;

	return Controller.extend("codeup.supplierapprovals.controller.BaseController", {

		getText: function (key, args) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
		},

		/**
		 * Digs the backend's error code out of whatever UI5 hands us.
		 * A plain fetch gives us the code directly; an OData V4 action wraps it
		 * in a longer sentence, so we also try a pattern match.
		 */
		getErrorCode: function (error) {
			if (!error) { return "UNKNOWN_ERROR"; }
			const direct = error.error && error.error.message;
			if (direct) { return direct; }

			const message = String(error.message || "");
			const match = message.match(CODE_PATTERN);
			return match ? match[0] : "UNKNOWN_ERROR";
		},

		showError: function (error) {
			const bundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
			const code = this.getErrorCode(error);
			MessageBox.error(bundle.hasText(code) ? bundle.getText(code) : bundle.getText("UNKNOWN_ERROR"));
		},

		toast: function (key, args) {
			MessageToast.show(this.getText(key, args));
		},

		// ------------------------------------------------------------------
		// Formatters, used from the XML views
		// ------------------------------------------------------------------

		formatCategory: function (category) {
			return category ? this.getText("category" + category) : "";
		},

		/** The database stores "DE"; the user should read "Almanya"/"Germany". */
		formatCountry: function (code) {
			if (!code) { return ""; }
			const bundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
			// an unknown code is shown as-is rather than as a missing-text warning
			return bundle.hasText("country" + code) ? bundle.getText("country" + code) : code;
		},

		formatStatusText: function (status) {
			return status ? this.getText("status" + status) : "";
		},

		/**
		 * OData V4 sends a timestamp as an ISO string like
		 * "2026-09-30T18:50:51.162Z". DateFormat turns it into whatever is
		 * normal for the user's language - 30.09.2026 in Turkish,
		 * Sep 30, 2026 in English - without us writing any of that logic.
		 */
		formatDateTime: function (value) {
			if (!value) { return ""; }
			// UI5Date.getInstance instead of new Date: UI5 can be configured to a
			// different timezone than the browser, and DateFormat then refuses a
			// plain JavaScript Date with "The given date instance isn't valid".
			return DateFormat.getDateTimeInstance({ style: "medium" }).format(UI5Date.getInstance(value));
		},

		/** Orange while pending, green when approved, red when rejected. */
		formatStatusState: function (status) {
			return { Submitted: "Warning", Approved: "Success", Rejected: "Error" }[status] || "None";
		}
	});
});
