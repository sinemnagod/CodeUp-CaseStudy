sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"../service/Backend"
], function (BaseController, JSONModel, Backend) {
	"use strict";

	return BaseController.extend("codeup.supplierportal.controller.Login", {

		onInit: function () {
			// A small model that holds only what this screen needs.
			this.getView().setModel(new JSONModel({
				email: "",
				password: "",
				passwordType: "Password",          // "Password" = dots, "Text" = readable
				passwordIcon: "sap-icon://show",
				busy: false
			}), "ui");

			// If the browser still has a valid token, skip the login screen.
			this.getRouter().getRoute("login").attachPatternMatched(async function () {
				if (Backend.isLoggedIn()) {
					try {
						await Backend.myApplication();
						this.navTo("application");
					} catch (e) {
						Backend.clearToken();   // token was old, stay here
					}
				}
			}, this);
		},

		/**
		 * If app/supplier-portal/img/login.jpg is not there, hide the panel
		 * rather than showing a broken image. The form then centres on the
		 * whole page, which is what it did before the photo existed.
		 */
		onImageMissing: function (event) {
			event.getSource().setVisible(false);
		},

		onTogglePassword: function () {
			const ui = this.getView().getModel("ui");
			const hidden = ui.getProperty("/passwordType") === "Password";
			ui.setProperty("/passwordType", hidden ? "Text" : "Password");
			ui.setProperty("/passwordIcon", hidden ? "sap-icon://hide" : "sap-icon://show");
		},

		onGoToRegister: function () {
			this.navTo("register");
		},

		onLogin: async function () {
			const ui = this.getView().getModel("ui");
			ui.setProperty("/busy", true);
			try {
				await Backend.login(ui.getProperty("/email"), ui.getProperty("/password"));
				ui.setProperty("/password", "");
				this.navTo("application");
			} catch (error) {
				this.showError(error);
			} finally {
				ui.setProperty("/busy", false);
			}
		}
	});
});
