sap.ui.define([
	"sap/ui/core/UIComponent",
	"sap/ui/model/json/JSONModel",
	"sap/ui/Device"
], function (UIComponent, JSONModel, Device) {
	"use strict";

	return UIComponent.extend("codeup.supplierportal.Component", {

		metadata: { manifest: "json" },

		init: function () {
			// Let UIComponent do its normal startup (models from the manifest, ...)
			UIComponent.prototype.init.apply(this, arguments);

			// Exposes sap.ui.Device to the views, so the login photo can be shown
			// on a desktop and dropped on a phone, where half the screen is too
			// precious to spend on decoration.
			this.setModel(new JSONModel(Device), "device");

			// Turn on routing, so the # in the address bar decides which page shows.
			this.getRouter().initialize();
		}
	});
});
