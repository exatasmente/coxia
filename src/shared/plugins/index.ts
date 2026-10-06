// The plugin kit, as the app publishes it: the contract a plugin implements, the fixed list of events it may
// observe, and the pure reading of its declaration. A plugin of the team is written against this module; the
// developer's guide and the example live in `docs/plugins/`.

export { PLUGIN_EVENTS, isPluginEvent, type PluginEvent } from './events';
export { PLUGIN_CONTRACT, PLUGIN_ID, readPluginDeclaration, type PluginDeclaration, type PluginDocumentType, type PluginOffers, type PluginReading } from './declaration';
