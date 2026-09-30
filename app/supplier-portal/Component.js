sap.ui.define([
	"sap/ui/core/UIComponent"
], function (UIComponent) {
	"use strict";

	return UIComponent.extend("codeup.supplierportal.Component", {

		metadata: { manifest: "json" },

		init: function () {
			// Let UIComponent do its normal startup (models from the manifest, ...)
			UIComponent.prototype.init.apply(this, arguments);

			// Turn on routing, so the # in the address bar decides which page shows.
			this.getRouter().initialize();
		}
	});
});
