sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/Sorter",
	"sap/ui/core/Fragment"
], function (BaseController, JSONModel, Filter, FilterOperator, Sorter, Fragment) {
	"use strict";

	// The five columns the use case says must be visible at the start.
	const DEFAULT_COLUMNS = {
		companyName: true, contactPerson: true, email: true,
		phone: false, country: false, category: false,
		taxNumber: false, website: false, address: false, notes: false,
		submittedAt: true, status: true
	};

	return BaseController.extend("codeup.supplierapprovals.controller.Main", {

		onInit: function () {
			this.getView().setModel(new JSONModel(Object.assign({}, DEFAULT_COLUMNS)), "cols");
			this.getView().setModel(new JSONModel({ All: 0, Submitted: 0, Approved: 0, Rejected: 0 }), "counts");
			this.getView().setModel(new JSONModel({}), "detail");
			this.getView().setModel(new JSONModel({}), "flow");
			this.getView().setModel(new JSONModel({
				statusFilter: "All",
				categoryFilter: [],
				searchQuery: "",
				sortField: "companyName",
				sortOrder: "asc",
				hasFilters: false,
				canDecide: false,
				decisionNote: "",
				decisionNoteState: "None",
				certificateUrl: "",
				submittedAtText: "",
				decisionSummary: "",
				decisionSummaryType: "Information"
			}), "ui");

			this._table = this.byId("applicationsTable");
			this._refreshCounts();
		},

		/**
		 * The table's binding does not exist yet while onInit runs, so we ask
		 * for it each time instead of caching it.
		 */
		_binding: function () {
			return this._table.getBinding("items");
		},

		/**
		 * Declared on the binding in the XML view. Tells the user when the list
		 * could not be loaded - most likely because they lack the Approval
		 * authorization and the server answered 403.
		 */
		onDataReceived: function (event) {
			const error = event.getParameter("error");
			if (error) { this.showError(error); }
		},

		// ------------------------------------------------------------------
		// Filtering, searching, sorting
		// ------------------------------------------------------------------

		onTabSelect: function (event) {
			this.getView().getModel("ui").setProperty("/statusFilter", event.getParameter("key"));
			this._applyFilters();
		},

		onSearch: function () {
			this._applyFilters();
		},

		onCategoryFilterChange: function (event) {
			const keys = event.getSource().getSelectedKeys();
			this.getView().getModel("ui").setProperty("/categoryFilter", keys);
			this._applyFilters();
		},

		/**
		 * Builds one combined filter and hands it to the OData binding, which
		 * turns it into a $filter in the URL. The server does the work, so this
		 * still behaves correctly with thousands of rows.
		 */
		_applyFilters: function () {
			const ui = this.getView().getModel("ui");
			const status = ui.getProperty("/statusFilter");
			const categories = ui.getProperty("/categoryFilter") || [];
			const query = (ui.getProperty("/searchQuery") || "").trim();

			const filters = [];

			// the tab
			if (status !== "All") {
				filters.push(new Filter("status", FilterOperator.EQ, status));
			}

			// the categories ticked in the settings dialog: any of them (OR)
			if (categories.length) {
				filters.push(new Filter({
					filters: categories.map(function (c) {
						return new Filter("category", FilterOperator.EQ, c);
					}),
					and: false
				}));
			}

			// the search box: match any of the three fields (OR)
			if (query) {
				filters.push(new Filter({
					filters: [
						new Filter("companyName",   FilterOperator.Contains, query),
						new Filter("contactPerson", FilterOperator.Contains, query),
						new Filter("email",         FilterOperator.Contains, query)
					],
					and: false
				}));
			}

			// the groups are combined with AND: right tab AND right category AND matches search
			this._binding().filter(filters);

			ui.setProperty("/hasFilters",
				status !== "All" || categories.length > 0 || query.length > 0);
		},

		onSortChange: function () {
			const ui = this.getView().getModel("ui");
			this._binding().sort(
				new Sorter(ui.getProperty("/sortField"), ui.getProperty("/sortOrder") === "desc")
			);
		},

		onClearFilters: function () {
			const ui = this.getView().getModel("ui");
			ui.setProperty("/statusFilter", "All");
			ui.setProperty("/categoryFilter", []);
			ui.setProperty("/searchQuery", "");
			this.byId("statusTabs").setSelectedKey("All");

			const categoryBox = Fragment.byId(this.getView().getId() + "-settings", "categoryFilter");
			if (categoryBox) { categoryBox.setSelectedKeys([]); }

			this._applyFilters();
		},

		onRefresh: function () {
			this._binding().refresh();
			this._refreshCounts();
		},

		/**
		 * One small $count request per tab. Asking the server to count is much
		 * cheaper than downloading the rows just to count them here.
		 */
		_refreshCounts: async function () {
			const counts = this.getView().getModel("counts");
			const ask = async function (status) {
				const url = "/approval/Applications/$count"
					+ (status ? "?$filter=status eq '" + status + "'" : "");
				const response = await fetch(url, { headers: { Accept: "text/plain" } });
				return response.ok ? parseInt(await response.text(), 10) || 0 : 0;
			};
			try {
				const [all, submitted, approved, rejected] = await Promise.all(
					[ask(""), ask("Submitted"), ask("Approved"), ask("Rejected")]
				);
				counts.setData({ All: all, Submitted: submitted, Approved: approved, Rejected: rejected });
			} catch (e) {
				counts.setData({ All: 0, Submitted: 0, Approved: 0, Rejected: 0 });
			}
		},

		// ------------------------------------------------------------------
		// Settings dialog
		// ------------------------------------------------------------------

		onOpenSettings: async function () {
			if (!this._settingsDialog) {
				this._settingsDialog = await Fragment.load({
					id: this.getView().getId() + "-settings",
					name: "codeup.supplierapprovals.view.SettingsDialog",
					controller: this
				});
				this.getView().addDependent(this._settingsDialog);
			}
			this._settingsDialog.open();
		},

		onCloseSettings: function () {
			this._settingsDialog.close();
		},

		// ------------------------------------------------------------------
		// Detail dialog
		// ------------------------------------------------------------------

		onRowPress: async function (event) {
			const context = event.getParameter("listItem").getBindingContext();
			const application = context.getObject();

			if (!this._detailDialog) {
				this._detailDialog = await Fragment.load({
					id: this.getView().getId() + "-detail",
					name: "codeup.supplierapprovals.view.DetailDialog",
					controller: this
				});
				this.getView().addDependent(this._detailDialog);
			}

			const ui = this.getView().getModel("ui");
			this.getView().getModel("detail").setData(application);

			// Only an application still waiting for a decision can be decided.
			ui.setProperty("/canDecide", application.status === "Submitted");
			ui.setProperty("/decisionNote", "");
			ui.setProperty("/decisionNoteState", "None");
			ui.setProperty("/submittedAtText",
				this.formatDateTime(application.submittedAt));

			// The certificate is served by OData straight out of the database,
			// because the column is annotated with @Core.MediaType.
			ui.setProperty("/certificateUrl",
				"/approval/Applications(" + application.ID + ")/certificate");

			// For an already decided application, show what was decided.
			if (application.status !== "Submitted") {
				const who = application.decidedBy || "";
				const when = this.formatDateTime(application.decidedAt);
				const note = application.decisionNote ? "  —  " + application.decisionNote : "";
				ui.setProperty("/decisionSummary",
					this.getText("status" + application.status) + " · " + who + " · " + when + note);
				ui.setProperty("/decisionSummaryType",
					application.status === "Approved" ? "Success" : "Error");
			}

			this._applyProcessFlow(application.status);

			const fields = Fragment.byId(this.getView().getId() + "-detail", "editableFields");
			if (fields) { fields.setSelectedKeys([]); }

			this._detailDialog.open();
		},

		onCloseDetail: function () {
			this._detailDialog.close();
		},

		/** Same three-step flow the supplier sees in the portal. */
		_applyProcessFlow: function (status) {
			const states = {
				Submitted: { node1: "Positive", node2: "Critical", node3: "Planned" },
				Approved:  { node1: "Positive", node2: "Positive", node3: "Positive" },
				Rejected:  { node1: "Positive", node2: "Positive", node3: "Negative" }
			}[status] || { node1: "Planned", node2: "Planned", node3: "Planned" };

			const laneOf = function (nodeState) {
				return [{ state: nodeState === "Planned" ? "Neutral" : nodeState, value: 100 }];
			};

			this.getView().getModel("flow").setData({
				node1: states.node1, node2: states.node2, node3: states.node3,
				node1children: ["node2"], node2children: ["node3"],
				lane1: laneOf(states.node1), lane2: laneOf(states.node2), lane3: laneOf(states.node3)
			});
		},

		// ------------------------------------------------------------------
		// Decisions
		// ------------------------------------------------------------------

		onDecisionNoteChange: function (event) {
			if ((event.getParameter("value") || "").trim()) {
				this.getView().getModel("ui").setProperty("/decisionNoteState", "None");
			}
		},

		onApprove: function () {
			const ui = this.getView().getModel("ui");
			this._runDecision("approveApplication", {
				ID: this.getView().getModel("detail").getProperty("/ID"),
				note: ui.getProperty("/decisionNote") || ""
			}, "msgApproveSuccess");
		},

		onReject: function () {
			const ui = this.getView().getModel("ui");
			const note = (ui.getProperty("/decisionNote") || "").trim();

			// Checked here so the user sees the red outline immediately;
			// the backend refuses an empty reason regardless.
			if (!note) {
				ui.setProperty("/decisionNoteState", "Error");
				return this.showError(new Error("REJECTION_NOTE_REQUIRED"));
			}

			const fields = Fragment.byId(this.getView().getId() + "-detail", "editableFields");
			this._runDecision("rejectApplication", {
				ID: this.getView().getModel("detail").getProperty("/ID"),
				note: note,
				editableFields: (fields ? fields.getSelectedKeys() : []).join(",")
			}, "msgRejectSuccess");
		},

		/**
		 * Calls one of the backend actions.
		 *
		 * bindContext("/actionName(...)") is how OData V4 calls an action that
		 * is not attached to a single row. The "(...)" is literal syntax
		 * meaning "parameters follow".
		 */
		_runDecision: async function (actionName, parameters, successKey) {
			const action = this.getView().getModel().bindContext("/" + actionName + "(...)");
			Object.keys(parameters).forEach(function (name) {
				action.setParameter(name, parameters[name]);
			});

			this._detailDialog.setBusy(true);
			try {
				await action.execute();
				this._detailDialog.close();
				this.onRefresh();
				this.toast(successKey);
			} catch (error) {
				this.showError(error);
			} finally {
				this._detailDialog.setBusy(false);
			}
		},

		onAnalyzeWithAI: async function () {
			const action = this.getView().getModel().bindContext("/analyzeWithAI(...)");
			action.setParameter("ID", this.getView().getModel("detail").getProperty("/ID"));

			this._detailDialog.setBusy(true);
			this.toast("msgAiThinking");
			try {
				await action.execute();
				const result = action.getBoundContext().getObject();
				this.getView().getModel("ui").setProperty("/decisionNote", result.reason || "");
				this.toast("msgAiResult", [this.getText("status" + result.decision)]);
				this.onRefresh();
			} catch (error) {
				this.showError(error);
			} finally {
				this._detailDialog.setBusy(false);
			}
		}
	});
});
