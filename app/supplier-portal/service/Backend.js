sap.ui.define([], function () {
	"use strict";

	// Where the CAP service lives. When we run through the approuter (:5000)
	// this same path is forwarded to the backend, so nothing here has to change.
	const BASE = "/portal";

	// The login token is kept in sessionStorage: it survives a page reload,
	// but disappears when the browser tab is closed.
	const TOKEN_KEY = "codeup.supplier.token";

	/**
	 * One place that talks to the backend.
	 *
	 * The Supplier Portal uses plain HTTP calls rather than OData model
	 * binding, because every endpoint here is an action (register / login /
	 * submit) that returns one object - there is no list to bind a table to.
	 * The Supplier Approvals app, which does have a list, uses a real
	 * OData V4 model instead.
	 */
	return {

		getToken:   function () { return sessionStorage.getItem(TOKEN_KEY) || ""; },
		setToken:   function (t) { sessionStorage.setItem(TOKEN_KEY, t); },
		clearToken: function () { sessionStorage.removeItem(TOKEN_KEY); },
		isLoggedIn: function () { return !!this.getToken(); },

		/**
		 * Sends one request and unpacks the answer.
		 * On failure it throws an Error whose message is the backend's error
		 * code, e.g. "EMAIL_ALREADY_REGISTERED". The caller looks that code up
		 * in the i18n file, so the user sees it in their own language.
		 */
		_call: async function (path, body) {
			const response = await fetch(BASE + "/" + path, {
				method: body ? "POST" : "GET",
				headers: {
					"Content-Type": "application/json",
					"x-supplier-token": this.getToken()
				},
				body: body ? JSON.stringify(body) : undefined
			});

			const text = await response.text();
			const data = text ? JSON.parse(text) : null;

			if (!response.ok) {
				throw new Error((data && data.error && data.error.message) || "UNKNOWN_ERROR");
			}
			return data;
		},

		register: async function (email, password) {
			const result = await this._call("register", { email: email, password: password });
			this.setToken(result.token);
			return result;
		},

		login: async function (email, password) {
			const result = await this._call("login", { email: email, password: password });
			this.setToken(result.token);
			return result;
		},

		logout: async function () {
			try {
				await this._call("logout", {});
			} finally {
				// Clear the token even if the server call failed - the user
				// asked to be logged out, so log them out.
				this.clearToken();
			}
		},

		myApplication: function () {
			return this._call("myApplication()");
		},

		submitApplication: function (data) {
			return this._call("submitApplication", { data: data });
		},

		/**
		 * Turns a File the user picked into a base64 text string, because JSON
		 * can only carry text, not raw bytes.
		 * FileReader gives us "data:application/pdf;base64,JVBERi0..." and we
		 * only want the part after the comma.
		 */
		fileToBase64: function (file) {
			return new Promise(function (resolve, reject) {
				const reader = new FileReader();
				reader.onload = function () { resolve(String(reader.result).split(",")[1]); };
				reader.onerror = function () { reject(reader.error); };
				reader.readAsDataURL(file);
			});
		}
	};
});
