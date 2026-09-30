sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/UIComponent",
	"sap/m/MessageBox",
	"sap/m/MessageToast"
], function (Controller, UIComponent, MessageBox, MessageToast) {
	"use strict";

	/**
	 * Small helpers that all three pages need.
	 * The other controllers extend this one instead of repeating the code.
	 */
	return Controller.extend("codeup.supplierportal.controller.BaseController", {

		getRouter: function () {
			return UIComponent.getRouterFor(this);
		},

		/** Looks a text up in i18n.properties / i18n_tr.properties. */
		getText: function (key, args) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(key, args);
		},

		navTo: function (routeName) {
			this.getRouter().navTo(routeName);
		},

		/**
		 * The backend throws errors whose message is a code like
		 * "EMAIL_ALREADY_REGISTERED". We translate that code here, so the user
		 * always reads the message in their own language.
		 */
		showError: function (error) {
			const code = (error && error.message) || "UNKNOWN_ERROR";
			const bundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
			// hasText() tells us whether this really is one of our codes.
			const text = bundle.hasText(code) ? bundle.getText(code) : bundle.getText("UNKNOWN_ERROR");
			MessageBox.error(text);
		},

		toast: function (key) {
			MessageToast.show(this.getText(key));
		}
	});
});
