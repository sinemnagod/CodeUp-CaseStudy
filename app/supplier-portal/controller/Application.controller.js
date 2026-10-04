sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"../service/Backend"
], function (BaseController, JSONModel, Backend) {
	"use strict";

	// Every field the supplier could possibly be allowed to edit.
	const FIELDS = ["companyName", "contactPerson", "phone", "country",
		"category", "taxNumber", "website", "address", "notes"];

	return BaseController.extend("codeup.supplierportal.controller.Application", {

		onInit: function () {
			// "app"  = the application data itself
			// "ui"   = screen state (which half is visible, which fields are open, ...)
			// "flow" = the colours of the three process-flow steps
			this.getView().setModel(new JSONModel({}), "app");
			this.getView().setModel(new JSONModel({
				email: "", formVisible: false, statusVisible: false,
				isReapply: false, canReapply: false, busy: false,
				statusText: "", statusState: "None",
				resultMessage: "", resultMessageType: "Information",
				submittedAtText: "",
				edit: {}, valueState: {}
			}), "ui");
			this.getView().setModel(new JSONModel({}), "flow");

			this._file = null;   // the PDF the user picked, if any

			this.getRouter().getRoute("application").attachPatternMatched(this._onShow, this);
		},

		/** Runs every time this page is opened. */
		_onShow: async function () {
			if (!Backend.isLoggedIn()) { return this.navTo("login"); }
			try {
				this._render(await Backend.myApplication());
			} catch (error) {
				Backend.clearToken();
				this.navTo("login");
			}
		},

		// ---------------------------------------------------------------
		// Decide what the screen looks like, based purely on the status.
		// ---------------------------------------------------------------
		_render: function (application, forceForm) {
			const ui = this.getView().getModel("ui");
			const status = application.status;

			this.getView().getModel("app").setData(application);
			ui.setProperty("/email", application.email);

			// "New" = registered but never submitted -> show the empty form.
			// After a rejection the user can ask for the form again (re-apply).
			const isReapply = status === "Rejected" && forceForm === true;
			const showForm  = status === "New" || isReapply;

			ui.setProperty("/formVisible", showForm);
			ui.setProperty("/statusVisible", !showForm && status !== "New");
			ui.setProperty("/isReapply", isReapply);
			ui.setProperty("/canReapply", status === "Rejected");

			this._applyFieldPermissions(application, isReapply);
			this._applyStatusTexts(application);
			this._applyProcessFlow(status);

			// A re-apply always needs a fresh certificate, so clear the picker.
			this._file = null;
			const uploader = this.byId("certificateUploader");
			if (uploader) { uploader.clear(); }
		},

		/**
		 * On a first application everything is open.
		 * On a re-apply only the fields the approver ticked are open; the rest
		 * are shown filled in but greyed out.
		 */
		_applyFieldPermissions: function (application, isReapply) {
			const allowed = (application.editableFields || "")
				.split(",").map(function (f) { return f.trim(); }).filter(Boolean);

			const edit = {};
			FIELDS.forEach(function (field) {
				edit[field] = isReapply ? allowed.indexOf(field) !== -1 : true;
			});
			this.getView().getModel("ui").setProperty("/edit", edit);
		},

		_applyStatusTexts: function (application) {
			const ui = this.getView().getModel("ui");
			const status = application.status;

			const map = {
				Submitted: { text: "statusSubmitted", state: "Warning",  msg: "msgUnderReview", type: "Information" },
				Approved:  { text: "statusApproved",  state: "Success",  msg: "msgApproved",    type: "Success" },
				Rejected:  { text: "statusRejected",  state: "Error",    msg: "msgRejected",    type: "Error" }
			}[status];

			if (!map) { return; }

			ui.setProperty("/statusText", this.getText(map.text));
			ui.setProperty("/statusState", map.state);

			// On a rejection the approver's reason is appended to the message.
			let message = this.getText(map.msg);
			if (status === "Rejected" && application.decisionNote) {
				message += "  —  " + application.decisionNote;
			}
			ui.setProperty("/resultMessage", message);
			ui.setProperty("/resultMessageType", map.type);

			ui.setProperty("/submittedAtText", application.submittedAt
				? new Date(application.submittedAt).toLocaleString()
				: "");
		},

		/**
		 * Three steps: Submitted -> In Review -> Result.
		 * "Positive" is green, "Critical" orange, "Negative" red and
		 * "Planned" is the empty, dashed box for a step not reached yet.
		 */
		/**
		 * The big symbol drawn in the middle of each process-flow box.
		 * The control's own state icon is small and tucked in a corner, so we
		 * put our own in the node's content aggregation instead.
		 */
		_nodeIcon: function (state) {
			return {
				Positive: { icon: "sap-icon://sys-enter-2",   colour: "Positive" },
				Critical: { icon: "sap-icon://alert",          colour: "Critical" },
				Negative: { icon: "sap-icon://sys-cancel",     colour: "Negative" },
				Planned:  { icon: "sap-icon://pending",        colour: "Neutral"  }
			}[state] || { icon: "sap-icon://pending", colour: "Neutral" };
		},

		_applyProcessFlow: function (status) {
			const done = { node1: "Positive", node2: "Positive" };
			const states = {
				Submitted: Object.assign({}, { node1: "Positive", node2: "Critical", node3: "Planned" }),
				Approved:  Object.assign({}, done, { node3: "Positive" }),
				Rejected:  Object.assign({}, done, { node3: "Negative" })
			}[status] || { node1: "Planned", node2: "Planned", node3: "Planned" };

			const laneOf = function (nodeState) {
				return [{ state: nodeState === "Planned" ? "Neutral" : nodeState, value: 100 }];
			};

			const icon1 = this._nodeIcon(states.node1);
			const icon2 = this._nodeIcon(states.node2);
			const icon3 = this._nodeIcon(states.node3);

			// zoomLevel is settable but not a declared property, so it cannot go
			// in the XML. One and Two are the big boxes; Three and Four are tiny.
			// the page is full width, so use the largest boxes
			const flowControl = this.byId("processFlow");
			if (flowControl && flowControl.setZoomLevel) { flowControl.setZoomLevel("One"); }

			this.getView().getModel("flow").setData({
				node1: states.node1, node2: states.node2, node3: states.node3,
				node1children: ["node2"], node2children: ["node3"],
				lane1: laneOf(states.node1), lane2: laneOf(states.node2), lane3: laneOf(states.node3),
				icon1: icon1.icon, colour1: icon1.colour,
				icon2: icon2.icon, colour2: icon2.colour,
				icon3: icon3.icon, colour3: icon3.colour
			});
		},

		// ---------------------------------------------------------------
		// User actions
		// ---------------------------------------------------------------

		/** Clears the red outline as soon as the user fixes a required field. */
		onRequiredFieldChange: function (event) {
			const field = event.getSource().getName();
			const filled = (event.getParameter("value") || "").trim().length > 0;
			this.getView().getModel("ui").setProperty("/valueState/" + field, filled ? "None" : "Error");
		},

		onFileChange: function (event) {
			const files = event.getParameter("files");
			this._file = files && files.length ? files[0] : null;
		},

		/** FileUploader blocks a non-PDF before it ever reaches the server. */
		onFileTypeMismatch: function () {
			this._file = null;
			this.showError(new Error("FILE_NOT_PDF"));
		},

		/** Same for anything over 10 MB. The backend checks again anyway. */
		onFileSizeExceed: function () {
			this._file = null;
			this.showError(new Error("FILE_TOO_LARGE"));
		},

		onReapply: function () {
			this._render(this.getView().getModel("app").getData(), true);
		},

		onSubmit: async function () {
			const ui = this.getView().getModel("ui");
			const app = this.getView().getModel("app").getData();

			// --- check the mandatory fields here, so the user sees red outlines
			//     immediately instead of waiting for a round trip ---
			let valid = true;
			["companyName", "contactPerson"].forEach(function (field) {
				const empty = !(app[field] || "").trim();
				ui.setProperty("/valueState/" + field, empty ? "Error" : "None");
				if (empty) { valid = false; }
			});
			if (!valid) { return this.showError(new Error("COMPANY_NAME_REQUIRED")); }
			if (!this._file) { return this.showError(new Error("CERTIFICATE_REQUIRED")); }

			ui.setProperty("/busy", true);
			try {
				const payload = {
					certificateName: this._file.name,
					certificateMime: "application/pdf",
					certificateBase64: await Backend.fileToBase64(this._file)
				};
				FIELDS.forEach(function (field) { payload[field] = app[field]; });

				this._render(await Backend.submitApplication(payload));
				this.toast("msgSubmitSuccess");
			} catch (error) {
				this.showError(error);
			} finally {
				ui.setProperty("/busy", false);
			}
		},

		onLogout: async function () {
			await Backend.logout();
			this.navTo("login");
		}
	});
});
