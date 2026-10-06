// The plugin kit, as the app publishes it: the contract a plugin implements, the fixed list of events it may
// observe, the pure reading of its declaration and the rule of what the person allowed. A plugin of the team is
// written against this module; the developer's guide and the example live in `docs/plugins/`.

export { PLUGIN_EVENTS, isPluginEvent, type PluginEvent } from './events';
export { PLUGIN_CONTRACT, PLUGIN_ID, readPluginDeclaration, type PluginDeclaration, type PluginDocumentType, type PluginOffers, type PluginReading, type PluginWrite } from './declaration';
export { PLUGIN_ANSWERS, PLUGIN_NEEDS, isPluginAnswer, isPluginNeed, mayReachNetwork, pluginAnswers, pluginDocumentText, pluginNetworkSandbox, pluginWriteStep, type PluginAnswer, type PluginNeed, type PluginPermission, type PluginWriteStep } from './grants';
