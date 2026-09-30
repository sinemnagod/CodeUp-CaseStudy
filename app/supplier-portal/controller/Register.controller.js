sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"../service/Backend"
], function (BaseController, JSONModel, Backend) {
	"use strict";

	/**
	 * The same five rules the backend checks. They are repeated here only to
	 * give instant feedback while typing - the backend stays the real judge,
	 * because anything running in a browser can be switched off.
	 */
	const RULES = {
		length:  function (p) { return p.length >= 8; },
		upper:   function (p) { return /[A-Z]/.test(p); },
		lower:   function (p) { return /[a-z]/.test(p); },
		digit:   function (p) { return /[0-9]/.test(p); },
		special: function (p) { return /[^A-Za-z0-9]/.test(p); }
	};

	return BaseController.extend("codeup.supplierportal.controller.Register", {

		onInit: function () {
			this.getView().setModel(new JSONModel(this._emptyState()), "ui");
		},

		_emptyState: function () {
			const rules = {};
			Object.keys(RULES).forEach(function (key) {
				rules[key] = { state: "None", icon: "sap-icon://circle-task-2" };
			});
			return {
				email: "", password: "",
				passwordType: "Password", passwordIcon: "sap-icon://show",
				rulesVisible: false, canRegister: false, busy: false,
				rules: rules
			};
		},

		/** Runs on every keystroke in the password field. */
		onPasswordLiveChange: function (event) {
			const password = event.getParameter("value") || "";
			const ui = this.getView().getModel("ui");

			// Show the checklist only once the user has started typing.
			ui.setProperty("/rulesVisible", password.length > 0);

			let allOk = true;
			Object.keys(RULES).forEach(function (key) {
				const ok = RULES[key](password);
				allOk = allOk && ok;
				// "Success" is the green colour of the standard theme.
				ui.setProperty("/rules/" + key + "/state", ok ? "Success" : "None");
				ui.setProperty("/rules/" + key + "/icon",
					ok ? "sap-icon://sys-enter-2" : "sap-icon://circle-task-2");
			});

			ui.setProperty("/canRegister", allOk);
		},

		onTogglePassword: function () {
			const ui = this.getView().getModel("ui");
			const hidden = ui.getProperty("/passwordType") === "Password";
			ui.setProperty("/passwordType", hidden ? "Text" : "Password");
			ui.setProperty("/passwordIcon", hidden ? "sap-icon://hide" : "sap-icon://show");
		},

		onGoToLogin: function () {
			this.navTo("login");
		},

		onRegister: async function () {
			const ui = this.getView().getModel("ui");
			if (!ui.getProperty("/canRegister")) { return; }

			ui.setProperty("/busy", true);
			try {
				// Registering logs you in straight away, so we can go directly
				// to the application form.
				await Backend.register(ui.getProperty("/email"), ui.getProperty("/password"));
				ui.setData(this._emptyState());
				this.navTo("application");
			} catch (error) {
				this.showError(error);
			} finally {
				ui.setProperty("/busy", false);
			}
		}
	});
});
